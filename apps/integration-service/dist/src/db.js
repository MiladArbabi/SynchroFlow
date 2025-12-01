"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// packages/integration/src/db.ts
const knex_1 = __importDefault(require("knex"));
const knexfile = require("../knexfile");
// This validation should exist in every service that connects to the DB.
const requiredEnvVars = ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    throw new Error(`FATAL: Missing required environment variables: ${missingVars.join(', ')}`);
}
const config = knexfile;
const db = (0, knex_1.default)(config.development);
exports.default = db;
