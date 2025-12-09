// packages/specter/src/session-id-service.ts
// Minimal session id service used by PrivacyGuards. Exported as default so tests can mock it.

export default {
  generate(): string {
    // Simple deterministic-ish id suitable for local/dev usage.
    // Production may replace with a stronger UUID generator service.
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    const ts = Date.now().toString(36);
    return `sess-${ts}-${rand}`;
  }
};
