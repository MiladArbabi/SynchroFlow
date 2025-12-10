export interface RawSession {
    shopId: number;
    customerId?: string;
    landingPage: string;
    pagesViewed: string[];
    exitIntent: boolean;
}
export interface AnonymousSession {
    shopId: number;
    sessionId: string;
    landingPage: string;
    pagesViewed: string[];
    exitIntent: boolean;
    createdAt: string;
}
export declare class PrivacyGuards {
    private static readonly DEFAULT_PII_KEYS;
    static assertNoRawCustomerId(raw: RawSession): void;
    static stripPIIFromUrl(url: string): string;
    static normalizeSession(raw: RawSession): AnonymousSession;
}
