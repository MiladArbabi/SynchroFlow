"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractNumericId = void 0;
// packages/api/src/utils/shopifyIdUtils.ts (NEW FILE)
/**
 * Extracts the numeric ID from a Shopify GID string.
 * If the input is already a number string, it returns the input.
 * E.g., 'gid://shopify/Customer/12345' -> '12345'
 * '12345' -> '12345'
 */
const extractNumericId = (id) => {
    // Check if it's a GID format: starts with 'gid://' and contains a trailing number
    const match = id.match(/(\d+)$/);
    return match ? match[1] : id;
};
exports.extractNumericId = extractNumericId;
