import {
  decrypt,
  encrypt,
} from 'api-src/security/encryption.service';

describe('opening inventory cutover encryption context', () => {
  const previousKey =
    process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY =
      'opening-cutover-test-key-that-is-definitely-long-enough';
  });

  afterAll(() => {
    if (previousKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY =
        previousKey;
    }
  });

  it('permits the dedicated opening inventory cutover context', () => {
    const encrypted =
      encrypt('offline-shopify-token');

    expect(
      decrypt(
        encrypted,
        'wms.openingInventoryCutover'
      )
    ).toBe('offline-shopify-token');
  });

  it('continues to reject an unknown decrypt context', () => {
    const encrypted =
      encrypt('offline-shopify-token');

    expect(() =>
      decrypt(
        encrypted,
        'wms.openingInventoryCutover.invalid'
      )
    ).toThrow(
      /Unauthorized decrypt context/
    );
  });
});
