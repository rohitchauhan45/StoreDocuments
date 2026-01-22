import { Router } from "express";
import { forgetPassword, getUserDetails, login, resetPassword, signup, verifyOtp, verifyToken } from "../Controller/AuthController.js"

const app = Router();

//For user Login
app.post('/login',login)

//For user Signup
app.post('/signup',signup)

app.get('/user',verifyToken,getUserDetails)

// Forget password
app.post('/forget-password',forgetPassword)

// Verify otp
app.post('/verify-otp',verifyOtp)

// Reset password
app.post('/reset-password',resetPassword)

export default app;
