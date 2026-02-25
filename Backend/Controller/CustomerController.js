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
            select: { id: true, userName: true, phoneNumber: true, status: true }
        })

        if(!userRecord){
            return res.status(200).json({message:"Please upload your documents first", success: true, customerDetails: { customer, documents: [], userRecord: null }})
        }

        const documents = await prisma.userDocument.findMany({
            where: { userId: userRecord.id },
            select: { id: true, fileName: true, metadata: true, mimeType: true, createdAt: true , googleDriveLink:true }
        })

        if(!documents){
            return res.status(200).json({message:"Please upload your documents first", success: true, customerDetails: { customer, documents: [], userRecord: null }})
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

export const checkUserExists = async (req,res) =>{
    try {
        const { phoneNumber } = req.body
        const {userid, userType} = req
        
        if(userType !== "Customer"){
            return res.status(403).json({ message: "Only customers can access these details", success: false })
        }

        console.log("phoneNumber", phoneNumber)

        const user = await prisma.user.findFirst({
            where: { phoneNumber: phoneNumber , adminId: {not: userid}}
        })

        console.log("user", user)

        if(!user){
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