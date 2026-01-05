//tests/unit/backend/auth/auth.middleware.identity.test.ts
import jwt from 'jsonwebtoken';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { Request, Response } from 'express';

const JWT_SECRET = 'test-secret';

describe('auth.middleware — identity contract', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  const makeReqRes = (token?: string) => {
    const req = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as Partial<Request>;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as Partial<Response>;

    const next = jest.fn();

    return { req: req as Request, res: res as Response, next };
  };

  it('rejects request with no Authorization header', () => {
    const { req, res, next } = makeReqRes();

    authenticateToken(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects token missing userId claim', () => {
    const token = jwt.sign({ shopId: 1 }, JWT_SECRET);
    const { req, res, next } = makeReqRes(token);

    authenticateToken(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'INVALID_TOKEN_PAYLOAD' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects token with non-numeric userId', () => {
    const token = jwt.sign({ userId: 'abc' }, JWT_SECRET);
    const { req, res, next } = makeReqRes(token);

    authenticateToken(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'INVALID_TOKEN_PAYLOAD' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts valid token and populates req.user', () => {
    const token = jwt.sign(
      { userId: 42, shopId: 7, actorType: 'shop_user' },
      JWT_SECRET
    );

    const { req, res, next } = makeReqRes(token);

    authenticateToken(req as any, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(
      expect.objectContaining({
        userId: 42,
        shopId: 7,
        actorType: 'shop_user',
      })
    );
  });
});