// SUPPLIERS-UX-POLISH-01
//
// Regression contract for:
//   1. canonical Assign/Reassign Receive modal visual language;
//   2. stable PO lifecycle action-rail geometry;
//   3. lifecycle commit CTAs using the canonical accent hierarchy.
//
// Behavioural Receive assignment/reassignment semantics remain protected by
// SuppliersPortalModuleFT2.receive-reassign-1143.test.tsx.

import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx'
  ),
  'utf8'
);

function ctaBlock(label: string): string {
  const labelIndex = src.indexOf(label);
  if (labelIndex === -1) {
    throw new Error(`CTA label not found: ${label}`);
  }

  const buttonIndex = src.lastIndexOf('<Button', labelIndex);
  const boxButtonIndex = src.lastIndexOf('<Box component="button"', labelIndex);
  const start = Math.max(buttonIndex, boxButtonIndex);

  if (start === -1) {
    throw new Error(`CTA opener not found before: ${label}`);
  }

  return src.slice(start, labelIndex);
}

describe('SUPPLIERS-UX-POLISH-01 / WS-UX-01 S2 — Receive assignment surface', () => {
  it('retires the Assign Receive modal and keeps the dispatch commit CTA Tier 1', () => {
    // WS-UX-01 S2 replaced the EntityDetailModal with a compact popover.
    expect(src).not.toMatch(/assignReceiveOpen/);
    expect(src).not.toMatch(/Work identity/);

    const start = src.indexOf('{/* WS-UX-01 S2 — arrived, no active job');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('{receiveSlow && (', start);
    expect(end).toBeGreaterThan(start);

    const ctaBlock = src.slice(start, end);
    expect(ctaBlock).toMatch(/Receive myself/);
    expect(ctaBlock).toMatch(/bgcolor:\s*'var\(--accent\)'/);
    expect(ctaBlock).toMatch(/color:\s*'var\(--accent-ink\)'/);
  });
});


describe('SUPPLIERS-UX-POLISH-01 — canonical PO creation modal', () => {
  it('uses EntityDetailModal and a Tier-1 Create PO commit CTA', () => {
    const functionStart = src.indexOf('function CreatePoDialog(');
    const functionEnd = src.indexOf(
      '// ─────────────────────────────────────────────\n// PO ACCORDION',
      functionStart
    );

    expect(functionStart).toBeGreaterThan(-1);
    expect(functionEnd).toBeGreaterThan(functionStart);

    const block = src.slice(functionStart, functionEnd);

    expect(block).toMatch(/<EntityDetailModal/);
    expect(block).not.toMatch(/<Dialog open=\{open\}/);
    expect(block).toMatch(/bgcolor:\s*'var\(--accent\)'/);
    expect(block).toMatch(/color:\s*'var\(--accent-ink\)'/);
  });
});

describe('SUPPLIERS-UX-POLISH-01 — stable PO lifecycle action rail', () => {
  it('reserves stable action-row height and vertically aligns lifecycle CTAs', () => {
    const start = src.indexOf('{OPEN_STATUSES.includes(po.status) && (');

    expect(start).toBeGreaterThan(-1);

    const boxStart = src.indexOf('<Box', start);
    const boxEnd = src.indexOf('>', boxStart);
    const openingTag = src.slice(boxStart, boxEnd + 1);

    expect(openingTag).toMatch(/minHeight:\s*32/);
    expect(openingTag).toMatch(/alignItems:\s*'center'/);
  });

  it('Mark as arrived is a canonical workflow CTA, not a success-green action', () => {
    const block = ctaBlock('Mark as arrived');

    expect(block).not.toMatch(/color=["']success["']/);
    expect(block).toMatch(/var\(--accent\)/);
    expect(block).toMatch(/var\(--accent-ink\)/);
  });

  // WS-UX-01 S1 — Mark as sent replaces "Prepare to send" as the Draft
  // primary; Copy for supplier is removed from the product.
  it('Draft Mark as sent is a Tier-1 accent CTA and Prepare to send is gone', () => {
    const start = src.indexOf("{nextAction.kind === 'mark_sent' && (");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('Mark as sent', start));

    expect(block).toMatch(/<Button/);
    expect(block).toMatch(/var\(--accent\)/);
    expect(block).toMatch(/var\(--accent-ink\)/);
    expect(block).toMatch(/handleStatusUpdate\('ordered'\)/);
    expect(src).not.toMatch(/Prepare to send/);
  });

  it('Copy for supplier, its preview modal and clipboard handling are removed', () => {
    expect(src).not.toMatch(/Copy for supplier/);
    expect(src).not.toMatch(/SendPoModal/);
    expect(src).not.toMatch(/navigator\.clipboard/);
  });
});
