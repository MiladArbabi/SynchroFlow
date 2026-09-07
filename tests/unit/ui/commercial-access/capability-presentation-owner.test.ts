import fs from 'fs';
import path from 'path';

const frontendRoot = path.join(process.cwd(), 'apps/frontend/src');
const registryPath = path.join(frontendRoot, 'commercial/capabilityPresentation.ts');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

it('the frontend presentation registry is the single production owner of all four Sourcing benefits', () => {
  const sources = sourceFiles(frontendRoot).map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));
  const benefits = [
    'Prioritize sourcing work from current inventory demand',
    'Compare supplier recommendations by product',
    'Use supplier-product preferences',
    'Accumulate reorder quantities against MOQ',
  ];

  for (const benefit of benefits) {
    const occurrences = sources.flatMap(({ file, source }) =>
      Array.from({ length: source.split(benefit).length - 1 }, () => file),
    );
    expect(occurrences).toEqual([registryPath]);
  }
});
