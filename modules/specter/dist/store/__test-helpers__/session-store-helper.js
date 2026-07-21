// Keep a compatible helper but use the canonical name `reset`
export function reset(store) {
    // delegate to the real reset() method
    store.reset();
}
// Backwards-compatible export (in case any code still imports clearAll)
export const clearAll = reset;
//# sourceMappingURL=session-store-helper.js.map