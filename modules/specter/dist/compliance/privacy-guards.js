// packages/specter/src/compliance/privacy-guards.ts
// Implements PCD guards and URL PII stripping for Specter.
// Matches the locked behavior in the Specter blueprint.
import sessionIdService from '../session-id-service.js';
export class PrivacyGuards {
    static DEFAULT_PII_KEYS = ['email', 'e', 'phone', 'tel', 'name', 'address'];
    static assertNoRawCustomerId(raw) {
        if (raw.customerId) {
            // Throw a consistent error string so callers/tests can detect PCD violations.
            throw new Error('PCD_VIOLATION: Raw customerId found in Specter payload');
        }
    }
    static stripPIIFromUrl(url) {
        // Normalize paths and strip query params with PII keys.
        // If URL parsing fails, return a safe placeholder path.
        let u;
        try {
            // Accept relative paths by providing a base origin.
            u = new URL(url, 'https://dummy.host');
        }
        catch {
            return '/invalid-url';
        }
        // Remove any PII query params
        for (const key of Array.from(u.searchParams.keys())) {
            if (this.DEFAULT_PII_KEYS.includes(key.toLowerCase())) {
                u.searchParams.delete(key);
            }
        }
        const search = u.searchParams.toString();
        return search ? `${u.pathname}?${search}` : u.pathname;
    }
    static normalizeSession(raw) {
        // Enforce PCD guard
        this.assertNoRawCustomerId(raw);
        // Create anonymous session
        const sessionId = sessionIdService.generate();
        // Strip PII from landingPage and pagesViewed
        const landingPage = this.stripPIIFromUrl(raw.landingPage);
        const pagesViewed = Array.isArray(raw.pagesViewed)
            ? raw.pagesViewed.map((p) => this.stripPIIFromUrl(p))
            : [];
        return {
            shopId: raw.shopId,
            sessionId,
            landingPage,
            pagesViewed,
            exitIntent: Boolean(raw.exitIntent),
            createdAt: new Date().toISOString()
        };
    }
}
//# sourceMappingURL=privacy-guards.js.map