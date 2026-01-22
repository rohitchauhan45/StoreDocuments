import prisma from "../db.js"

export const getAllCustomer = async (req, res) => {
    try {
        const { userName } = req.query

        const customers = await prisma.user.findMany({
            where: {
                userName: {
                    contains: userName,
                    mode: 'insensitive'
                },
            },
            select: {
                id: true,
                phoneNumber: true,
                userName: true,
                createdAt: true,
                status: true,    // ✅ your enum field
                _count: {
                    select: {
                        documents: true  // ✅ count of documents
                    }
                }
            },
            orderBy:{
                documents:{
                    _count:"desc"
                }
            }
        })

        return res.status(200).json({
            success: true,
            customers
        })
    } catch (error) {
        console.error("Error getting all customers:", error)
        return res.status(500).json({ message: "getting Customer error", success: false })
    }
}

export const ChnageCustomerStatus = async (req, res) => {

    try {
        const { id } = req.params
        const customerId = parseInt(id, 10)

        if (isNaN(customerId)) {
            return res.status(400).json({ message: "Invalid customer ID", success: false })
        }

        const customer = await prisma.user.findUnique({ where: { id: customerId } })

        if (!customer) {
            return res.status(404).json({ message: "Customer not found", success: false })
        }

        const oldStatus = customer.status
        const newStatus = oldStatus === "active" ? "inactive" : "active"

        if (oldStatus === "active") {
            await prisma.user.update({ where: { id: customerId }, data: { status: "inactive" } })
        }
        else {
            await prisma.user.update({ where: { id: customerId }, data: { status: "active" } })
        }

        return res.status(200).json({ message: `Customer status changed to ${newStatus} successfully`, success: true })
    } catch (error) {
        return res.status(500).json({ message: "Changing Customer status error", success: false })
    }
}

export const getUserDocuments = async (req, res) => {
    const { time } = req.query;

    try {
        let dateFilter = null;
        const now = new Date();

        // ---------------- TODAY ----------------
        if (time === "today") {
            const start = new Date();
            start.setHours(0, 0, 0, 0);

            const end = new Date();
            end.setHours(23, 59, 59, 999);

            dateFilter = { gte: start, lte: end };
        }

        // ---------------- WEEK ----------------
        if (time === "week") {
            const today = new Date();
            const day = today.getDay();   // Sunday = 0

            const diff = today.getDate() - day + (day === 0 ? -6 : 1);

            const weekStart = new Date(today.setDate(diff));
            weekStart.setHours(0, 0, 0, 0);

            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);

            dateFilter = { gte: weekStart, lte: weekEnd };
        }

        // ---------------- MONTH ----------------
        if (time === "month") {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            monthStart.setHours(0, 0, 0, 0);
            monthEnd.setHours(23, 59, 59, 999);

            dateFilter = { gte: monthStart, lte: monthEnd };
        }

        // FETCH DOCUMENTS
        const docs = await prisma.userDocument.findMany({
            ...(dateFilter ? { where: { createdAt: dateFilter } } : {}),
            select: { createdAt: true },
            orderBy: { createdAt: "asc" }
        })

        let graphData = [];

        // --------------------------------------
        // GROUPING LOGIC FOR GRAPH DATA
        // --------------------------------------

        // ------------- TODAY → HOURLY --------------
        if (time === "today") {
            const hourly = Array.from({ length: 24 }, (_, hour) => ({
                hour: `${hour}:00`,
                count: 0
            }));

            docs.forEach(doc => {
                const hr = new Date(doc.createdAt).getHours();
                hourly[hr].count++;
            });

            graphData = hourly;
        }

        // ------------- WEEK → DAYS --------------
        if (time === "week") {
            const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
            const weekData = days.map(day => ({ day, count: 0 }));

            docs.forEach(doc => {
                const index = new Date(doc.createdAt).getDay();
                const dayIndex = index === 0 ? 6 : index - 1; // Sunday → last
                weekData[dayIndex].count++;
            });

            graphData = weekData;
        }

        // ------------- MONTH → DATES --------------
        if (time === "month") {
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

            const monthData = Array.from({ length: daysInMonth }, (_, i) => ({
                date: (i + 1).toString(),
                count: 0
            }));

            docs.forEach(doc => {
                const day = new Date(doc.createdAt).getDate();
                monthData[day - 1].count++;
            });

            graphData = monthData;
        }

        return res.status(200).json({
            success: true,
            totalDocuments: docs.length,
            graphData
        })

    } catch (error) {
        console.error("Error getting user documents:", error)
        return res.status(500).json({
            message: "Error getting user documents",
            success: false
        })
    }
}

export const getLastLoginandRegister = async (req, res) => {
    const { time } = req.query;

    try {
        let dateFilter = null;
        const now = new Date();

        // ---------------- TODAY ----------------
        if (time === "today") {
            const start = new Date();
            start.setHours(0, 0, 0, 0);

            const end = new Date();
            end.setHours(23, 59, 59, 999);

            dateFilter = { gte: start, lte: end };
        }

        // ---------------- WEEK ----------------
        if (time === "week") {
            const today = new Date();
            const day = today.getDay(); // Sunday = 0

            const diff = today.getDate() - day + (day === 0 ? -6 : 1);

            const weekStart = new Date(today.setDate(diff));
            weekStart.setHours(0, 0, 0, 0);

            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);

            dateFilter = { gte: weekStart, lte: weekEnd };
        }

        // ---------------- MONTH ----------------
        if (time === "month") {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            monthStart.setHours(0, 0, 0, 0);
            monthEnd.setHours(23, 59, 59, 999);

            dateFilter = { gte: monthStart, lte: monthEnd };
        }

        // ------------------------------------------------
        // FETCH LOGIN + REGISTRATION DATA
        // ------------------------------------------------
        const [logins, registrations] = await Promise.all([
            prisma.admin.findMany({
                ...(dateFilter ? { where: { lastLogin: dateFilter } } : {}),
                select: { lastLogin: true },
                orderBy: { lastLogin: "asc" }
            }),
            prisma.admin.findMany({
                ...(dateFilter ? { where: { createdAt: dateFilter } } : {}),
                select: { createdAt: true },
                orderBy: { createdAt: "asc" }
            }),
        ]);

        let graphData = [];

        // ---------------- TODAY → HOURLY ----------------
        if (time === "today") {
            const hourly = Array.from({ length: 24 }, (_, hour) => ({
                hour: `${hour.toString().padStart(2, "0")}:00`,
                logins: 0,
                registrations: 0
            }));

            logins.forEach(rec => {
                if (rec.lastLogin) {
                    const hr = new Date(rec.lastLogin).getHours();
                    hourly[hr].logins += 1;
                }
            });

            registrations.forEach(rec => {
                if (rec.createdAt) {
                    const hr = new Date(rec.createdAt).getHours();
                    hourly[hr].registrations += 1;
                }
            });

            graphData = hourly;
        }

        // ---------------- WEEK → DAYS ----------------
        if (time === "week") {
            const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

            const weekData = days.map(day => ({
                day,
                logins: 0,
                registrations: 0
            }));

            logins.forEach(rec => {
                const index = new Date(rec.lastLogin).getDay();
                const dayIndex = index === 0 ? 6 : index - 1; // Sunday → last
                weekData[dayIndex].logins++;
            });

            registrations.forEach(rec => {
                const index = new Date(rec.createdAt).getDay();
                const dayIndex = index === 0 ? 6 : index - 1;
                weekData[dayIndex].registrations++;
            });

            graphData = weekData;
        }

        // ---------------- MONTH → DATES ----------------
        if (time === "month") {
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

            const monthData = Array.from({ length: daysInMonth }, (_, i) => ({
                date: (i + 1).toString().padStart(2, "0"),
                logins: 0,
                registrations: 0
            }));

            logins.forEach(rec => {
                const day = new Date(rec.lastLogin).getDate();
                monthData[day - 1].logins++;
            });

            registrations.forEach(rec => {
                const day = new Date(rec.createdAt).getDate();
                monthData[day - 1].registrations++;
            });

            graphData = monthData;
        }

        return res.status(200).json({
            success: true,
            totalLogins: logins.length,
            totalRegistrations: registrations.length,
            graphData
        });

    } catch (error) {
        console.error("Error getting login/register stats:", error);
        return res.status(500).json({
            success: false,
            message: "Error getting login/register stats"
        });
    }
};
