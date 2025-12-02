"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformPayload = transformPayload;
// A helper function to set a value on a nested path in an object
// e.g., setNestedValue(obj, 'customer.address.city', 'New York')
function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current[key] === undefined) {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
}
function transformPayload(rawPayload, mappingRules) {
    const transformedObject = {};
    for (const rule of mappingRules) {
        // For now, we assume simple, non-nested source paths.
        // We can make this more complex later if needed.
        const sourceValue = rawPayload[rule.source_field_path];
        if (sourceValue !== undefined) {
            setNestedValue(transformedObject, rule.target_field_path, sourceValue);
        }
    }
    return transformedObject;
}
//# sourceMappingURL=transformer.js.map