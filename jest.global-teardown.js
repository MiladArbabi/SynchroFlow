// jest.global-teardown.js
require('dotenv').config();
const db = require('./apps/backend/dist/src/db').default;
const { connection: queueConnection } = require('./apps/backend/dist/src/queue');

module.exports = async () => {
  if (db) await db.destroy();
  if (queueConnection) await queueConnection.close();
};