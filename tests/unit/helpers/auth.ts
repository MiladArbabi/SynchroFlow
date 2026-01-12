import jwt from 'jsonwebtoken';

export function issueTestToken(input: {
  userId: number;
  shopId: number;
}) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET missing in test env');
  }

  return jwt.sign(
    {
      iss: 'auth.lasyncro.com',
      aud: 'api.lasyncro.com',
      actor_type: 'shop_user',
      user_id: input.userId,
      shop_id: input.shopId,
      shop_roles: ['owner'],
      scopes: [],
      session_id: 'test-session',
      token_version: 1,
      auth_provider: 'password',
    },
    jwtSecret,
    { expiresIn: '15m' }
  );
}
