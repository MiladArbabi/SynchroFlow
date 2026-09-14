import fs from 'fs';
import path from 'path';

describe('commercial billing provider defaults', () => {
  const source = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'apps/frontend/src/contexts/EntitlementsContext.tsx'
    ),
    'utf8'
  );

  it('does not initialize unresolved billing ownership as Stripe', () => {
    expect(source).not.toMatch(
      /useState<string>\(\s*['"]stripe['"]\s*\)/
    );
  });

  it('does not default backend billingProvider payloads to Stripe', () => {
    expect(source).not.toMatch(
      /billingProvider\s*\?\?\s*['"]stripe['"]/
    );
  });
});
