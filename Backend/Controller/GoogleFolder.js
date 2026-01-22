import axios from 'axios';
import prisma from '../db.js';
import { uploadFileToGoogleDrive, getDriveClient } from './GoogleAuthController.js';
import { getUserFolders } from '../utils/Utils.js';

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WAP = process.env.WHATSAPP_API_VERSION || 'v22.0';

export const createFolderHandlers = ({ pendingUploads, pendingFolderSelections, sendMessage, sendFolderSelectionButtons, sendInteractiveButtons, sendExistingFolderButtons }) => {
    
    if (!pendingUploads || !pendingFolderSelections) {
        throw new Error('pendingUploads and pendingFolderSelections are required');
    }
    if (!sendMessage || !sendFolderSelectionButtons || !sendInteractiveButtons || !sendExistingFolderButtons) {
        throw new Error('Messaging helpers are required to create folder handlers');
    }

    const persistUserFolder = async (phoneNumber, folderData) => {
        if (!folderData?.id || !folderData?.name) {
            return;
        }

        const currentFolders = await getUserFolders(phoneNumber);
        const normalizedFolder = {
            id: folderData.id,
            name: folderData.name,
            savedAt: folderData.savedAt || new Date().toISOString(),
            isDefault: Boolean(folderData.isDefault)
        };

        const existingIndex = currentFolders.findIndex((folder) => folder.id === normalizedFolder.id);
        if (existingIndex >= 0) {
            currentFolders[existingIndex] = normalizedFolder;
        } else {
            currentFolders.push(normalizedFolder);
        }

        await prisma.user.update({
            where: { phoneNumber },
            data: { folders: currentFolders }
        });
    };

    const applyFolderSelectionToPendingUpload = (phoneNumber, folderData) => {
        if (!folderData?.id) {
            return false;
        }

        const pendingUpload = pendingUploads.get(phoneNumber);
        if (!pendingUpload) {
            return false;
        }

        pendingUploads.set(phoneNumber, {
            ...pendingUpload,
            targetFolder: {
                id: folderData.id,
                name: folderData.name || "Selected Folder"
            }
        });

        return true;
    };

    const handleFolderButtonSelection = async (phoneNumber, buttonId) => {
        if (!pendingUploads.has(phoneNumber)) {
            pendingFolderSelections.delete(phoneNumber);
            await sendMessage(phoneNumber, "No document is waiting to be saved. Please upload a document first.");
            return;
        }

        if (buttonId === "folder_default") {
            await handleDefaultFolderSelection(phoneNumber);
            return;
        }

        if (buttonId === "folder_existing") {
            const savedFolders = await getUserFolders(phoneNumber);

            if (!savedFolders.length) {
                pendingFolderSelections.set(phoneNumber, { stage: "awaiting_selection" });
                await sendMessage(phoneNumber, "You do not have any saved folders yet. Please choose the default folder or create a new folder.");
                await sendFolderSelectionButtons(phoneNumber);
                return;
            }

            pendingFolderSelections.set(phoneNumber, { stage: "awaiting_existing_selection", folders: savedFolders });
            await sendExistingFolderButtons(phoneNumber, savedFolders);
            return;
        }

        if (buttonId === "folder_new") {
            pendingFolderSelections.set(phoneNumber, { stage: "awaiting_new_name" });
            await sendMessage(phoneNumber, "Give the name for new Google Drive folder.");
            return;
        }

        await sendMessage(phoneNumber, "Please select a valid folder option.");
    };

    const handleDefaultFolderSelection = async (phoneNumber) => {
        try {
            const defaultFolder = await ensureDefaultFolder(phoneNumber);
            if (!applyFolderSelectionToPendingUpload(phoneNumber, defaultFolder)) {
                throw new Error("No pending upload to attach default folder to.");
            }
            pendingFolderSelections.delete(phoneNumber);
            await sendMessage(
                phoneNumber,
                `✅ Folder selected: ${defaultFolder.name || "WhatsAppBotUpload"} (default folder)`
            );
            await completePendingUpload(phoneNumber);
        } catch (error) {
            console.error("Error selecting default folder:", error);
            pendingFolderSelections.set(phoneNumber, { stage: "awaiting_selection" });
            await sendMessage(phoneNumber, "❌ Unable to use the default folder right now. Please choose another option.");
            await sendFolderSelectionButtons(phoneNumber);
        }
    };

    const commitFolderSelection = async (phoneNumber, selectedFolder, type = "existing") => {
        if (!selectedFolder?.id || !selectedFolder?.name) {
            throw new Error("Invalid folder selection");
        }

        if (!applyFolderSelectionToPendingUpload(phoneNumber, selectedFolder)) {
            throw new Error("Unable to apply folder selection to pending upload");
        }

        pendingFolderSelections.delete(phoneNumber);
        await sendMessage(
            phoneNumber,
            `✅ Folder selected: ${selectedFolder.name}${type === "existing" ? "" : ` (${type})`}`
        );
        await completePendingUpload(phoneNumber);
    };

    const handleExistingFolderButtonSelection = async (phoneNumber, buttonId) => {
        if (!pendingUploads.has(phoneNumber)) {
            pendingFolderSelections.delete(phoneNumber);
            await sendMessage(phoneNumber, "No document is waiting to be saved. Please upload a document first.");
            return;
        }

        if (!buttonId?.startsWith("folder_saved_")) {
            await sendMessage(phoneNumber, "Please tap a folder button to continue.");
            return;
        }

        const decodedId = decodeURIComponent(buttonId.replace("folder_saved_", ""));
        const pendingState = pendingFolderSelections.get(phoneNumber);
        const savedFolders = pendingState?.folders ?? await getUserFolders(phoneNumber);
        const selectedFolder = savedFolders.find((folder) => folder.id === decodedId);

        if (!selectedFolder) {
            await sendMessage(phoneNumber, "Folder not found. Please choose again.");
            if (savedFolders.length) {
                pendingFolderSelections.set(phoneNumber, { stage: "awaiting_existing_selection", folders: savedFolders });
                await sendExistingFolderButtons(phoneNumber, savedFolders);
            } else {
                pendingFolderSelections.set(phoneNumber, { stage: "awaiting_selection" });
                await sendFolderSelectionButtons(phoneNumber);
            }
            return;
        }

        try {
            await commitFolderSelection(phoneNumber, selectedFolder, "existing");
        } catch (error) {
            console.error("Error committing folder selection from buttons:", error);
            pendingFolderSelections.set(phoneNumber, { stage: "awaiting_selection" });
            await sendMessage(phoneNumber, "❌ Unable to use that folder. Please choose another option.");
            await sendFolderSelectionButtons(phoneNumber);
        }
    };

    const handleExistingFolderName = async (phoneNumber, folderNameInput) => {
        if (!pendingUploads.has(phoneNumber)) {
            pendingFolderSelections.delete(phoneNumber);
            await sendMessage(phoneNumber, "No document is waiting to be saved. Please upload a document first.");
            return;
        }

        const folderName = folderNameInput.trim();

        if (!folderName) {
            await sendMessage(phoneNumber, "Please reply with the number or name of the folder you want to use.");
            return;
        }

        try {
            const pendingState = pendingFolderSelections.get(phoneNumber);
            const savedFolders = pendingState?.folders ?? await getUserFolders(phoneNumber);
            const normalizedFolders = Array.isArray(savedFolders) ? savedFolders : [];

            let selectedFolder = null;
            if (normalizedFolders.length) {
                const numericSelection = Number(folderName);
                if (!Number.isNaN(numericSelection) && numericSelection >= 1 && numericSelection <= normalizedFolders.length) {
                    selectedFolder = normalizedFolders[numericSelection - 1];
                } else {
                    selectedFolder = normalizedFolders.find(
                        (folder) => folder.name?.toLowerCase() === folderName.toLowerCase()
                    );
                }
            }

            if (!selectedFolder) {
                const drive = await getDriveClient(phoneNumber);
                const folder = await findFolderInDrive(drive, folderName);

                if (!folder) {
                    await sendMessage(phoneNumber, "❌ Folder not found. Please reply with a number from the list or try again.");
                    if (normalizedFolders.length) {
                        pendingFolderSelections.set(phoneNumber, { stage: "awaiting_existing_selection", folders: normalizedFolders });
                    } else {
                        pendingFolderSelections.set(phoneNumber, { stage: "awaiting_selection" });
                        await sendFolderSelectionButtons(phoneNumber);
                    }
                    return;
                }

                selectedFolder = { id: folder.id, name: folder.name, type: "existing" };

                await persistUserFolder(phoneNumber, selectedFolder);
            }

            await commitFolderSelection(phoneNumber, selectedFolder, "existing");
        } catch (error) {
            console.error("Error handling existing folder selection:", error);
            pendingFolderSelections.set(phoneNumber, { stage: "awaiting_selection" });
            await sendMessage(phoneNumber, "❌ Unable to use that folder. Please try again.");
            await sendFolderSelectionButtons(phoneNumber);
        }
    };

    const handleNewFolderName = async (phoneNumber, folderNameInput) => {
        if (!pendingUploads.has(phoneNumber)) {
            pendingFolderSelections.delete(phoneNumber);
            await sendMessage(phoneNumber, "No document is waiting to be saved. Please upload a document first.");
            return;
        }

        const folderName = folderNameInput.trim();

        if (!folderName) {
            await sendMessage(phoneNumber, "Please provide a folder name.");
            return;
        }

        try {
            const drive = await getDriveClient(phoneNumber);

            // Check if a folder with the same name already exists
            let folder = await findFolderInDrive(drive, folderName);
            if (!folder || folder.name.toLowerCase() !== folderName.toLowerCase()) {
                folder = await createFolderInDrive(drive, folderName);
            }

            await persistUserFolder(phoneNumber, { id: folder.id, name: folder.name, isDefault: false });

            await commitFolderSelection(phoneNumber, { id: folder.id, name: folder.name }, "new");
        } catch (error) {
            console.error("Error creating new folder:", error);
            pendingFolderSelections.set(phoneNumber, { stage: "awaiting_selection" });
            await sendMessage(phoneNumber, "❌ Unable to create that folder. Please choose another option.");
            await sendFolderSelectionButtons(phoneNumber);
        }
    };

    const completePendingUpload = async (phoneNumber) => {
        const pendingUpload = pendingUploads.get(phoneNumber);

        if (!pendingUpload || !pendingUpload.metadata) {
            await sendMessage(phoneNumber, "No document is waiting to be saved. Please upload a new document.");
            pendingUploads.delete(phoneNumber);
            pendingFolderSelections.delete(phoneNumber);
            return;
        }

        try {
            const targetFolder = pendingUpload.targetFolder;
            if (!targetFolder?.id) {
                console.warn("Pending upload missing target folder. Prompting user to select again.", {
                    phoneNumber
                });
                pendingFolderSelections.set(phoneNumber, { stage: "awaiting_selection" });
                await sendMessage(phoneNumber, "Please choose a folder before we can save your document.");
                await sendFolderSelectionButtons(phoneNumber);
                return;
            }

            const user = await prisma.user.findUnique({
                where: { phoneNumber },
                select: { id: true }
            });

            if (!user) {
                pendingUploads.delete(phoneNumber);
                pendingFolderSelections.delete(phoneNumber);
                await sendMessage(phoneNumber, "❌ User not found. Please reconnect your account.");
                return;
            }

            // console.log("Uploading to Google Drive with metadata...");
            const mediaStream = await getMediaStream(pendingUpload.mediaId);
            const googleDriveResult = await uploadFileToGoogleDrive(
                phoneNumber,
                mediaStream,
                pendingUpload.fileName,
                pendingUpload.mimeType,
                { folderId: targetFolder.id }
            );
            // console.log("File uploaded to Google Drive:", googleDriveResult.viewLink);

            const metadataWithFolder = {
                ...(pendingUpload.metadata && typeof pendingUpload.metadata === "object" ? pendingUpload.metadata : {}),
                folder: {
                    id: targetFolder.id,
                    name: targetFolder.name,
                    selectedAt: new Date().toISOString()
                }
            };

            await prisma.userDocument.create({
                data: {
                    phoneNumber,
                    userId: user.id,
                    fileName: pendingUpload.fileName,
                    mimeType: pendingUpload.mimeType,
                    metadata: metadataWithFolder,
                    googleDriveLink: googleDriveResult.viewLink,
                    googleDriveId: googleDriveResult.fileId
                }
            });

            pendingUploads.delete(phoneNumber);
            pendingFolderSelections.delete(phoneNumber);

            await sendMessage(phoneNumber, `✅ Document saved successfully!\n\n📁 Google Drive: ${googleDriveResult.viewLink}`);
            await sendInteractiveButtons(phoneNumber);

            // console.log(`Document saved for user ${phoneNumber}`);
        } catch (error) {
            console.error("Error uploading to Google Drive or saving document:", error);
            pendingUploads.delete(phoneNumber);
            pendingFolderSelections.delete(phoneNumber);
            await sendMessage(phoneNumber, "❌ Error saving document. Please try uploading again.");
            await sendInteractiveButtons(phoneNumber);
        }
    };

    const ensureDefaultFolder = async (phoneNumber) => {
        const user = await prisma.user.findUnique({
            where: { phoneNumber },
            select: { defaultFolderId: true, folders: true }
        });

        if (!user) {
            throw new Error("User not found while ensuring default folder.");
        }

        let folderId = user.defaultFolderId;
        let folderName = "WhatsAppBotUpload";

        if (!folderId) {
            const drive = await getDriveClient(phoneNumber);
            let existingFolder = await findFolderInDrive(drive, "WhatsAppBotUpload");

            if (existingFolder && !["whatsappbotupload", "whatsappbotuploads"].includes((existingFolder.name || "").toLowerCase())) {
                existingFolder = null;
            }

            if (!existingFolder) {
                existingFolder = await findFolderInDrive(drive, "WhatsAppBotUploads");

                if (existingFolder && !["whatsappbotupload", "whatsappbotuploads"].includes((existingFolder.name || "").toLowerCase())) {
                    existingFolder = null;
                }
            }

            if (existingFolder) {
                folderId = existingFolder.id;
                folderName = existingFolder.name || folderName;
            } else {
                const createdFolder = await createFolderInDrive(drive, "WhatsAppBotUpload");
                folderId = createdFolder.id;
                folderName = createdFolder.name || folderName;
            }
        } else {
            const savedFolders = Array.isArray(user.folders) ? user.folders : [];
            const matchedFolder = savedFolders.find((folder) => folder?.id === folderId);
            if (matchedFolder?.name) {
                folderName = matchedFolder.name;
            }
        }

        await prisma.user.update({
            where: { phoneNumber },
            data: {
                defaultFolderId: folderId
            }
        });

        try {
            await persistUserFolder(phoneNumber, { id: folderId, name: folderName, isDefault: true });
        } catch (persistError) {
            console.warn("Unable to persist default folder metadata:", persistError);
        }

        return { id: folderId, name: folderName };
    };

    const findFolderInDrive = async (drive, folderName) => {
        const escapedName = escapeForDriveQuery(folderName);

        const exactMatch = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${escapedName}'`,
            fields: "files(id, name)",
            spaces: "drive",
            pageSize: 5
        });

        if (exactMatch.data.files && exactMatch.data.files.length > 0) {
            return exactMatch.data.files[0];
        }

        const fallback = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and trashed=false and name contains '${escapedName}'`,
            fields: "files(id, name)",
            spaces: "drive",
            pageSize: 10
        });

        const folders = fallback.data.files || [];
        const caseInsensitive = folders.find((folder) => folder.name?.toLowerCase() === folderName.toLowerCase());
        if (caseInsensitive) {
            return caseInsensitive;
        }

        return folders[0] || null;
    };

    const createFolderInDrive = async (drive, folderName) => {
        const folderMetadata = {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder"
        };

        const folder = await drive.files.create({
            requestBody: folderMetadata,
            fields: "id, name"
        });

        return folder.data;
    };

    const escapeForDriveQuery = (value) => {
        return value.replace(/'/g, "\\'");
    };

    const getMediaStream = async (mediaId) => {
        const metaUrl = `https://graph.facebook.com/${WAP}/${mediaId}?fields=url&access_token=${WHATSAPP_ACCESS_TOKEN}`;
        const { data } = await axios.get(metaUrl);

        if (!data.url) throw new Error("No media URL returned");

        const response = await axios.get(data.url, {
            responseType: "stream",
            headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
        });

        return response.data;
    };

    return {
        handleFolderButtonSelection,
        handleExistingFolderButtonSelection,
        handleExistingFolderName,
        handleNewFolderName,
        completePendingUpload,
        ensureDefaultFolder
    };
};