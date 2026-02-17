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
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
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
  }
};
