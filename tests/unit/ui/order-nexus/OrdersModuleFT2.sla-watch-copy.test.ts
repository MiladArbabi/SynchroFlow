// SLA-SEM-01 — Watch/Aging is broader than approaching Fulfillment SLA.

import fs from 'fs';
import path from 'path';

const sourcePath = path.join(
  process.cwd(),
  'modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx'
);

describe('OrdersModuleFT2 Watch copy — SLA-SEM-01', () => {
  it('SLA-APPROACH-08 does not call the whole Watch population approaching SLA', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toContain('aging, approaching SLA');
  });
});
