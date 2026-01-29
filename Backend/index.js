import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import googleAuthRoutes from './Route/googleAuth.js';
import authRoutes from './Route/Auth.js';
import webhookRoute from './Route/webhook.js'
import adminRoutes from './Route/admin.js'
import customerRoutes from './Route/customer.js'

import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

// Allow multiple origins for CORS
const allowedOrigins = [
	'https://fe2-wp.vercel.app',
	'http://localhost:5173',
	'http://localhost:3000',
	'http://ded3896.inmotionhosting.com',
	'https://ded3896.inmotionhosting.com'
];

// Add frontendUrl from env if it's not already in the list
if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
	allowedOrigins.push(frontendUrl);
}

app.use(cors({ 
	origin: function (origin, callback) {
		// Allow requests with no origin (like mobile apps or curl requests)
		if (!origin) return callback(null, true);
		
		if (allowedOrigins.includes(origin)) {
			callback(null, true);
		} else {
			callback(new Error('Not allowed by CORS'));
		}
	},
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));
app.use(express.json());
app.use(cookieParser());

// Basic health and env diagnostics (does not expose secrets)
app.get('/health', (req, res) => {
	return res.json({ status: 'ok' });
});

app.get('/auth/debug-env', (req, res) => {
	return res.json({
		hasClientId: !!process.env.GOOGLE_CLIENT_ID,
		hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
		redirectUri: process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/auth/google/callback`,
	});
});


// Routes
app.use('/api/googleAuth',googleAuthRoutes)
app.use('/api/auth',authRoutes)
app.use('/api/webhook',webhookRoute)
app.use('/api/admin',adminRoutes)
app.use('/api/customer',customerRoutes)

if (process.env.VERCEL !== '1') {
	app.listen(port, () => {
		console.log(`Backend listening on http://localhost:${port}`);
		console.log('Env loaded:', {
			hasClientId: !!process.env.GOOGLE_CLIENT_ID,
			hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
			frontendUrl,
		});
	});
}

export default app;