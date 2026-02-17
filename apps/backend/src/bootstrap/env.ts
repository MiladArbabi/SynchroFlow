import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveEnvPath(): string {
  let dir = __dirname;

  while (dir !== path.parse(dir).root) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }

  throw new Error('FATAL: .env file not found while bootstrapping environment.');
}

const envPath = resolveEnvPath();
dotenv.config({ path: envPath });

console.log('[ENV] Loaded from:', envPath);
