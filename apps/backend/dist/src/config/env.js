"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnvironment = validateEnvironment;
// packages/api/src/config/env.ts
function validateEnvironment() {
    const required = {
        JWT_SECRET: 'string',
        PG_HOST: 'string',
        API_URL: 'url',
        FRONTEND_URL: 'url',
        ENCRYPTION_KEY: 'string',
        PG_PORT: 'number',
        PG_USER: 'string',
        PG_PASSWORD: 'string',
        PG_DATABASE: 'string',
        RABBITMQ_URL: 'url'
    };
    const missing = [];
    const invalid = [];
    for (const [key, type] of Object.entries(required)) {
        const value = process.env[key];
        if (!value) {
            missing.push(key);
            continue;
        }
        if (type === 'url' && !isValidUrl(value)) {
            invalid.push(`${key}: ${value}`);
        }
        else if (type === 'number' && isNaN(Number(value))) {
            invalid.push(`${key}: ${value} (must be a number)`);
        }
    }
    if (missing.length > 0) {
        // FIX: Use singular when only one variable is missing
        const errorMsg = missing.length === 1
            ? `Missing required environment variable: ${missing[0]}`
            : `Missing required environment variables: ${missing.join(', ')}`;
        throw new Error(errorMsg);
    }
    if (invalid.length > 0) {
        // Format: "Invalid URL format for API_URL: not-a-valid-url"
        const errorMsg = invalid.map(item => {
            if (item.includes('(must be a number)')) {
                const [key, value] = item.split(': ');
                return `Invalid number format for ${key}: ${value.replace(' (must be a number)', '')}`;
            }
            else {
                const [key, value] = item.split(': ');
                return `Invalid URL format for ${key}: ${value}`;
            }
        }).join(', ');
        throw new Error(errorMsg);
    }
}
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    }
    catch (_) {
        return false;
    }
}
