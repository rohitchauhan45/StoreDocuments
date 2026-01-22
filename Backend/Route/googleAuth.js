import { Router } from 'express';
import { googleAuth, googleAuthCallback, getToken, disconnectGoogleDrive } from '../Controller/GoogleAuthController.js'
import { verifyToken } from '../Controller/AuthController.js';
const app = Router()

app.get('/google', googleAuth)
app.get('/callback', googleAuthCallback)
app.get('/token',verifyToken, getToken)
app.delete('/disconnect', verifyToken,disconnectGoogleDrive)

export default app;