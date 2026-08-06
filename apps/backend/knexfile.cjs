"use strict";

require('dotenv').config({
  path: require('path').resolve(__dirname, '../../.env')
});

const path = require('path');

module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGMIGRATION_USER ?? process.env.PGUSER,
      password: process.env.PGMIGRATION_PASSWORD ?? process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, './dist/migrations'),
      extension: 'js',
    },
    seeds: {
      directory: path.join(__dirname, './dist/seeds'),
      extension: 'js',
    }
  },
  test: {
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGMIGRATION_USER ?? process.env.PGUSER,
      password: process.env.PGMIGRATION_PASSWORD ?? process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, './dist/migrations'),
      extension: 'js',
    },
    seeds: {
      directory: path.join(__dirname, './dist/seeds'),
      extension: 'js',
    }
  },
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, './dist/migrations'),
      extension: 'js',
    },
  }
};