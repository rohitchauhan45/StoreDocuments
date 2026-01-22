import { Router } from "express";
import { handleWebhook ,verfyWebhook} from "../Controller/WebhookController.js";

const app = Router()

// POST = receive messages
app.post("/", handleWebhook);

// GET = verification
app.get("/", verfyWebhook);

export default app
