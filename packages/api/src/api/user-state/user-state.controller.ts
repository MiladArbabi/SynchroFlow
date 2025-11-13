// packages/api/src/api/user-state/user-state.controller.ts
import { Request, Response } from 'express';
import { UserStateService } from '../../services/user-state.service';

export const getUserState = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId; // Assuming JWT middleware sets this
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userState = await UserStateService.getUserState(userId);
    return res.status(200).json(userState);
  } catch (error) {
    console.error('Error getting user state:', error);
    return res.status(500).json({ error: 'Failed to get user state' });
  }
};

export const updateUserMode = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { mode } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!mode || !['survival', 'growth', 'architect'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    await UserStateService.updatePreferredMode(userId, mode);
    return res.status(200).json({ message: 'Mode updated successfully' });
  } catch (error) {
    console.error('Error updating user mode:', error);
    return res.status(500).json({ error: 'Failed to update user mode' });
  }
};