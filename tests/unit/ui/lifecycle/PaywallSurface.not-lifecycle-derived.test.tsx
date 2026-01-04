import fs from 'fs';
import path from 'path';

describe('PaywallSurface — lifecycle separation', () => {
  it('does not import lifecycle or infer paid state', () => {
    const file = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../apps/frontend/src/lifecycle/PaywallSurface.tsx'
      ),
      'utf8'
    );

    expect(file).not.toMatch(/useModuleLifecycle/);
    expect(file).not.toMatch(/useShopLifecycle/);
    expect(file).not.toMatch(/UIModulePhase/);
    expect(file).not.toMatch(/FT1|FT2/);
  });
});
