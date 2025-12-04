// tests/unit/api/specter.controller.test.ts
import { Request, Response } from 'express';
import db from 'api-src/db';

jest.mock('api-src/db', () => jest.fn());

const mockedDb = db as unknown as jest.Mock;

describe('SpecterConfigController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    // IMPORTANT: do NOT reset modules here – it breaks the db mock wiring
    jest.clearAllMocks();

    statusMock = jest.fn().mockReturnThis();
    jsonMock = jest.fn();

    mockRequest = {} as Partial<Request>;
    mockResponse = {
      status: statusMock,
      json: jsonMock,
    } as Partial<Response>;
  });

  const setUser = (userId: number | null) => {
    (mockRequest as any).user = userId ? { userId } : undefined;
  };

  it('returns 403 when user has no shop', async () => {
    setUser(123);

    const mockWhere = jest.fn().mockReturnThis();
    const mockFirst = jest.fn().mockResolvedValue({ shop_id: null });

    mockedDb.mockImplementation((table: string) => {
      if (table === 'users') {
        return { where: mockWhere, first: mockFirst };
      }
      return { where: jest.fn().mockReturnThis(), first: jest.fn() };
    });

    const { getSpecterConfig } = await import(
      'api-src/api/specter/specter.controller'
    );

    await getSpecterConfig(mockRequest as Request, mockResponse as Response);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'User shop not found.',
    });
  });

  it('returns null config when no config exists', async () => {
    setUser(123);

    const mockUserWhere = jest.fn().mockReturnThis();
    const mockUserFirst = jest.fn().mockResolvedValue({ shop_id: 42 });

    const mockConfigWhere = jest.fn().mockReturnThis();
    const mockConfigFirst = jest.fn().mockResolvedValue(undefined);

    mockedDb.mockImplementation((table: string) => {
      if (table === 'users') {
        return { where: mockUserWhere, first: mockUserFirst };
      }
      if (table === 'specter_shop_configs') {
        return { where: mockConfigWhere, first: mockConfigFirst };
      }
      return { where: jest.fn().mockReturnThis(), first: jest.fn() };
    });

    const { getSpecterConfig } = await import(
      'api-src/api/specter/specter.controller'
    );

    await getSpecterConfig(mockRequest as Request, mockResponse as Response);

    expect(jsonMock).toHaveBeenCalledWith({
      shopId: 42,
      config: null,
    });
  });

  it('returns existing config row', async () => {
    setUser(123);

    const mockUserWhere = jest.fn().mockReturnThis();
    const mockUserFirst = jest.fn().mockResolvedValue({ shop_id: 42 });

    const mockConfigWhere = jest.fn().mockReturnThis();
    const mockConfigFirst = jest.fn().mockResolvedValue({
      id: 1,
      shop_id: 42,
      config_json: { businessStage: 'survival' },
    });

    mockedDb.mockImplementation((table: string) => {
      if (table === 'users') {
        return { where: mockUserWhere, first: mockUserFirst };
      }
      if (table === 'specter_shop_configs') {
        return { where: mockConfigWhere, first: mockConfigFirst };
      }
      return { where: jest.fn().mockReturnThis(), first: jest.fn() };
    });

    const { getSpecterConfig } = await import(
      'api-src/api/specter/specter.controller'
    );

    await getSpecterConfig(mockRequest as Request, mockResponse as Response);

    expect(jsonMock).toHaveBeenCalledWith({
      shopId: 42,
      config: { businessStage: 'survival' },
    });
  });

  it('validates payload on upsert', async () => {
    setUser(123);

    const mockUserWhere = jest.fn().mockReturnThis();
    const mockUserFirst = jest.fn().mockResolvedValue({ shop_id: 42 });

    mockedDb.mockImplementation((table: string) => {
      if (table === 'users') {
        return { where: mockUserWhere, first: mockUserFirst };
      }
      return {
        insert: jest.fn().mockReturnThis(),
        onConflict: jest.fn().mockReturnThis(),
        merge: jest.fn().mockReturnThis(),
        returning: jest.fn(),
      };
    });

    mockRequest.body = { config: 'INVALID' } as any;

    const { upsertSpecterConfig } = await import(
      'api-src/api/specter/specter.controller'
    );

    await upsertSpecterConfig(mockRequest as Request, mockResponse as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error:
        'Invalid config payload. Expected a JSON object under "config".',
    });
  });

  it('upserts config correctly', async () => {
    setUser(123);

    const mockUserWhere = jest.fn().mockReturnThis();
    const mockUserFirst = jest.fn().mockResolvedValue({ shop_id: 42 });

    const mockInsert = jest.fn().mockReturnThis();
    const mockOnConflict = jest.fn().mockReturnThis();
    const mockMerge = jest.fn().mockReturnThis();
    const mockReturning = jest.fn().mockResolvedValue([
      {
        shop_id: 42,
        config_json: { businessStage: 'growth' },
      },
    ]);

    mockedDb.mockImplementation((table: string) => {
      if (table === 'users') {
        return { where: mockUserWhere, first: mockUserFirst };
      }
      if (table === 'specter_shop_configs') {
        return {
          insert: mockInsert,
          onConflict: mockOnConflict,
          merge: mockMerge,
          returning: mockReturning,
        };
      }
      return { where: jest.fn().mockReturnThis(), first: jest.fn() };
    });

    mockRequest.body = {
      config: { businessStage: 'growth' },
    } as any;

    const { upsertSpecterConfig } = await import(
      'api-src/api/specter/specter.controller'
    );

    await upsertSpecterConfig(mockRequest as Request, mockResponse as Response);

    expect(mockInsert).toHaveBeenCalledWith({
      shop_id: 42,
      config_json: { businessStage: 'growth' },
    });

    expect(jsonMock).toHaveBeenCalledWith({
      shopId: 42,
      config: { businessStage: 'growth' },
    });
  });
});
