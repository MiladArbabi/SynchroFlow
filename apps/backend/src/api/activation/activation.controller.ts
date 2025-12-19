import { Request, Response } from 'express';
import db from 'api-src/db';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import { ActivationVerdict } from '@lasyncro/shared/contracts/activation';

export async function getActivationVerdict(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = (req.user as any).userId;

  const user = await db('users').where({ id: userId }).first();
  if (!user || !user.shop_id) {
    const response: ActivationVerdict = {
      verdict: 'BLOCKED',
      reason: 'NOT_CONNECTED',
    };

    return res.json(response);
  }

  const integration = await db('integrations')
    .where({ shop_id: user.shop_id })
    .first();

  if (!integration || integration.sync_status !== 'COMPLETED') {
    const response: ActivationVerdict = {
      verdict: 'BLOCKED',
      reason: 'NOT_CONNECTED',
    };

    return res.json(response);
  }

  const readinessService = new OnboardingReadinessService();
  
  const readiness = await readinessService.getSnapshot({
    shopId: user.shop_id,
    userId,
    });

  const notReadyModules = readiness.modules.filter(m => !m.isReady);

  if (notReadyModules.length > 0) {
    const blockingModules = notReadyModules.map(m => m.moduleId);

    const response: ActivationVerdict = {
      verdict: 'INTEGRATION_COMPLETE_NOT_READY',
      blockingModules,
    };

    return res.json(response);
  }

  const response: ActivationVerdict = {
    verdict: 'ACTIVE',
    activatedModules: readiness.modules
      .filter(m => m.isReady)
      .map(m => m.moduleId),
  };

  return res.json(response);
}