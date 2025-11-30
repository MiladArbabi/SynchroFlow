//packages/api/src/api/layouts/layout.controller.ts
import { Request, Response } from "express";
import { User } from 'api-types'; 
import db from "../../db";


// We'll use a hardcoded user ID for now, as authentication is not yet fully integrated
const MOCK_USER_ID = "default_user";

export const getLayout = async (req: Request, res: Response): Promise<void> => {
  const { layoutName } = req.params;
  const userId = req.user?.userId;

    if (!userId) {
      // Should technically be caught by middleware, but good to double-check
      res.status(401).json({ error: 'Unauthorized: User ID not found.' });
      return;
    }
    
  try {
    // 1. Get User's Shop ID
    const user = await db<User>('users').where({ id: userId }).first('shop_id');
    if (!user || !user.shop_id) {
      res.status(404).json({ error: 'Associated shop not found for user.' });
      return;
    }
    const userShopId = user.shop_id;

    // 2. Try to find the layout
    const layout = await db('layouts')
      .where({ shop_id: userShopId, name: layoutName })
      .first();
 
     if (layout) {
      // Layout found - return it
       res.status(200).json(layout);
      } else {
      // Layout not found - check for integrations (Logic for #379)
      const integration = await db('integrations')
        .where({ shop_id: userShopId })
        .first('id'); // Just need to know if one exists

      if (integration) {
        // Integrations exist, return default layout structure
        res.status(200).json({ layout: [], activeWidgets: [] });
      } else {
        // No layout AND no integrations - return 404
        res.status(404).json({ error: `Layout '${layoutName}' not found.` });
      }
    }
  } catch (error) {
    console.error(`Error fetching layout ${layoutName}:`, error);
    res.status(500).json({ message: "Error fetching layout.", error });
  }
};

export const saveLayout = async (req: Request, res: Response) => {
  const { layoutName } = req.params;
  const userId = req.user?.userId;
  const layoutData = req.body; // Assuming layout is in request body

  if (!userId) {
     res.status(401).json({ error: 'Unauthorized: User ID not found.' });
     return;
  }
 
   try {
    // Get User's Shop ID
    const user = await db<User>('users').where({ id: userId }).first('shop_id');
    if (!user || !user.shop_id) {
      res.status(404).json({ error: 'Associated shop not found for user.' });
      return;
    }
    const userShopId = user.shop_id;

     // Use upsert logic: update if exists, insert if not
     await db('layouts')
       .insert({
        shop_id: userShopId, // <-- Use user's shop_id
        name: layoutName, // Assuming layoutName maps directly to 'name' column
         layout: JSON.stringify(layoutData.layout), // Store layout as JSON string
         activeWidgets: JSON.stringify(layoutData.activeWidgets), // Store widgets as JSON string
       })
       .onConflict(['shop_id', 'name']) // Assumes unique constraint on shop_id + name
       .merge(); // Update existing record on conflict
 
     res.status(200).json({ message: `Layout '${layoutName}' saved successfully.` });
  } catch (error) {
     console.error(`Error saving layout ${layoutName}:`, error);
     res.status(500).json({ error: 'Internal server error while saving layout.' });
  }
};