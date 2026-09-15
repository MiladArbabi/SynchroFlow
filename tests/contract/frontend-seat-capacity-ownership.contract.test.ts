import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function frontendFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return entry.name === 'dist' || entry.name === 'node_modules'
        ? []
        : frontendFiles(absolute);
    }

    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

describe('FINAL-RECON-01B — frontend seat-capacity ownership', () => {
  const membersPage = read(
    'apps/frontend/src/pages/ft2-pages/MembersPage.tsx',
  );
  const useMembers = read(
    'apps/frontend/src/pages/members/useMembers.ts',
  );

  it('does not maintain a frontend tier seat-limit table', () => {
    const frontendRoot = path.join(ROOT, 'apps/frontend/src');

    const offenders = frontendFiles(frontendRoot)
      .filter((file) =>
        /\bTIER_SEAT_LIMIT\b/.test(fs.readFileSync(file, 'utf8')),
      )
      .map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('defines authoritative seat capacity on the members API response', () => {
    expect(useMembers).toMatch(/\bseat_capacity\b/);

    for (const field of [
      'tier',
      'current',
      'base_limit',
      'extra_seats',
      'limit',
    ]) {
      expect(useMembers).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('renders backend seat_capacity instead of counting members as seats', () => {
    expect(membersPage).toMatch(/\bseat_capacity\b/);

    expect(membersPage).not.toMatch(
      /\bseatCount\s*=\s*members\.length\b/,
    );

    // Commercial seat capacity must not be reconstructed from tier policy
    // inside the page. The backend response owns effective capacity,
    // including add-ons and owner exclusion.
    expect(membersPage).not.toMatch(
      /standardLimits\s*\([^)]*\)\.seatLimit/,
    );
  });
});
