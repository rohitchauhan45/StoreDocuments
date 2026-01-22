// WebhookController.js
import axios from 'axios';
import dotenv from 'dotenv';
import prisma from '../db.js';
import { parseMetadata, checkUserGoogleDrive, checkUserStatus, handleExploreFolderSelection, handleDocumentMetadataSelection, handleDocumentListNavigation, getUserFolders } from '../utils/Utils.js';
import { getUserDocuments } from '../utils/Utils.js';
import { sendFolderSelectionButtons, sendInteractiveButtons, sendExistingFolderButtons } from './WhatsappButtons.js';
import { createFolderHandlers } from './GoogleFolder.js';

dotenv.config();

const WHATSAPP_WEBHOOK_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WAP = process.env.WHATSAPP_API_VERSION || "v22.0";
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ---------- Server state stores ----------
export const pendingUploads = new Map();           // phone -> { mediaId, type, fileName, mimeType, metadata }
const pendingSearches = new Set();                // phone -> searching boolean
export const pendingFolderSelections = new Map(); // phone -> { stage }
export const pendingFolderExplorations = new Map(); // phone -> { folders }
export const pendingDocumentSelections = new Map(); // phone -> { folder, documents }
const processedMessageIds = new Set();            // dedupe incoming webhook deliveries

// limits / config
const MAX_PROCESSED_IDS = 2000;
// ---------- Folder handlers (uses your existing module) ----------
const { handleFolderButtonSelection, handleExistingFolderButtonSelection, handleExistingFolderName, handleNewFolderName, completePendingUpload } =
    createFolderHandlers({
        pendingUploads,
        pendingFolderSelections,
        sendMessage,
        sendFolderSelectionButtons,
        sendInteractiveButtons,
        sendExistingFolderButtons
    });

// ---------- Helpers ----------
export async function sendMessage(to, message) {
    try {
        const url = `https://graph.facebook.com/${WAP}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
        await axios.post(
            url,
            {
                messaging_product: "whatsapp",
                to,
                text: { body: message }
            },
            {
                headers: {
                    "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                    "Content-Type": "application/json"
                },
                validateStatus: () => true
            }
        );
    } catch (error) {
        console.error("Error sending message:", error?.response?.data || error.message || error);
        throw error;
    }
}

function cleanupProcessedIdsIfNeeded() {
    if (processedMessageIds.size > MAX_PROCESSED_IDS) {
        // remove oldest 200 ids
        const arr = Array.from(processedMessageIds);
        for (let i = 0; i < 200 && arr[i]; i++) {
            processedMessageIds.delete(arr[i]);
        }
    }
}

// ---------- Webhook verification ----------
export const verfyWebhook = async (req, res) => {
    try {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        console.log("Verifying webhook...");
        if (mode === "subscribe" && token === WHATSAPP_WEBHOOK_TOKEN) {
            return res.status(200).send(challenge);
        } else {
            return res.status(400).json({ message: "Invalid token", success: false });
        }
    } catch (error) {
        console.error("Error verifying Webhook:", error);
        return res.status(500).json({
            message: "Error verifying Webhook",
            success: false,
            error: error.message
        });
    }
};

// ---------- Main webhook handler ----------
export const handleWebhook = async (req, res) => {
    try {
        const body = req.body;
        if (!body?.entry) return res.sendStatus(200);

        const data = body.entry[0]?.changes?.[0]?.value;
        if (!data) return res.sendStatus(200);

        // Ignore status updates
        if (data.statuses) {
            return res.sendStatus(200);
        }

        if (!data.messages || data.messages.length === 0) {
            return res.sendStatus(200);
        }

        const msg = data.messages[0];
        const messageId = msg.id;
        const from = msg.from; // phone number string
        const type = msg.type;

        // console.log(`[Webhook] messageId=${messageId} from=${from} type=${type}`);

        // ---------------- Deduplicate incoming webhooks ----------------
        if (messageId) {
            if (processedMessageIds.has(messageId)) {
                // console.log(`[Webhook] Duplicate message ignored: ${messageId}`);
                return res.sendStatus(200);
            }
            processedMessageIds.add(messageId);
            cleanupProcessedIdsIfNeeded();
        }

        // ---------------- Handle interactive button replies ----------------
        if (type === "interactive") {
            const interactive = msg.interactive || {};
            // button_reply
            if (interactive.type === "button_reply" && interactive.button_reply) {
                const buttonId = interactive.button_reply.id;
                // console.log(`[Interactive] buttonId=${buttonId} from=${from}`);

                // If user clicked a folder option and you have folder handlers
                if (buttonId === "folder_default" || buttonId === "folder_existing" || buttonId === "folder_new") {
                    await handleFolderButtonSelection(from, buttonId);
                    return res.sendStatus(200);
                }

                if (buttonId?.startsWith("folder_saved_")) {
                    await handleExploreFolderSelection(from, buttonId);
                    return res.sendStatus(200);
                }

                if (buttonId === "explore_folders") {
                    pendingFolderExplorations.delete(from);
                    pendingDocumentSelections.delete(from);

                    const userStatus = await checkUserStatus({ phoneNumber: from });
                    if (userStatus !== true) {
                        await sendMessage(from, userStatus);
                        return res.sendStatus(200);
                    }

                    const folders = await getUserFolders(from);
                    if (!folders.length) {
                        await sendMessage(from, "You don't have any saved folders yet. Upload a document to create one.");
                        return res.sendStatus(200);
                    }

                    pendingFolderExplorations.set(from, { folders });
                    await sendExistingFolderButtons(from, folders);
                    return res.sendStatus(200);
                }

                if (buttonId === "upload_document") {
                    const userStatus = await checkUserStatus({ phoneNumber: from });
                    if (userStatus !== true) {
                        await sendMessage(from, userStatus);
                        return res.sendStatus(200);
                    }
                    // Start upload flow
                    await sendMessage(from, "Upload your Document.\n\n⚠️ Important: Select and send only ONE file.");
                    return res.sendStatus(200);
                }

                if (buttonId === "get_documents") {
                    const userStatus = await checkUserStatus({ phoneNumber: from });
                    if (userStatus !== true) {
                        await sendMessage(from, userStatus);
                        return res.sendStatus(200);
                    }
                    pendingSearches.add(from);
                    await sendMessage(from, "🔎 Please tell me the name of the document you want.");
                    return res.sendStatus(200);
                }
            }

            if (interactive.type === "list_reply" && interactive.list_reply) {
                const listId = interactive.list_reply.id;
                console.log(`[Interactive] list_reply from=${from} id=${listId}`);

                if (listId?.startsWith("document_meta_")) {
                    await handleDocumentMetadataSelection(from, listId);
                    return res.sendStatus(200);
                }

                if (listId?.startsWith("doc_nav_next_") || listId?.startsWith("doc_nav_back_")) {
                    await handleDocumentListNavigation(from, listId);
                    return res.sendStatus(200);
                }

                if (listId?.startsWith("folder_saved_")) {
                    if (pendingFolderExplorations.has(from)) {
                        await handleExploreFolderSelection(from, listId);
                        return res.sendStatus(200);
                    }
                    await handleExistingFolderButtonSelection(from, listId);
                    return res.sendStatus(200);
                }

                return res.sendStatus(200);
            }

            return res.sendStatus(200);
        }

        // ---------------- Handle text messages ----------------
        if (type === "text") {
            const text = String(msg.text?.body || '').trim();

            const userStatus = await checkUserStatus({ phoneNumber: from });
            if (userStatus !== true) {
                await sendMessage(from, userStatus);
                return res.sendStatus(200);
            }

            //  If in folder selection flow
            if (pendingFolderSelections.has(from)) {
                const folderState = pendingFolderSelections.get(from);
                if (folderState.stage === "awaiting_existing_selection") {
                    await handleExistingFolderName(from, text);
                    return res.sendStatus(200);
                }
                if (folderState.stage === "awaiting_new_name") {
                    await handleNewFolderName(from, text);
                    return res.sendStatus(200);
                }
                if (folderState.stage === "awaiting_selection") {
                    await sendMessage(from, "Please choose one of the folder options above.");
                    return res.sendStatus(200);
                }
            }

            // If user has a pending upload (metadata expected)
            if (pendingUploads.has(from)) {
                const pending = pendingUploads.get(from);
                if (!pending.metadata) {
                    const metadata = parseMetadata(text);
                    pendingUploads.set(from, { ...pending, metadata });
                }

                // Ensure user exists and get folder selection info
                let user;
                try {
                    user = await prisma.user.findUnique({
                        where: { phoneNumber: from },
                        select: { id: true, folders: true }
                    });
                } catch (err) {
                    console.error("Error fetching user during upload:", err);
                }

                if (!user) {
                    pendingUploads.delete(from);
                    await sendMessage(from, "❌ User not found. Please reconnect your account.");
                    await sendInteractiveButtons(from);
                    return res.sendStatus(200);
                }

                const pendingUpload = pendingUploads.get(from);
                if (pendingUpload?.targetFolder?.id) {
                    await completePendingUpload(from);
                    return res.sendStatus(200);
                }

                pendingFolderSelections.set(from, { stage: "awaiting_selection" });
                await sendFolderSelectionButtons(from);
                return res.sendStatus(200);
            }

            pendingSearches.delete(from);
            try {
                const result = await getUserDocuments(from, text);
                if (result && result !== false) {
                    const messageParts = [
                        `📁 Folder : ${result.folder || "Selected folder"}`,
                        result.description ? `\n📝 Details : ${result.description}` : null,
                        result.googleDriveLink ? `\n🔗 Document link : ${result.googleDriveLink}` : `\n🔗 Document link not available.`
                    ].filter(Boolean);
                    await sendMessage(from, messageParts.join("\n"));
                    await sendInteractiveButtons(from);
                } else {
                    await sendMessage(from, "Document not found.");
                    await sendInteractiveButtons(from);
                }
            } catch (err) {
                console.error("Error searching documents:", err);
                await sendMessage(from, "❌ Error searching for document. Please try again.");
                await sendInteractiveButtons(from);
            }
            return res.sendStatus(200);
        }

        // ---------------- Handle images ----------------
        if (type === "image") {
            const mediaId = msg.image?.id;
            const fileName = msg.image?.filename || `image_${Date.now()}.jpg`;
            const mimeType = msg.image?.mime_type || "image/jpeg";

            // console.log(`[Image] from=${from} file=${fileName}`);

            if (pendingUploads.has(from)) {
                await sendMessage(from, `⏳ Please complete your current upload first. Send the name/details for your previous file before uploading a new one.`);
                return res.sendStatus(200);
            }

            pendingUploads.set(from, {
                mediaId,
                type: "image",
                fileName,
                mimeType,
                metadata: null
            });

            await sendMessage(from, `✅ We have received your image!\n\nNow please send the metaData (name/details) of the document.`);
            return res.sendStatus(200);
        }

        // ---------------- Handle documents ----------------
        if (type === "document") {
            const mediaId = msg.document?.id;
            const fileName = msg.document?.filename || `document_${Date.now()}`;
            const mimeType = msg.document?.mime_type || "application/octet-stream";

            // console.log(`[Document] from=${from} file=${fileName}`);

            if (pendingUploads.has(from)) {
                await sendMessage(from, `⏳ Please complete your current upload first. Send the name/details for your previous file before uploading a new one.`);
                return res.sendStatus(200);
            }

            pendingUploads.set(from, {
                mediaId,
                type: "document",
                fileName,
                mimeType,
                metadata: null
            });

            await sendMessage(from, `✅ We have received your document!\n\nNow please send the name/details of the document.`);
            return res.sendStatus(200);
        }

        // Default: ack
        return res.sendStatus(200);
    } catch (err) {
        console.error("Webhook error:", err?.message || err);
        return res.sendStatus(500);
    }
};
