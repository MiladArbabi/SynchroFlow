import { Request, Response } from 'express';
import { issueAuthTokens } from './token.service';
import db from 'api-src/db';

export async function testIssueAccessToken(req: Request, res: Response) {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(404).end();
  }

  const { email } = req.body;

  const user = await db('users').where({ email }).first();
  if (!user) {
    return res.status(404).json({ error: 'user_not_found' });
  }

  const membership = await db('shop_memberships')
    .where({ user_id: user.id })
    .first();

  if (!membership) {
    return res.status(409).json({ error: 'NO_ACTIVE_SHOP_MEMBERSHIP' });
  }

  const { accessToken } = await issueAuthTokens({
    userId: user.id,
    shopId: membership.shop_id,
    actorType: 'shop_user',
    authProvider: 'password',
    shopRoles: [membership.role],
  });

  return res.json({ accessToken });
}
