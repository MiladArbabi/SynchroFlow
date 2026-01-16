// apps/backend/src/api/layouts/layout.routes.ts
import { Router } from "express";
import * as LayoutController from "./layout.controller";
import { authenticateToken } from "api-src/middleware/auth.middleware";

const router = Router();

router.get("/:layoutName", authenticateToken, LayoutController.getLayout);
router.post("/:layoutName", authenticateToken, LayoutController.saveLayout);

export default router;