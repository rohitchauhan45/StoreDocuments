import { Router } from "express";
import { checkUserExists, customerAllPhoneEmail, customerDoc, getCustomerDetail } from "../Controller/CustomerController.js";
import { verifyToken } from "../Controller/AuthController.js";


const app = Router();

//For get Customer Detail
app.get('/',verifyToken,getCustomerDetail)

//For check user exists
app.post('/exists',verifyToken,checkUserExists)

//for get customer all phone email
app.get('/all-phone-email',verifyToken,customerAllPhoneEmail)

//for get customer documents
app.get('/docs',verifyToken,customerDoc)

export default app;