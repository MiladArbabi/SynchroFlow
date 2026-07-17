// packages/backend-core/src/utils/ft2Period.ts
import { tierDataWindowSince } from './tierDataWindow.js';
// FT2-ORDER-WINDOW-01: resolveFt2Range previously had no tier
// awareness at all — a Starter/Core shop could request any FT2
// snapshot range, including an explicit custom range reaching years
// back, and receive real data. The live query-layer path
// (orders.service.ts) already enforced tierDataWindowSince correctly;
// this brings the FT2 snapshot path to parity by clamping the
// resolved `from` boundary to the tier's window when the tier is more
// restrictive than the requested range. `tier` defaults to 'starter'
// (most restrictive) so existing callers that don't yet pass a real
// tier — currently only the frozen Customers/Specter modules — fail
// safe rather than silently keeping the old unlimited behavior.
export function resolveFt2Range(range, tier = 'starter') {
    const resolved = (() => {
        if (typeof range === 'string') {
            return resolveFt2PeriodFromPreset({
                preset: range,
            });
        }
        if (range.preset === 'custom') {
            return resolveFt2PeriodFromPreset(range);
        }
        return resolveFt2PeriodFromPreset({
            preset: range.preset,
        });
    })();
    const tierFloor = tierDataWindowSince(tier);
    if (tierFloor && new Date(resolved.from) < tierFloor) {
        return { ...resolved, from: tierFloor.toISOString() };
    }
    return resolved;
}
function assertNever(x) {
    throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
export function resolveFt2PeriodFromPreset(input) {
    const now = new Date();
    // ─────────────────────────────────────────────
    // Custom preset (explicit authority)
    // ─────────────────────────────────────────────
    if (input.preset === 'custom') {
        const from = new Date(input.from);
        const to = new Date(input.to);
        if (isNaN(from.getTime()) || isNaN(to.getTime())) {
            throw new Error('Invalid custom FT2 date range');
        }
        if (from >= to) {
            throw new Error('FT2 custom range requires from < to');
        }
        return {
            from: from.toISOString(),
            to: to.toISOString(),
        };
    }
    // ─────────────────────────────────────────────
    // Semantic presets (FULL-DAY UTC BOUNDARIES)
    // ─────────────────────────────────────────────
    // End of "today" in UTC
    const endOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    let from;
    let to = endOfTodayUtc;
    switch (input.preset) {
        case 'today': {
            from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
            break;
        }
        case 'past_7_days': {
            from = new Date(to);
            from.setUTCDate(from.getUTCDate() - 6);
            from.setUTCHours(0, 0, 0, 0);
            break;
        }
        case 'past_30_days': {
            from = new Date(to);
            from.setUTCDate(from.getUTCDate() - 29);
            from.setUTCHours(0, 0, 0, 0);
            break;
        }
        case 'this_week': {
            const day = to.getUTCDay(); // 0 = Sunday
            const diff = day === 0 ? 6 : day - 1; // ISO week (Mon start)
            from = new Date(to);
            from.setUTCDate(from.getUTCDate() - diff);
            from.setUTCHours(0, 0, 0, 0);
            break;
        }
        case 'last_week': {
            const day = to.getUTCDay();
            const diff = day === 0 ? 6 : day - 1;
            to = new Date(to);
            to.setUTCDate(to.getUTCDate() - diff - 1);
            to.setUTCHours(23, 59, 59, 999);
            from = new Date(to);
            from.setUTCDate(from.getUTCDate() - 6);
            from.setUTCHours(0, 0, 0, 0);
            break;
        }
        case 'this_month': {
            from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1, 0, 0, 0, 0));
            break;
        }
        case 'last_month': {
            from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, 1, 0, 0, 0, 0));
            to = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0, 23, 59, 59, 999));
            break;
        }
        default:
            return assertNever(input);
    }
    return {
        from: from.toISOString(),
        to: to.toISOString(),
    };
}
export function getFt2Period() {
    return resolveFt2PeriodFromPreset({ preset: 'past_30_days' });
}
