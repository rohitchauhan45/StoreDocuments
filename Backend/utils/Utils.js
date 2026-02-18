import axios from 'axios';
import prisma from '../db.js';
import { sendMessage, pendingFolderExplorations, pendingDocumentSelections } from '../Controller/WebhookController.js';
import { sendDocumentMetadataList, sendInteractiveButtons } from '../Controller/WhatsappButtons.js';
import nodemailer from 'nodemailer';


const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WAP = process.env.WHATSAPP_API_VERSION || "v22.0";
const WHATSAPP_API_BASE_URL = `https://graph.facebook.com/${WAP}`;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

export const checkUserGoogleDrive = async (from) => {
    try {

        const user = await prisma.user.findUnique({
            where: {
                phoneNumber: from
            }
        })

        if (!user) {
            return false
        }

        const hasAccessToken = user.accessToken ? true : false

        if (!hasAccessToken) {
            return false
        }
        return hasAccessToken
    } catch (error) {
        console.error("Error checking user google drive:", error)
        return false
    }
}


export const parseMetadata = (text) => {
    const metadata = {
        rawText: text,
        timestamp: new Date().toISOString()
    };

    const keyValuePattern = /^([a-zA-Z][\w-]*)\s*:\s*(.+)$/gmi;
    let match;
    let hasStructuredData = false;

    while ((match = keyValuePattern.exec(text)) !== null) {
        const key = match[1].toLowerCase().trim();
        const value = match[2].trim();
        metadata[key] = value;
        hasStructuredData = true;
    }

    if (!hasStructuredData) {
        metadata.description = text.trim();
    }

    return metadata;
};


export const getUserDocuments = async (from, description) => {

    let data = {}
    console.log("description", description)
    console.log("from", from)
    try {
        const document = await prisma.userDocument.findFirst({
            where: {
                phoneNumber: from,
                metadata: {
                    path: ["rawText"],
                    string_contains: description,
                    mode: "insensitive"
                }
            },
            select: {
                googleDriveLink: true,
                metadata: true
            }
        })

        if (!document) {
            return false
        }

        data.googleDriveLink = document.googleDriveLink
        data.description = document.metadata.rawText
        data.folder = document.metadata?.folder?.name || null

        console.log("data : ", data)
        return data
    } catch (error) {
        console.error("Error getting user documents:", error)
        return false
    }
}

export const checkUserStatus = async (phoneNumber) => {
    try {
        const user = await prisma.user.findUnique({ where: phoneNumber })

        if (!user) {
            return "User not found , Please Login in our App"
        }
        if (user.status === "inactive") {
            return "Your account is inactive. Please contact the admin to activate your account."
        }

        const hasAccessToken = user.accessToken ? true : false

        if (!hasAccessToken) {
            return "Your account is not connected to Google Drive. Please connect your account to Google Drive to continue."
        }

        return true
    } catch (error) {
        console.error("Error checking user status:", error)
        return "Something went wrong. Please try again later."
    }
}


// Send WhatsApp template message
// If your approved template has NO body variables, pass includeBodyParameters: false
// If it has one variable (e.g. {{Name}}), pass includeBodyParameters: true (default)
export const sendWhatsAppTemplateMessage = async (to, userName, templateName, languageCode = 'en', options = {}) => {
    const { includeBodyParameters = true } = options;

    try {
        if (!to) throw new Error('Recipient phone number is required');
        if (!templateName) throw new Error('Template name is required');
        if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) throw new Error('WhatsApp not configured');

        const messageUrl = `${WHATSAPP_API_BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

        const template = {
            name: templateName,
            language: { code: languageCode }
        };

        if (includeBodyParameters) {
            const nameForTemplate = userName && String(userName).trim() ? String(userName).trim() : 'guys';
            template.components = [
                {
                    type: 'body',
                    parameters: [{ type: 'text', text: nameForTemplate }]
                }
            ];
        }

        const messagePayload = {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template
        };

        const response = await axios.post(messageUrl, messagePayload, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            validateStatus: () => true
        });

        if (response.status !== 200) {
            const errMsg = response.data?.error?.message || response.statusText;
            const errCode = response.data?.error?.code;
            console.error('WhatsApp template API error:', response.status, errCode, errMsg, response.data?.error);
            throw new Error(`WhatsApp template failed: ${errMsg} (${errCode})`);
        }

        return {
            success: true,
            messageId: response.data.messages?.[0]?.id,
            recipient: to,
            templateName,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error('Send WhatsApp template message error:', error?.response?.data || error?.message || error);
        throw error;
    }
};

export const handleDocumentMetadataSelection = async (phoneNumber, listId) => {
    const decodedId = decodeURIComponent(listId.replace("document_meta_", ""));
    const pendingState = pendingDocumentSelections.get(phoneNumber);
    const documents = pendingState?.documents || [];
    const selectedDoc = documents.find((doc) => doc.id === decodedId);

    if (!pendingState || !selectedDoc) {
        pendingDocumentSelections.delete(phoneNumber);
        await sendMessage(phoneNumber, "Document not found. Send \"Explore\" to view your folders again.");
        return;
    }

    pendingDocumentSelections.delete(phoneNumber);

    let metadataText = "";
    if (selectedDoc.metadata && typeof selectedDoc.metadata === "object") {
        metadataText = selectedDoc.metadata.rawText || selectedDoc.metadata.description || selectedDoc.metadata.title || "";
    }
    metadataText = metadataText || selectedDoc.fileName;

    const driveLink = selectedDoc.googleDriveLink
        || (selectedDoc.googleDriveId ? `https://drive.google.com/file/d/${selectedDoc.googleDriveId}/view` : null);

    const responseLines = [
        `📁Folder : ${pendingState.folder?.name || "Selected folder"}`,
        metadataText ? `\n📝 Details : ${metadataText}` : null,
        driveLink ? `\n🔗 Document link : ${driveLink}` : `\n🔗 Document link not available.`,

    ].filter(Boolean);

    await sendMessage(phoneNumber, responseLines.join("\n"));
    await sendInteractiveButtons(phoneNumber);
};

export const handleDocumentListNavigation = async (phoneNumber, listId) => {
    const pendingState = pendingDocumentSelections.get(phoneNumber);

    if (!pendingState) {
        await sendMessage(phoneNumber, "Session expired. Send \"Explore\" to view your folders again.");
        return;
    }

    let newPage;
    if (listId.startsWith("doc_nav_next_")) {
        newPage = parseInt(listId.replace("doc_nav_next_", ""));
    } else if (listId.startsWith("doc_nav_back_")) {
        newPage = parseInt(listId.replace("doc_nav_back_", ""));
    } else {
        await sendMessage(phoneNumber, "Invalid navigation. Send \"Explore\" to view your folders again.");
        return;
    }

    // Update page state
    pendingState.currentPage = newPage;
    pendingDocumentSelections.set(phoneNumber, pendingState);

    // Send the new page
    await sendDocumentMetadataList(
        phoneNumber,
        pendingState.folder,
        pendingState.documents,
        newPage
    );
};

export const handleExploreFolderSelection = async (phoneNumber, listId) => {
    const decodedId = decodeURIComponent(listId.replace("folder_saved_", ""));
    const pendingState = pendingFolderExplorations.get(phoneNumber);
    const savedFolders = pendingState?.folders ?? await getUserFolders(phoneNumber);
    const selectedFolder = savedFolders.find((folder) => folder.id === decodedId);

    if (!selectedFolder) {
        await sendMessage(phoneNumber, "Folder not found. Please tap Explore again to reload your folders.");
        pendingFolderExplorations.delete(phoneNumber);
        return;
    }

    const documentWhere = {
        phoneNumber,
        OR: [
            { metadata: { path: ["folder", "id"], equals: selectedFolder.id } },
            { metadata: { path: ["folderId"], equals: selectedFolder.id } },
            { metadata: { path: ["folder_id"], equals: selectedFolder.id } }
        ]
    };

    let [documents, totalCount] = await Promise.all([
        prisma.userDocument.findMany({
            where: documentWhere,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                fileName: true,
                googleDriveLink: true,
                googleDriveId: true,
                metadata: true,
                createdAt: true
            }
        }),
        prisma.userDocument.count({ where: documentWhere })
    ]);

    pendingFolderExplorations.delete(phoneNumber);

    if (!documents.length) {
        await sendMessage(phoneNumber, `📁 Folder: ${selectedFolder.name}\n\nNo documents have been saved in this folder yet.`);
        return;
    }

    documents = documents.map((doc) => {
        if (doc?.metadata && !doc.metadata.folder) {
            const id = doc.metadata.folderId || doc.metadata.folder_id || null;
            const name = doc.metadata.folderName || doc.metadata.folder_name || null;

            if (id && name) {
                doc.metadata.folder = { id, name };
            }
        }
        return doc;
    });

    // Store all documents with page state (starting at page 0)
    pendingDocumentSelections.set(phoneNumber, {
        folder: selectedFolder,
        documents,
        currentPage: 0,
        totalCount
    });
    await sendDocumentMetadataList(phoneNumber, selectedFolder, documents, 0);
};

const normalizeFolders = (folders) => {
    return (Array.isArray(folders) ? folders : [])
        .filter((folder) => folder && typeof folder === "object")
        .map((folder) => ({
            id: folder.id,
            name: folder.name,
            savedAt: folder.savedAt || folder.createdAt || null,
            isDefault: Boolean(folder.isDefault)
        }))
        .filter((folder) => folder.id && folder.name);
};

export const getUserFolders = async (phoneNumber) => {
    const documents = await prisma.userDocument.findMany({
        where: {
            phoneNumber,
            OR: [
                { metadata: { path: ["folder", "id"], not: null } },
                { metadata: { path: ["folderId"], not: null } },
                { metadata: { path: ["folder_id"], not: null } }
            ]
        },
        select: {
            metadata: true,
            createdAt: true
        }
    });

    const folderMap = new Map();

    documents.forEach((doc) => {
        let folder = doc.metadata?.folder;

        if (!folder) {
            const id = doc.metadata?.folderId || doc.metadata?.folder_id || null;
            const name = doc.metadata?.folderName || doc.metadata?.folder_name || null;

            if (id && name) {
                folder = { id, name };
            }
        }

        if (!folder?.id || !folder?.name) {
            return;
        }

        const normalizedFolder = {
            id: folder.id,
            name: folder.name,
            savedAt: folder.savedAt || folder.createdAt || doc.createdAt || null,
            isDefault: Boolean(folder.isDefault)
        };

        if (!folderMap.has(folder.id)) {
            folderMap.set(folder.id, normalizedFolder);
        }
    });

    return normalizeFolders(Array.from(folderMap.values()));
};

export const sendEmail = async (sendEmail, otp) => {
    try {
        // Use port 587 + STARTTLS; many hosts block outbound 465 (e.g. InMotion)
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            requireTLS: true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        })
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: sendEmail,
            subject: 'OTP for Reset Password',
            html: `
            <div style="font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px;">
      <div style="max-width: 500px; margin: auto; background: #ffffff; border-radius: 10px; overflow: hidden;">
        
        <div style="background: #4f46e5; padding: 20px; text-align: center; color: #ffffff;">
          <h2>Password Reset Verification</h2>
        </div>

        <div style="padding: 25px; color: #333333; text-align: center;">
          <p style="font-size: 16px; margin-bottom: 10px;">Hello,</p>
          <p style="font-size: 16px;">Use the OTP below to reset your password:</p>

          <h1 style="font-size: 36px; letter-spacing: 4px; background: #e0e7ff; display: inline-block; padding: 10px 20px; border-radius: 8px; margin: 20px 0; color: #4338ca;">
            ${otp}
          </h1>

          <p style="font-size: 14px; color: #666;">This OTP is valid for the next <strong>5 minutes</strong>.</p>
        </div>

        <div style="background: #f9fafb; text-align: center; padding: 15px;">
          <p style="font-size: 12px; color: #888888;">
            If you did not request this, please ignore this email.
          </p>
        </div>
      </div>
    </div>
    `
        }
        await transporter.sendMail(mailOptions)
        return true
    } catch (error) {
        console.error("Error sending email:", error)
        return false
    }
}