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


 export const getOnboardingProgress = async (req: Request, res: Response) => {
   try {
     const userId = (req as any).user?.userId;
     
     if (!userId) {
       return res.status(401).json({ error: 'Unauthorized' });
     }
 
     const onboardingProgress = await UserStateService.getOnboardingProgress(userId);
     return res.status(200).json(onboardingProgress);
   } catch (error) {
     console.error('Error getting onboarding progress:', error);
     return res.status(500).json({ error: 'Failed to get onboarding progress' });
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

export const getUserProductCosts = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const productCosts = await UserStateService.getUserProductCosts(userId);
    return res.status(200).json(productCosts);
  } catch (error) {
    console.error('Error getting user product costs:', error);
    return res.status(500).json({ error: 'Failed to get product costs' });
  }
};

export const updateUserProductCosts = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { productCosts } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!productCosts || typeof productCosts !== 'object') {
      return res.status(400).json({ error: 'Invalid product costs data' });
    }

    await UserStateService.updateUserProductCosts(userId, productCosts);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error updating user product costs:', error);
    return res.status(500).json({ error: 'Failed to update product costs' });
  }
};