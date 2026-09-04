import fs from 'fs';
import path from 'path';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('PostHog Fly production build environment contract', () => {
  const dockerfile = read('Dockerfile');
  const flyConfig = read('fly.toml');

  test('Docker build declares both frontend PostHog build arguments', () => {
    expect(dockerfile).toMatch(/\bARG VITE_PUBLIC_POSTHOG_KEY\b/);
    expect(dockerfile).toMatch(/\bARG VITE_PUBLIC_POSTHOG_HOST\b/);
  });

  test('Fly production build supplies both PostHog build arguments', () => {
    expect(flyConfig).toMatch(/\[build\.args\]/);
    expect(flyConfig).toMatch(
      /VITE_PUBLIC_POSTHOG_KEY\s*=\s*['"][^'"]+['"]/
    );
    expect(flyConfig).toMatch(
      /VITE_PUBLIC_POSTHOG_HOST\s*=\s*['"]https:\/\/t\.lasyncro\.com['"]/
    );
  });

  test('Vite frontend build receives both PostHog values', () => {
    const buildCommand = dockerfile
      .split('\n')
      .find((line) =>
        line.includes('npm --workspace ./apps/frontend exec -- vite build')
      );

    expect(buildCommand).toBeDefined();
    expect(buildCommand).toContain('VITE_PUBLIC_POSTHOG_KEY=');
    expect(buildCommand).toContain('VITE_PUBLIC_POSTHOG_HOST=');
  });
});
