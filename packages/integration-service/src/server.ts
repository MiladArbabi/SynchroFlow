// packages/integration-service/src/server.ts
import express, { Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.INTEGRATION_PORT || 3001;

app.get('/health', (req: Request, res: Response) => {
  res.status(200).send('Integration service is running!');
});

app.listen(port, () => {
  console.log(`[integration-service]: Server is running at http://localhost:${port}`);
});