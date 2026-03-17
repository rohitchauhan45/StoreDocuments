import prisma from "../db.js"

export const getCustomerDetail = async (req, res) => {
    try {
        const { userid, userType } = req
        console.log("userid : ", userid)

        if (!userid) {
            return res.status(400).json({ message: "User id missing in request context", success: false })
        }

        if (userType !== "Customer") {
            return res.status(403).json({ message: "Only customers can access these details", success: false })
        }

        const customer = await prisma.admin.findUnique({
            where: { id: userid },
            select: { id: true, email: true, createdAt: true }
        })

        if (!customer) {
            return res.status(404).json({ message: "Customer not found", success: false })
        }
        console.log("customer email : ", customer.email)

        const userRecord = await prisma.user.findUnique({
            where: { adminId: customer.id },
            select: { id: true, userName: true, phoneNumber: true, status: true, googleMail: true }
        })

        if (!userRecord) {
            return res.status(200).json({ message: "Please upload your documents first", success: true, customerDetails: { customer, documents: [], userRecord: null } })
        }

        const documents = await prisma.userDocument.findMany({
            where: { userId: userRecord.id, googlemail: userRecord.googleMail },
            select: { id: true, fileName: true, metadata: true, mimeType: true, createdAt: true, googleDriveLink: true },
            orderBy: { createdAt: 'desc' }
        })

        if (!documents) {
            return res.status(200).json({ message: "Please upload your documents first", success: true, customerDetails: { customer, documents: [], userRecord: null } })
        }

        const documentsWithFolder = documents.map((doc) => ({
            ...doc,
            folderId: doc.metadata?.folder?.id || null,
            folderName: doc.metadata?.folder?.name || null
        }))

        return res.status(200).json({
            message: "Customer retrived successfully",
            success: true,
            customerDetails: { customer, documents: documentsWithFolder, userRecord }
        })

    } catch (error) {
        console.error("Error getting customer detail:", error)
        return res.status(500).json({ message: "Error getting customer detail", success: false })
    }
}

export const checkUserExists = async (req, res) => {
    try {
        const { phoneNumber } = req.body
        const { userid, userType } = req

        if (userType !== "Customer") {
            return res.status(403).json({ message: "Only customers can access these details", success: false })
        }

        const user = await prisma.user.findFirst({
            where: { phoneNumber: phoneNumber, adminId: { not: userid } }
        })

        if (!user) {
            return res.status(200).json({ message: "User not found", success: true })
        }

        const email = user.googleMail || ""
        const maskedEmail = email.length > 12
            ? `${email.slice(0, 3)}.......${email.slice(-12)}`
            : "***"
        return res.status(200).json({ message: `This phone number already exists with email ${maskedEmail}`, success: false })

    } catch (error) {
        console.error("Error checking user exists:", error)
        return res.status(500).json({ message: "Error checking user exists", success: false })
    }
}

export const customerDoc = async (req, res) => {
    try {
        const { userid } = req
        const { phone, email } = req.query

        // When "All" is selected, frontend sends no param (undefined); treat empty string as no filter
        const phoneFilter = phone && String(phone).trim() ? String(phone).trim() : null
        const emailFilter = email && String(email).trim() ? String(email).trim() : null

        const customer = await prisma.admin.findUnique({
            where: { id: userid },
            select: { id: true, email: true, createdAt: true }
        })

        if (!customer) {
            return res.status(404).json({ message: "Customer not found", success: false })
        }

        const user = await prisma.user.findUnique({
            where: { adminId: customer.id },
            select: { id: true, userName: true, phoneNumber: true, status: true, googleMail: true }
        })

        if (!user) {
            return res.status(404).json({ message: "User not found", success: false })
        }
        let data = {
            docs: [],
            email: "",
            phone: "",
        }

        const withFolder = (docs) =>
            docs.map((doc) => ({
                ...doc,
                folderId: doc.metadata?.folder?.id ?? null,
                folderName: doc.metadata?.folder?.name ?? null
            }))

        if (phoneFilter && emailFilter) {
            const docs = await prisma.userDocument.findMany({
                where: { userId: user.id, phoneNumber: phoneFilter, googlemail: emailFilter },
                select: { id: true, fileName: true, metadata: true, mimeType: true, createdAt: true, googleDriveLink: true }
            })
            data.docs = withFolder(docs)
            data.email = emailFilter
            data.phone = phoneFilter
            return res.status(200).json({ message: "Customer documents", success: true, data })
        }
        if (phoneFilter) {
            const docs = await prisma.userDocument.findMany({
                where: { userId: user.id, phoneNumber: phoneFilter },
                select: { id: true, fileName: true, metadata: true, mimeType: true, createdAt: true, googleDriveLink: true }
            })
            data.docs = withFolder(docs)
            data.phone = phoneFilter
            return res.status(200).json({ message: "Customer documents", success: true, data })
        }
        if (emailFilter) {
            const docs = await prisma.userDocument.findMany({
                where: { userId: user.id, googlemail: emailFilter },
                select: { id: true, fileName: true, metadata: true, mimeType: true, createdAt: true, googleDriveLink: true }
            })
            data.docs = withFolder(docs)
            data.email = emailFilter
            return res.status(200).json({ message: "Customer documents", success: true, data })
        }
        // No phone/email filter (both "All"): return all docs for this customer (userId only)
        const docs = await prisma.userDocument.findMany({
            where: { userId: user.id },
            select: { id: true, fileName: true, metadata: true, mimeType: true, createdAt: true, googleDriveLink: true }
        })
        data.docs = withFolder(docs)
        data.email = user.googleMail
        data.phone = user.phoneNumber
        return res.status(200).json({ message: "Customer documents", success: true, data })

    } catch (error) {
        console.error("Error getting customer documents:", error)
        return res.status(500).json({ message: "Error getting customer documents", success: false })
    }
}

export const customerAllPhoneEmail = async (req, res) => {
    try {
        const { userid } = req
        const customer = await prisma.admin.findUnique({
            where: { id: userid },
            select: { id: true }
        })

        if (!customer) {
            return res.status(404).json({ message: "Customer not found", success: false })
        }
        const user = await prisma.user.findUnique({
            where: { adminId: customer.id },
            select: { id: true }
        })

        const data = await prisma.userDocument.findMany({
            where: { userId: user.id },
            select: { phoneNumber: true, googlemail: true }
        })

        return res.status(200).json({ message: "Customer all phone email", success: true, data })
    } catch (error) {
        console.error("Error getting customer all phone email:", error)
        return res.status(500).json({ message: "Error getting customer all phone email", success: false })
    }
}