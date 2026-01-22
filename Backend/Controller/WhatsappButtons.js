import axios from "axios";

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WAP = process.env.WHATSAPP_API_VERSION || "v22.0";
const MAX_LIST_ROWS_PER_SECTION = 10;
const MAX_DOCUMENT_ROWS_PER_SECTION = 10;

const sendWhatsAppRequest = async (payload) => {
    const url = `https://graph.facebook.com/${WAP}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    await axios.post(
        url,
        {
            messaging_product: "whatsapp",
            ...payload
        },
        {
            headers: {
                "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );
};

const sendTextMessage = async (to, message) => {
    await sendWhatsAppRequest({
        to,
        type: "text",
        text: { body: message }
    });
};

// Send folder selection buttons
export const sendFolderSelectionButtons = async (to) => {
    try {
        await sendWhatsAppRequest({
            to,
            type: "interactive",
            interactive: {
                type: "button",
                body: {
                    text: "In which folder would you like to save your document?"
                },
                action: {
                    buttons: [
                        {
                            type: "reply",
                            reply: {
                                id: "folder_default",
                                title: "WhatsAppBotUpload"
                            }
                        },
                        {
                            type: "reply",
                            reply: {
                                id: "folder_existing",
                                title: "My Existing Folder"
                            }
                        },
                        {
                            type: "reply",
                            reply: {
                                id: "folder_new",
                                title: "Create New Folder"
                            }
                        }
                    ]
                }
            }
        });
    } catch (error) {
        console.error("Error sending folder selection buttons:", error);
        throw error;
    }
};

export const sendExistingFolderButtons = async (to, folders) => {
    if (!Array.isArray(folders) || folders.length === 0) {
        throw new Error("No folders provided to sendExistingFolderButtons");
    }

    try {
        const sections = [];
        for (let i = 0; i < folders.length; i += MAX_LIST_ROWS_PER_SECTION) {
            const sectionFolders = folders.slice(i, i + MAX_LIST_ROWS_PER_SECTION);
            sections.push({
                title: `Folders ${i + 1}-${Math.min(i + MAX_LIST_ROWS_PER_SECTION, folders.length)}`,
                rows: sectionFolders.map((folder, sectionIdx) => ({
                    id: `folder_saved_${encodeURIComponent(folder.id)}`,
                    title: folder.name?.slice(0, 24) || `Folder ${i + sectionIdx + 1}`
                }))
            });
        }

        await sendWhatsAppRequest({
            to,
            type: "interactive",
            interactive: {
                type: "list",
                body: {
                    text: "Select a folder to continue."
                },
                action: {
                    button: "Select Folder",
                    sections
                }
            }
        });
    } catch (error) {
        console.error("Error sending existing folder buttons:", error?.response?.data || error);
        throw error;
    }
};

// Send interactive buttons
export const sendInteractiveButtons = async (to) => {
    try {
        await sendWhatsAppRequest({
            to,
            type: "interactive",
            interactive: {
                type: "button",
                body: {
                    text: "What would you like to do?"
                },
                action: {
                    buttons: [
                        {
                            type: "reply",
                            reply: {
                                id: "upload_document",
                                title: "Upload document"
                            }
                        },
                        {
                            type: "reply",
                            reply: {
                                id: "get_documents",
                                title: "Get document"
                            }
                        },
                        {
                            type: "reply",
                            reply: {
                                id: "explore_folders",
                                title: "Explore"
                            }
                        }
                    ]
                }
            }
        });
    } catch (error) {
        console.error("Error sending interactive buttons:", error);
        throw error;
    }
}

const getDocumentRowTitle = (doc, index) => {
    let title =
        doc.metadata?.rawText ||
        doc.metadata?.description ||
        doc.metadata?.title ||
        doc.fileName ||
        `Document ${index}`;

    if (title.length > 24) {
        title = `${title.slice(0, 21)}...`;
    }

    return title;
};

export const sendDocumentMetadataList = async (phoneNumber, folder, documents, page = 0) => {
    if (!Array.isArray(documents) || !documents.length) {
        await sendTextMessage(phoneNumber, `📁 Folder: ${folder.name}\n\nNo documents have been saved in this folder yet.`);
        return;
    }

    const itemsPerPage = MAX_DOCUMENT_ROWS_PER_SECTION;
    const totalPages = Math.ceil(documents.length / itemsPerPage);
    const currentPage = Math.min(page, totalPages - 1);
    const startIndex = currentPage * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageDocuments = documents.slice(startIndex, endIndex);

    // Determine navigation needs
    const hasNext = currentPage < totalPages - 1;
    const hasPrev = currentPage > 0;

    // Calculate available rows for documents (reserve space for navigation)
    // WhatsApp allows max 10 rows total, so we need to reserve 1-2 for navigation
    let maxDocRows = itemsPerPage;
    if (hasNext && hasPrev) {
        maxDocRows = itemsPerPage - 2; // Reserve 2 rows for Back and Next
    } else if (hasNext || hasPrev) {
        maxDocRows = itemsPerPage - 1; // Reserve 1 row for navigation
    }

    // Get document rows
    const docRows = pageDocuments.slice(0, maxDocRows);
    const rows = docRows.map((doc, idx) => ({
        id: `document_meta_${encodeURIComponent(doc.id)}`,
        title: getDocumentRowTitle(doc, startIndex + idx + 1)
    }));

    // Add navigation buttons
    if (hasPrev) {
        rows.unshift({
            id: `doc_nav_back_${currentPage - 1}`,
            title: "◀ Back"
        });
    }

    if (hasNext) {
        rows.push({
            id: `doc_nav_next_${currentPage + 1}`,
            title: "▶ Next"
        });
    }

    const sections = [{
        title: `Page ${currentPage + 1}/${totalPages}`,
        rows: rows
    }];

    const url = `https://graph.facebook.com/${WAP}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "interactive",
        interactive: {
            type: "list",
            header: {
                type: "text",
                text: `${folder.name}`.slice(0, 60)
            },
            body: {
                text: "Select a document to view its metadata and Drive link."
            },
            action: {
                button: "View documents",
                sections
            }
        }
    };

    try {
        await axios.post(url, payload, {
            headers: {
                "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });
    } catch (error) {
        console.error("Failed to send document metadata list:", error?.response?.data || error);
        throw error;
    }
};
