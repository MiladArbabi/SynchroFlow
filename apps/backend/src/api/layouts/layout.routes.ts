// apps/backend/src/api/layouts/layout.routes.ts
import { Router } from "express";
import * as LayoutController from "./layout.controller.js";
import { authenticateToken } from "@lasyncro/backend-core/middleware/auth.middleware.js";

const router = Router();

router.get("/:layoutName", authenticateToken, LayoutController.getLayout);
router.post("/:layoutName", authenticateToken, LayoutController.saveLayout);

export default router;