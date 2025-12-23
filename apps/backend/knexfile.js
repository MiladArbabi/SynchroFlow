"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
if (process.env.NODE_ENV !== 'production') {
  require('ts-node/register');
}

const path_1 = __importDefault(require("path"));
const config = {
    development: {
        client: 'pg',
        connection: {
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT),
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: path_1.default.join(__dirname, './migrations'),
            extension: 'ts',
        },
    },
    test: {
        client: 'pg',
        connection: {
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT),
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: path_1.default.join(__dirname, './migrations'),
            extension: 'ts',
        },
    },
    production: {
        client: 'pg',
        connection: process.env.DATABASE_URL, // Let the secret handle everything
        migrations: {
            directory: path_1.default.join(__dirname, './migrations'),
            tableName: 'knex_migrations',
            extension: 'js'
        }
    }
};
module.exports = config;
//# sourceMappingURL=knexfile.js.map