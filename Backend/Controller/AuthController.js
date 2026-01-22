import jwt from "jsonwebtoken";
import bcrypt, { hashSync } from "bcrypt";
import prisma from "../db.js";
import { sendEmail } from "../utils/Utils.js";

export const login = async (req, res) => {
    const { email, password } = req.body;

    let token;
    // console.log("email : ", email);
    // console.log("password : ", password);

    const admin = await prisma.superAdmin.findUnique({ where: { email } })
    if (admin) {

        const isPasswordCorrect = await bcrypt.compare(password, admin.password)

        if (!isPasswordCorrect) {
            return res.status(401).json({ message: "Invalid password.", success: false })
        }

        token = jwt.sign({ userId: admin.id, userType: "Admin" }, process.env.JWT_SECRET, { expiresIn: "1d" })

    }
    else {

        const user = await prisma.admin.findUnique({ where: { email } })

        if (!user) {
            return res.status(401).json({ message: "Customer not found.", success: false })
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password)

        if (!isPasswordCorrect) {
            return res.status(401).json({ message: "Invalid password.", success: false })
        }
        const istTime = new Date(
            new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
        );

        await prisma.admin.update({ where: { email }, data: { lastLogin: istTime } })

        token = jwt.sign({ userId: user.id, userType: "Customer" }, process.env.JWT_SECRET, { expiresIn: "1d" })

    }

    return res.status(200).json({ message: "Login successful.", success: true, token })
}

export const signup = async (req, res) => {
    const { email, password } = req.body;

    // const admin = await prisma.superAdmin.findUnique({ where: { email } })

    // if (admin) {
    //     return res.status(400).json({ message: "Admin already exists in this Email.", success: false })
    // }
    // const hashedPassword = await bcrypt.hash(password, 10)

    // await prisma.superAdmin.create({ data: { email, password: hashedPassword } })

    // return res.status(201).json({ message: "Admin created successfully.", success: true })

    const user = await prisma.admin.findUnique({ where: { email } })

    if (user) {
        return res.status(400).json({ message: "User already exists in this Email.", success: false })
    }
    const hashedPassword = await bcrypt.hash(password, 10)

    await prisma.admin.create({ data: { email, password: hashedPassword } })

    return res.status(201).json({ message: "Customer created successfully.", success: true })


}

export const verifyToken = async (req, res, next) => {
    try {

        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ message: "Authorization header missing", success: false });
        }

        const token = authHeader.split(" ")[1];

        // console.log("token : ", token);

        if (!token) {
            return res.status(401).json({ message: "Token Not Found..", success: false })
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // console.log("decoded : ", decoded);
        req.userid = decoded.userId;
        req.userType = decoded.userType;
        next();
    } catch (error) {

        console.error("❌ JWT Verify Error:", error.message)
        return res.status(401).json({ message: "Unauthorized.", success: false })
    }
}

export const getUserDetails = async (req, res) => {
    try {
        const { userid, userType } = req;

        if (userType === "Admin") {

            const user = await prisma.superAdmin.findUnique({ where: { id: userid } })

            if (!user) {
                return res.status(404).json({ message: "Admin not found", success: false })
            }

            return res.status(200).json({ message: "Admin details", success: true, user })
        }
        else if (userType === "Customer") {
            const admin = await prisma.admin.findUnique({
                where: { id: userid },
                select: {
                    id: true,
                    email: true,
                }
            })

            if (!admin) {
                return res.status(404).json({ message: "User not found", success: false })
            }

            const userData = await prisma.user.findUnique({
                where: { adminId: admin.id },
                select: { phoneNumber: true, userName: true, googleMail: true }
            })

            const responseUser = {
                email: admin.email,
                phoneNumber: userData?.phoneNumber || admin.phoneNumber || null,
                userName: userData?.userName || admin.name || null,
                googleMail: userData?.googleMail || null
            }

            return res.status(200).json({ message: "User details", success: true, user: responseUser })
        }
        else {
            return res.status(400).json({ message: "Invalid user type", success: false })
        }
    } catch (error) {
        return res.status(500).json({ message: "Error getting user details", success: false })
    }
}

// Forget password
export const forgetPassword = async (req, res) => {
    try {
        const { email } = req.body

        if (!email) {
            return res.status(400).json({ message: "Email is required", success: false })
        }

        let user = await prisma.superAdmin.findUnique({ where: { email }, select: { id: true, email: true } })
        let userType = "Admin"

        if (!user) {
            const adminUser = await prisma.admin.findUnique({ where: { email }, select: { id: true, email: true } })
            if (!adminUser) {
                return res.status(404).json({ message: "User not found", success: false })
            }
            user = adminUser
            userType = "Customer"
        }

        const otp = Math.floor(100000 + Math.random() * 900000)

        const emailSent = await sendEmail(email, otp)

        if (!emailSent) {
            return res.status(500).json({ message: "Error sending email", success: false })
        }

        const token = jwt.sign(
            { otp, email, userId: user.id, userType },
            process.env.JWT_SECRET,
            { expiresIn: "10m" }
        )

        return res.status(200).json({ message: "Email sent successfully", success: true, token })
    } catch (error) {
        console.error("Forget password error:", error)
        return res.status(500).json({ message: "Error forgetting password", success: false })
    }
}

// Reset password
export const resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body

        if (!token || !password) {
            return res.status(400).json({ message: "Token, otp and password are required", success: false })
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET)

        const hashedPassword = await bcrypt.hash(password, 10)

        const { userId, userType } = decoded

        if (userType === "Admin") {

            const admin = await prisma.superAdmin.findUnique({ where: { id: userId } })

            if (!admin) {
                return res.status(404).json({ message: "Admin not found", success: false })
            }

            await prisma.superAdmin.update({ where: { id: userId }, data: { password: hashedPassword } })
        }
        else if (userType === "Customer") {

            const customer = await prisma.admin.findUnique({ where: { id: userId } })

            if (!customer) {
                return res.status(404).json({ message: "Customer not found", success: false })
            }

            await prisma.admin.update({ where: { id: userId }, data: { password: hashedPassword } })
        }

        else {
            return res.status(400).json({ message: "Invalid user type", success: false })
        }

        return res.status(200).json({ message: "Password reset successfully", success: true })
    } catch (error) {
        return res.status(500).json({ message: "Error resetting password", success: false })
    }
}

// verify otp 

export const verifyOtp = async (req, res) => {
    try {
        const { token, otp } = req.body

        if (!token || !otp) {
            return res.status(400).json({ message: "Token and otp are required", success: false })
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET)

        if (!decoded) {
            return res.status(400).json({ message: "Invalid token", success: false })
        }

        if (Number(decoded.otp) !== Number(otp)) {
            return res.status(400).json({ message: "Invalid otp", success: false })
        }

        return res.status(200).json({
            message: "Otp verified successfully",
            success: true,
            userId: decoded.userId,
            userType: decoded.userType,
            email: decoded.email
        })
    } catch (error) {
        return res.status(500).json({ message: "Error verifying otp", success: false, error: error.message })
    }
}

// reset password