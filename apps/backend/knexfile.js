"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
if (process.env.NODE_ENV !== 'production') {
    require('ts-node/register');
}
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const path_1 = __importDefault(require("path"));
const config = {
    development: {
        client: 'pg',
        connection: {
            host: process.env.PG_HOST,
            port: Number(process.env.PG_PORT),
            user: process.env.PG_USER,
            password: process.env.PG_PASSWORD,
            database: process.env.PG_DATABASE,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: path_1.default.join(__dirname, './migrations'),
        },
    },
    test: {
        client: 'pg',
        connection: {
            host: process.env.PG_HOST,
            port: Number(process.env.PG_PORT),
            user: process.env.PG_USER,
            password: process.env.PG_PASSWORD,
            database: process.env.PG_DATABASE,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: path_1.default.join(__dirname, './migrations'),
        },
    },
    production: {
        client: 'pg',
        connection: process.env.DATABASE_URL, // Let the secret handle everything
        migrations: {
            directory: path_1.default.join(__dirname, './migrations'),
            tableName: 'knex_migrations',
            extension: 'js' // Also a good idea to change this to 'js'
        }
    }
};
module.exports = config;
//# sourceMappingURL=knexfile.js.map