import fs from 'fs';
import path from 'path';

describe('GH-1217 — global Problem Bin configuration banner retirement', () => {
  const source = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'apps/frontend/src/pages/ft2-pages/WmsOperationsPage.tsx',
    ),
    'utf8',
  );

  it('does not render or own the retired singleton Problem Bin configuration UI', () => {
    expect(source).not.toContain('ProblemBinPrompt');
    expect(source).not.toContain('Problem bin not configured');
    expect(source).not.toContain(
      'Set a physical bin code so operators know where to route exception items.',
    );
    expect(source).not.toContain('problemBinMissing');
    expect(source).not.toContain('handleSaveProblemBin');
  });

  it('does not mutate the legacy problem_bin_location setting from WMS Operations', () => {
    expect(source).not.toContain('problem_bin_location');
    expect(source).not.toContain(
      "axiosInstance.patch('/api/v1/wms/settings'",
    );
  });
});
