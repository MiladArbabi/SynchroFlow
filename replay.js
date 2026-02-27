const amqp = require('amqplib');
const { execSync } = require('child_process');

(async () => {
  const conn = await amqp.connect('amqp://localhost');
  const ch = await conn.createChannel();

  const output = execSync(
    "docker exec synchroflow_db psql -U sf_user -d synchroflow_db -At -c \"SELECT id FROM staged_events ORDER BY id ASC;\""
  ).toString();

  const ids = output.trim().split('\n');

  for (const id of ids) {
    if (!id) continue;
    ch.sendToQueue(
      'events',
      Buffer.from(JSON.stringify({ staged_event_id: Number(id) }))
    );
  }

  await ch.close();
  await conn.close();
})();