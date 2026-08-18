// apps/backend/scripts/run-morning-brief-cycle.mjs
//
// SRC-05b — invoke one morning-brief cycle against compiled output.
//
// Runs under plain node against dist/, which is the same execution model as
// production. ts-node/esm cannot resolve backend-core's wildcard subpath
// exports ("./utils/*.js"), which the brief resolver reaches transitively via
// trustFt2 — real node handles them, so this runner sidesteps the loader
// entirely rather than working around it.
//
// dist/ must be current. `npm run dev` rebuilds it on every change via
// nodemon; otherwise run `npm run build:dev -w apps/backend` first.
//
// WRITES: upserts morning_brief_snapshots for every due shop, exactly as the
// scheduled worker does. Selection (which shops are due) is reported by
// `npm run verify:morning-brief -w apps/backend` — run that first.
//
// Usage:
//   npm run run:morning-brief -w apps/backend -- --confirm=SRC-05B

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root is three levels up from apps/backend/scripts/ — note this differs
// from the src/scripts/ runners, which sit one directory deeper.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const confirmationArg = process.argv.find((arg) => arg.startsWith('--confirm='));
if (confirmationArg?.split('=')[1] !== 'SRC-05B') {
  throw new Error('Requires --confirm=SRC-05B (this writes brief snapshots)');
}

const workerPath = path.resolve(__dirname, '../dist/workers/morning-brief.worker.js');

console.info('[run-brief] invoking runMorningBriefCycle() from dist…');
const { runMorningBriefCycle } = await import(workerPath);
await runMorningBriefCycle();

const db = (await import('@lasyncro/backend-core/db.js')).default;
await db.destroy();
process.exit(0);
