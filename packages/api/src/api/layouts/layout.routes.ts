//packages/api/src/api/layouts/layout.routes.ts
import { Router } from "express";
import * as LayoutController from "./layout.controller";

const router = Router();

router.get("/:layoutName", LayoutController.getLayout);
router.post("/:layoutName", LayoutController.saveLayout);

export default router;