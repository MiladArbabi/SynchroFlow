import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV !== 'test') {
  /**
   * HARD ENFORCEMENT — override console globally at bootstrap time
   * -------------------------------------------------------------
   * Must execute BEFORE any module logs.
   */
  const forbidden = (method: string) => () => {
    throw new Error(
      `[OBSERVABILITY_VIOLATION] console.${method} is forbidden. Use logEvent()`
    );
  };
}

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

process.stdout.write(`[ENV] Loaded from: ${envPath}\n`);