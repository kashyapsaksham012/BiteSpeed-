import { Router } from "express";
import { identifyController } from "../controllers/identifyController";
import { validateIdentify } from "../middleware/validateIdentify";

const router = Router();

router.post("/identify", validateIdentify, identifyController);

export default router;
