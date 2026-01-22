import { Router } from "express";
import { checkUserExists, getCustomerDetail } from "../Controller/CustomerController.js";
import { verifyToken } from "../Controller/AuthController.js";


const app = Router();

//For get Customer Detail
app.get('/',verifyToken,getCustomerDetail)

//For check user exists
app.post('/exists',verifyToken,checkUserExists)

export default app;