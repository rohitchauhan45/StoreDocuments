import { google } from 'googleapis';
import prisma from '../db.js';
import { sendWhatsAppTemplateMessage } from '../utils/Utils.js';
import jwt from 'jsonwebtoken'

const port = process.env.PORT || 4000;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

// for create OAuth client
export const createOAuthClient = () => {
    let clientId = process.env.GOOGLE_CLIENT_ID;
    let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/api/googleAuth/callback`;

    if (!clientId || !clientSecret) {
        throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    }

    // Trim whitespace that might cause issues
    clientId = clientId.trim();
    clientSecret = clientSecret.trim();

    // Validate Client ID format (should end with .apps.googleusercontent.com)
    if (!clientId.endsWith('.apps.googleusercontent.com')) {
        console.warn('Warning: Client ID format might be incorrect. Expected format: *.apps.googleusercontent.com');
        console.warn('Client ID starts with:', clientId.substring(0, 20) + '...');
    }

    // Log partial info for debugging (without exposing full secrets)
    // console.log('Creating OAuth client with:', {
    //     clientIdPrefix: clientId.substring(0, 30) + '...',
    //     clientIdLength: clientId.length,
    //     clientSecretLength: clientSecret.length,
    //     redirectUri
    // });

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// for google drive permission
export const googleAuth = async (req, res) => {
    try {
        const { phone, token } = req.query;

        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        if (!token) {
            return res.status(401).json({ error: 'Authentication token is required' });
        }

        let userId;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            userId = decoded.userId;
        } catch (jwtError) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Store phone number in session/cookie for callback
        res.cookie('googleDrivePhone', phone, {
            httpOnly: true,
            maxAge: 600000, // 10 minutes
            sameSite: 'lax'
        });

        const oauth2Client = createOAuthClient();
        const scopes = [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email',
            'openid'
        ];

        // Pass phone in state
        const statePayload = { phone,userId};
        const state = jwt.sign(statePayload, process.env.JWT_SECRET, { expiresIn: '10m' });

        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: scopes,
            state: state,
        });
        // console.log('Generated Google OAuth URL:', url);
        if (req.query.debug === 'true') {
            return res.json({ url });
        }
        return res.redirect(url);
    } catch (err) {
        return res.status(500).json({ error: 'Failed to initiate Google OAuth', details: err.message });
    }
}

// after googler drive permission
export const googleAuthCallback = async (req, res) => {
    const { code, error, state } = req.query;

    
    // Check if Google returned an error
    if (error) {
        console.error('Google OAuth error:', error, req.query);
        const redirect = new URL(`${frontendUrl}/login`);
        redirect.searchParams.set('error', error);
        redirect.searchParams.set('error_description', req.query.error_description || 'OAuth error occurred');
        return res.redirect(redirect.toString());
    }

    if (!code) {
        console.error('Missing authorization code in callback');
        return res.status(400).send('Missing authorization code');
    }

    let phoneNumber,userId;
    
    try {
        const decodedState = jwt.verify(state, process.env.JWT_SECRET);
        phoneNumber = decodedState.phone;
        userId = decodedState.userId;
        // console.log('✅ Decoded state:', decodedState);
    } catch (err) {
        // console.error('❌ Invalid or expired state:', err.message);
        return res.status(400).send('Invalid or expired OAuth state');
    }

    if (!phoneNumber) {
        // console.error('Missing phone number in callback');
        const redirect = new URL(`${frontendUrl}/login`);
        redirect.searchParams.set('error', 'missing_phone');
        redirect.searchParams.set('error_message', 'Phone number not found. Please try again.');
        return res.redirect(redirect.toString());
    }

    try {
        const oauth2Client = createOAuthClient();
        // console.log('Exchanging code for tokens...');    
        const { tokens } = await oauth2Client.getToken(code);
        // console.log('Tokens received successfully');
        oauth2Client.setCredentials(tokens);

        // Get user's name from Google
        let userName = null;
        let userEmail = null;
        try {
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
            const userInfo = await oauth2.userinfo.get();
            userName = userInfo.data.name || userInfo.data.email || null;
            userEmail = userInfo.data.email || null;
            console.log('User name retrieved:', userName);
            console.log('User email retrieved:', userEmail);
        } catch (userInfoError) {
            console.warn('Failed to retrieve user info:', userInfoError.message);
            // Continue even if we can't get the name
        }

        // Store tokens in database with user name (using normalized phone)
        await persistTokensToDatabase(phoneNumber, tokens, userId, userName, userEmail);
        // console.log('Tokens saved to database');

        // Create WhatsAppBotUploads folder in Google Drive
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        const folderId = await createFolderStructure(drive);

        const existingUser = await prisma.user.findUnique({
            where: { phoneNumber: phoneNumber },
            select: { folders: true }
        });

        const existingFolders = Array.isArray(existingUser?.folders)
            ? existingUser.folders.filter((folder) => folder?.id && folder.id !== folderId)
            : [];

        const defaultFolderEntry = {
            id: folderId,
            name: 'WhatsAppBotUpload',
            savedAt: new Date().toISOString(),
            isDefault: true
        };

        // Update folder info in database (using normalized phone)
        await prisma.user.update({
            where: { phoneNumber: phoneNumber },
            data: {
                defaultFolderId: folderId,
                folders: [defaultFolderEntry, ...existingFolders]
            }
        });
        // console.log('Folder created and saved to database');

        // Send welcome template message via WhatsApp (sends user's name so {{1}} is replaced)
        try {
            await sendWhatsAppTemplateMessage(
                phoneNumber,
                userName,
                'welcome',
                'en',
                { includeBodyParameters: true }
            );
        } catch (whatsappError) {
            // Log error but don't fail the Google Drive connection
            console.warn('Failed to send welcome WhatsApp template message:', whatsappError.message);
            console.warn('Google Drive connection was successful, but WhatsApp message could not be sent');
        }

        // Clear cookie
        res.clearCookie('googleDrivePhone');

        const redirect = new URL(`${frontendUrl}/dashboard`);
        redirect.searchParams.set('drive_connected', 'true');
        return res.redirect(redirect.toString());
    } catch (err) {
        // console.error('Token exchange error:', err.message);
        // console.error('Full error:', err);
        const redirect = new URL(`${frontendUrl}/dashboard`);
        redirect.searchParams.set('error', 'token_exchange_failed');
        redirect.searchParams.set('error_message', err.message);
        return res.redirect(redirect.toString());
    }
}

// Create WhatsAppBotUploads folder in Google Drive
const createFolderStructure = async (drive) => {
    try {
        const candidateNames = ['WhatsAppBotUpload', 'WhatsAppBotUploads'];

        for (const name of candidateNames) {
            const folderResponse = await drive.files.list({
                q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive'
            });

            if (folderResponse.data.files && folderResponse.data.files.length > 0) {
                // console.log(`Found existing ${name} folder:`, folderResponse.data.files[0].id);
                return folderResponse.data.files[0].id;
            }
        }

        const folderMetadata = {
            name: 'WhatsAppBotUpload',
            mimeType: 'application/vnd.google-apps.folder'
        };

        const folder = await drive.files.create({
            requestBody: folderMetadata,
            fields: 'id, name'
        });

        // console.log('Created WhatsAppBotUpload folder:', folder.data.id);
        return folder.data.id;
    } catch (err) {
        // console.error('Error creating folder structure:', err);
        throw new Error('Failed to create folder structure: ' + err.message);
    }
}

// permission token
export const getToken = async (req, res) => {
    try {
        const {userid} = req

        if (!userid) {
            return res.json({ hasToken: false, message: 'User ID is required' });
        }

        const credential = await prisma.user.findUnique({
            where: { adminId: userid }
        });


        if (!credential) {
            return res.json({ hasToken: false, message: 'No tokens found for this phone number. Please connect Google Drive first.' });
        }

        const isExpired = credential.expiryDate ? Date.now() > Number(credential.expiryDate) : false;

        return res.json({
            hasToken: true,
            scope: credential.scope,
            tokenType: credential.tokenType,
            hasAccessToken: !!credential.accessToken,
            hasRefreshToken: !!credential.refreshToken,
            expiryDate: credential.expiryDate ? new Date(Number(credential.expiryDate)).toISOString() : null,
            isExpired: isExpired,
        });
    } catch (err) {
        //console.error('Error getting token:', err);
        return res.status(500).json({ hasToken: false, message: 'Error retrieving tokens' });
    }
}

// Disconnect Google Drive (delete tokens for a phone number)
export const disconnectGoogleDrive = async (req, res) => {
    try {
        const {userid} = req

        if (!userid) {
            return res.json({ hasToken: false, message: 'User ID is required' });
        }

        await prisma.user.update({
            where: { adminId:userid },
            data: {
                accessToken: null,
                refreshToken: null,
                scope: null,
                tokenType: null,
                expiryDate: null,
                refreshTokenExpiresIn: null,
                userName: null,
                defaultFolderId: null,
                folders: []
            }
        });

        // console.log(`Google Drive disconnected for user ID: ${userid}`);
        return res.json({ success: true, message: 'Google Drive disconnected successfully' });
    } catch (err) {
        console.error('Error disconnecting Google Drive:', err);
        return res.status(500).json({ success: false, message: 'Error disconnecting Google Drive' });
    }
}

// Store tokens in database
const persistTokensToDatabase = async (phoneNumber, tokens, adminId, userName = null, googleMail = null) => {
    try {
        // Check if user already exists to preserve existing googleMail if new one is null
        const existingUser = await prisma.user.findUnique({
            where: { phoneNumber: phoneNumber },
            select: { googleMail: true }
        });

        // Preserve existing googleMail if new one is null
        const finalGoogleMail = googleMail || existingUser?.googleMail || null;

        const isDocumentExists = await prisma.userDocument.findMany({where:{userId:adminId}})

        if(isDocumentExists){
            await prisma.userDocument.updateMany({where:{userId:adminId},data:{phoneNumber:phoneNumber}})
        }

        const tokenData = {
            phoneNumber: phoneNumber,
            accessToken: tokens.access_token || '',
            refreshToken: tokens.refresh_token || null,
            scope: tokens.scope || null,
            tokenType: tokens.token_type || null,
            expiryDate: tokens.expiry_date ? BigInt(tokens.expiry_date) : null,
            refreshTokenExpiresIn: tokens.refresh_token_expires_in || null,
            userName: userName || null,
            googleMail: finalGoogleMail,
            adminId: adminId
        };

        // Upsert: update if exists, create if not
        await prisma.user.upsert({
            where: { adminId:adminId },
            update: tokenData,
            create: tokenData,
        });

        // console.log(`Tokens saved for phone number: ${phoneNumber}${userName ? `, user: ${userName}` : ''}${finalGoogleMail ? `, email: ${finalGoogleMail}` : ''}`);
    } catch (err) {
        // console.error('Error saving tokens to database:', err);
        throw err;
    }
}

// get authenticated Google Drive client
export const getDriveClient = async (phoneNumber) => {
    if (!phoneNumber) {
        throw new Error('Phone number is required to get Google Drive client');
    }

    const credential = await prisma.user.findUnique({
        where: { phoneNumber: phoneNumber }
    });

    if (!credential) {
        throw new Error('No tokens found for this phone number. Please connect Google Drive first.');
    }

    const tokens = {
        access_token: credential.accessToken,
        refresh_token: credential.refreshToken,
        scope: credential.scope,
        token_type: credential.tokenType,
        expiry_date: credential.expiryDate ? Number(credential.expiryDate) : null,
    };

    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials(tokens);

    // Check if token is expired and refresh if needed
    if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
        // console.log('Access token expired, refreshing...');
        try {
            const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(newCredentials);
            // Preserve existing userName when refreshing tokens
            await persistTokensToDatabase(phoneNumber, newCredentials, credential.adminId, credential.userName, credential.googleMail);
            // console.log('Access token refreshed successfully');
        } catch (err) {
            console.error('Error refreshing access token:', err);
            throw new Error('Failed to refresh access token. Please reconnect Google Drive.');
        }
    }

    return google.drive({ version: 'v3', auth: oauth2Client });
}

// Upload file to Google Drive (reusable function for direct file uploads)
export const uploadFileToGoogleDrive = async (phoneNumber, fileStream, fileName, mimeType, options = {}) => {
    try {

        // Get Google Drive client (it will normalize phone number internally)
        const drive = await getDriveClient(phoneNumber);

        const userFolders = await prisma.user.findUnique({
            where: { phoneNumber: phoneNumber },
            select: { defaultFolderId: true }
        });

        const targetFolderId = options.folderId || userFolders?.defaultFolderId;

        if (!targetFolderId) {
            throw new Error('Folder not found. Please reconnect Google Drive to create the folder.');
        }

        const fileMetadata = {
            name: fileName,
            parents: [targetFolderId], // Upload to WhatsAppBotUploads folder
        };

        const media = {
            mimeType: mimeType || 'application/octet-stream',
            body: fileStream,
        };

        // console.log(`Uploading file: ${fileMetadata.name} to folder: ${targetFolderId}`);

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink, webContentLink',
        });

        // console.log('File uploaded successfully to Google Drive:', response.data.name);

        return {
            folderId:targetFolderId,
            fileId: response.data.id,
            fileName: response.data.name,
            viewLink: response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view`,
            downloadLink: response.data.webContentLink || `https://drive.google.com/uc?export=download&id=${response.data.id}`,
        };
    } catch (error) {
        console.error('Error uploading file to Google Drive:', error);
        throw error;
    }
}