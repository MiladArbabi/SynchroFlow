"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanonicalMappingOrchestrator = void 0;
const lodash_1 = require("lodash");
class CanonicalMappingOrchestrator {
    constructor() { }
    /**
     * Main entry: apply mapping rules to staged_event.raw_payload
     */
    async applyMappings(rawPayload, rules) {
        if (!rawPayload || typeof rawPayload !== 'object') {
            throw new Error('Invalid raw payload');
        }
        const output = {};
        for (const rule of rules) {
            const { source, target, required, literal } = rule;
            let value;
            if (literal !== undefined) {
                value = literal;
            }
            else {
                value = (0, lodash_1.get)(rawPayload, source);
            }
            if (required && (value === undefined || value === null)) {
                throw new Error(`Required field missing: ${target}`);
            }
            this.assignDeep(output, target, value);
        }
        // Minimal top-level validation (tests expect this)
        if (!output.id)
            throw new Error('Missing canonical id');
        if (!output.shopId)
            throw new Error('Missing canonical shopId');
        return output;
    }
    /**
     * Assigns deeply to an object path, e.g.:
     *   assignDeep(obj, "customer.address.city", "NYC")
     */
    assignDeep(obj, path, value) {
        const parts = path.split('.');
        let current = obj;
        for (let i = 0; i < parts.length; i++) {
            const key = parts[i];
            const isLast = i === parts.length - 1;
            if (isLast) {
                current[key] = value;
            }
            else {
                if (current[key] === undefined)
                    current[key] = {};
                current = current[key];
            }
        }
    }
}
exports.CanonicalMappingOrchestrator = CanonicalMappingOrchestrator;
//# sourceMappingURL=canonical-mapping-orchestrator.service.js.map