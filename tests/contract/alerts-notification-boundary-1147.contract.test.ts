import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/**
 * Strip comments so documentation mentioning a retired concept cannot make
 * an architecture assertion pass or fail accidentally.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('GH-1147 — Alerts is notification history + preferences only', () => {
  const page = codeOnly(
    read('apps/frontend/src/pages/ft2-pages/AlertsPage.tsx'),
  );

  it('exposes only Recent and Settings as the Alerts module destinations', () => {
    expect(page).toMatch(/label:\s*['"]Recent['"]/);
    expect(page).toMatch(/path:\s*['"]\/alerts['"]/);

    expect(page).toMatch(/label:\s*['"]Settings['"]/);
    expect(page).toMatch(/path:\s*['"]\/alerts\/settings['"]/);

    expect(page).not.toMatch(/path:\s*['"]\/alerts\/snoozed['"]/);
    expect(page).not.toMatch(/path:\s*['"]\/alerts\/resolved['"]/);
    expect(page).not.toMatch(/path:\s*['"]\/alerts\/rules['"]/);
  });

  it('does not own operational acknowledge, snooze, resolve, or rule-builder controls', () => {
    expect(page).not.toMatch(/\buseAcknowledgeAlert\b/);
    expect(page).not.toMatch(/\buseSnoozeAlert\b/);
    expect(page).not.toMatch(/\buseResolveAlert\b/);
    expect(page).not.toMatch(/\bAlertRulesPanel\b/);
  });

  it('does not render operational prioritization or exception-management metrics', () => {
    expect(page).not.toMatch(/\bAlertsPulseStrip\b/);
    expect(page).not.toMatch(/\$ at risk/i);
    expect(page).not.toMatch(/\bOldest open\b/i);
    expect(page).not.toMatch(/\bAcknowledged\b/i);
  });
});
