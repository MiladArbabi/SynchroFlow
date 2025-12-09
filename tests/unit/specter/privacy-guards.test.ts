// tests/unit/specter/privacy-guards.test.ts
describe('Specter PrivacyGuards (PCD safety)', () => {
  const mockSessionId = 'sess-TEST-123';

  // Helper to mock the sessionIdService used by PrivacyGuards
  function mockSessionIdService() {
    return {
      __esModule: true,
      default: {
        generate: () => mockSessionId
      }
    };
  }

  it('throws PCD_VIOLATION when raw customerId is present', async () => {
    await jest.isolateModulesAsync(async () => {
      // Ensure sessionIdService is mocked before importing PrivacyGuards
      jest.doMock('../../../modules/specter/src/session-id-service', () => mockSessionIdService());

      const { PrivacyGuards } = await import('../../../modules/specter/src/compliance/privacy-guards');

      const rawSession = {
        shopId: 1,
        customerId: 'customer-123',
        landingPage: '/home',
        pagesViewed: ['/p1'],
        exitIntent: false
      };

      let threw = false;
        try {
        PrivacyGuards.normalizeSession(rawSession as any);
        } catch (err: any) {
        threw = /PCD_VIOLATION/.test(String(err && err.message));
        }
        expect(threw).toBe(true);
    });
  });

  it('strips PII query params from landingPage and pagesViewed', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../../modules/specter/src/session-id-service', () => mockSessionIdService());

      const { PrivacyGuards } = await import('../../../modules/specter/src/compliance/privacy-guards');

      const rawSession = {
        shopId: 2,
        landingPage: '/checkout?email=user%40example.com&ref=google',
        pagesViewed: [
          '/product?name=John&address=123MainSt',
          '/search?q=toy&phone=123456'
        ],
        exitIntent: true
      };

      const normalized = PrivacyGuards.normalizeSession(rawSession as any);

      // landingPage should have PII params removed, but keep non-PII (ref)
      expect(normalized.landingPage).toBe('/checkout?ref=google');

      // pagesViewed items must have PII params removed
      expect(normalized.pagesViewed).toContain('/product');
      // second page may keep q but remove phone
      expect(normalized.pagesViewed).toContain('/search?q=toy');

      // sessionId should be provided by mocked sessionIdService
      expect(normalized.sessionId).toBe(mockSessionId);

      // createdAt is present and is an ISO string
      expect(typeof normalized.createdAt).toBe('string');
      expect(new Date(normalized.createdAt).toString()).not.toBe('Invalid Date');
    });
  });

  it('returns deterministic result for equal inputs (idempotence)', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../../modules/specter/src/session-id-service', () => mockSessionIdService());

      const { PrivacyGuards } = await import('../../../modules/specter/src/compliance/privacy-guards');

      const raw = {
        shopId: 3,
        landingPage: '/a?email=one@x.com&other=keep',
        pagesViewed: ['/x?name=Foo', '/y?address=Z'],
        exitIntent: false
      };

      const a = PrivacyGuards.normalizeSession(raw as any);
      const b = PrivacyGuards.normalizeSession(raw as any);

      expect(a.landingPage).toBe(b.landingPage);
      expect(a.pagesViewed).toEqual(b.pagesViewed);
      // sessionId may be regenerated, but normalization should be deterministic in terms of url-cleaning
      expect(a.landingPage).toEqual('/a?other=keep');
    });
  });
});
