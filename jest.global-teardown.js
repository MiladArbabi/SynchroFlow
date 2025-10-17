// jest.global-teardown.js
require('dotenv').config();
const db = require('./packages/api/dist/src/db').default;
const { connection: queueConnection } = require('./packages/api/dist/src/queue');

module.exports = async () => {
  if (db) await db.destroy();
  if (queueConnection) await queueConnection.close();
};