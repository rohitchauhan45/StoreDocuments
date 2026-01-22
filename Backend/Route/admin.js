import { Router } from "express";
import { ChnageCustomerStatus, getAllCustomer, getLastLoginandRegister, getUserDocuments } from "../Controller/AdminController.js";

const app = Router();

//For get All Customer
app.get('/',getAllCustomer)

//For Update Customer Status
app.put('/:id',ChnageCustomerStatus)

//For get User Documents
app.get('/documents',getUserDocuments)

//For get last login and Register
app.get('/last-login-register',getLastLoginandRegister)

export default app;
