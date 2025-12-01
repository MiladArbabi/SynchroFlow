"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const knex_1 = __importDefault(require("knex"));
// Use this import syntax for files that use `module.exports`
const knexfile = __importStar(require("../knexfile"));
const config = knexfile;
// 1. Determine the environment
// The Dockerfile sets this to "production" on Fly.io
const environment = process.env.NODE_ENV || 'development';
// 2. Select the correct configuration
const dbConfig = config[environment];
if (!dbConfig) {
    throw new Error(`FATAL: Knex config for environment "${environment}" not found.`);
}
// 3. Add a check for the *actual* production variable
if (environment === 'production' && !process.env.DATABASE_URL) {
    throw new Error('FATAL: DATABASE_URL environment variable is not set for production.');
}
// 4. Initialize Knex with the *correct* config
const db = (0, knex_1.default)(dbConfig);
// 5. Run the connection test (with better logging)
db.raw('SELECT 1+1 AS result').then(() => {
    console.log(`Database connected successfully in ${environment} mode.`);
}).catch((err) => {
    console.error('!!!!!!!!!!!! DATABASE CONNECTION FAILED !!!!!!!!!!!!');
    console.error(err);
    process.exit(1); // Exit if connection fails
});
exports.default = db;
