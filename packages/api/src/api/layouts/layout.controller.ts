//packages/api/src/api/layouts/layout.controller.ts
import { Request, Response } from "express";
import * as LayoutService from "./layout.service";

// We'll use a hardcoded user ID for now, as authentication is not yet fully integrated
const MOCK_USER_ID = "default_user";

export const getLayout = async (req: Request, res: Response) => {
  try {
    const { layoutName } = req.params;
    const layout = await LayoutService.findLayout(MOCK_USER_ID, layoutName);

    if (!layout) {
      return res.status(404).json({ message: "Layout not found." });
    }

    res.status(200).json(layout);
  } catch (error) {
    res.status(500).json({ message: "Error fetching layout.", error });
  }
};

export const saveLayout = async (req: Request, res: Response) => {
  try {
    const { layoutName } = req.params;
    const configuration = req.body;

    // Basic validation
    if (!configuration || !configuration.layout || !configuration.activeWidgets) {
        return res.status(400).json({ message: "Invalid layout configuration provided." });
    }

    const savedLayout = await LayoutService.upsertLayout(
      MOCK_USER_ID,
      layoutName,
      configuration
    );

    res.status(200).json(savedLayout);
  } catch (error) {
    res.status(500).json({ message: "Error saving layout.", error });
  }
};