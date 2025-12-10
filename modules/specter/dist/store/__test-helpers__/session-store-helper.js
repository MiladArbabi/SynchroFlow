"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearAll = void 0;
exports.reset = reset;
// Keep a compatible helper but use the canonical name `reset`
function reset(store) {
    // delegate to the real reset() method
    store.reset();
}
// Backwards-compatible export (in case any code still imports clearAll)
exports.clearAll = reset;
//# sourceMappingURL=session-store-helper.js.map