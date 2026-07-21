// modules/specter/src/store/session-store-memory.ts
// In-memory session + event store used for unit tests / local runs.
// Uses Node's native crypto.randomUUID() instead of uuid package.
import { randomUUID } from 'crypto';
const sessions = {};
const events = {};
export function createInMemorySpecterStore() {
    return {
        async setSession(shopId, sessionState) {
            sessions[shopId] = JSON.parse(JSON.stringify(sessionState));
        },
        async getSession(shopId) {
            const s = sessions[shopId];
            return s ? JSON.parse(JSON.stringify(s)) : null;
        },
        async patchSession(shopId, delta) {
            const current = sessions[shopId] || {};
            const merged = { ...current, ...delta };
            sessions[shopId] = JSON.parse(JSON.stringify(merged));
            return JSON.parse(JSON.stringify(sessions[shopId]));
        },
        async deleteSession(shopId) {
            delete sessions[shopId];
        },
        async appendEvent(shopId, event) {
            const ev = {
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                type: event.type,
                payload: event.payload ?? null,
            };
            events[shopId] = events[shopId] || [];
            // newest-first semantics (like LPUSH)
            events[shopId].unshift(ev);
            // trim to a sane limit to avoid unbounded growth in tests
            if (events[shopId].length > 500)
                events[shopId].length = 500;
            return ev;
        },
        async getRecentEvents(shopId, limit = 50) {
            const list = events[shopId] || [];
            return list.slice(0, limit).map(e => ({ ...e }));
        },
        async close() {
            // no-op for in-memory
            return;
        },
    };
}
//# sourceMappingURL=session-store-memory.js.map