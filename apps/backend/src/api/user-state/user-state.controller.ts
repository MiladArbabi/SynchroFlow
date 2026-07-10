// apps/backend/src/api/user-state/user-state.controller.ts
import { Request, Response } from 'express';
import { UserStateService, OrdersPerMonthSegment } from '../../services/user-state.service.js';

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

 export const updateUserState = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { orders_per_month_segment } = req.body as {
      orders_per_month_segment?: OrdersPerMonthSegment;
    };

    const allowed: OrdersPerMonthSegment[] = [
      '1-50',
      '51-200',
      '201-500',
      '501-1000',
      '1000+',
    ];

    if (!orders_per_month_segment || !allowed.includes(orders_per_month_segment)) {
      return res.status(400).json({
        error: 'Invalid orders_per_month_segment',
        allowedValues: allowed,
      });
    }

    // Persist in user_states
    await UserStateService.updateOrdersPerMonthSegment(userId, orders_per_month_segment);

    // Return the fresh full user state snapshot
    const userState = await UserStateService.getUserState(userId);
    return res.status(200).json(userState);
  } catch (error) {
    console.error('Error updating user state:', error);
    return res.status(500).json({ error: 'Failed to update user state' });
  }
};

export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { firstName, lastName } = req.body as {
      firstName?: string;
      lastName?: string;
    };

    await UserStateService.updateProfile(userId, { firstName, lastName });

    const userState = await UserStateService.getUserState(userId);
    return res.status(200).json(userState);
  } catch (error) {
    console.error('Error updating user profile:', error);
    return res.status(500).json({ error: 'Failed to update user profile' });
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


// T3 — spotlight registry: valid keys must match onboarding playbook §2.
const VALID_SPOTLIGHT_KEYS = new Set([
  'order_flow_wave',
  'order_flow_blocked',
  'demand_reorder',
]);

export const dismissSpotlight = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const key = String(req.params.key);
    if (!VALID_SPOTLIGHT_KEYS.has(key)) {
      return res.status(400).json({ error: 'Invalid spotlight key', validKeys: [...VALID_SPOTLIGHT_KEYS] });
    }

    await UserStateService.dismissSpotlight(userId, key);
    return res.status(200).json({ dismissed: true, key });
  } catch (error) {
    console.error('[SPOTLIGHT_DISMISS_FAILED]', error);
    return res.status(500).json({ error: 'Failed to dismiss spotlight' });
  }
};

export const getActivationEvents = async (req: Request, res: Response) => {
  try {
    const shopId = (req as any).user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const events = await UserStateService.getActivationEvents(shopId);
    return res.status(200).json(events);
  } catch (error) {
    console.error('[ACTIVATION_EVENTS_FAILED]', error);
    return res.status(500).json({ error: 'Failed to fetch activation events' });
  }
};

// T6 — checklist dismissal state: reads checklist:completed + all spotlight:dismissed:* keys.
export const getOnboardingFlags = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const rows = await UserStateService.getOnboardingFlags(userId);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[ONBOARDING_FLAGS_FAILED]', error);
    return res.status(500).json({ error: 'Failed to fetch onboarding flags' });
  }
};

export const dismissChecklist = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    await UserStateService.dismissChecklist(userId);
    return res.status(200).json({ dismissed: true });
  } catch (error) {
    console.error('[CHECKLIST_DISMISS_FAILED]', error);
    return res.status(500).json({ error: 'Failed to dismiss checklist' });
  }
};