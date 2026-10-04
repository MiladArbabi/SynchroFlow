// tests/unit/ui/orders/OrdersOutboundPage.screen-architecture.contract.test.ts
//
// OUTBOUND SLICE A RED — REQUIRED architecture/static contract.
//
// /orders/outbound is an Operational Context screen:
//   [Shipped Orders primary workspace][Shipping State rail]
// composed through the shared OperationalContextShell, with the domain rail
// withdrawn while the global Ops Console is open. Ops Console owns
// cross-workflow attention, so the page keeps no local attention inbox and
// no workflow execution surfaces (carrier handoff confirmation, label
// backfill). Order Detail stays the canonical EntityDetailModal +
// OrderDetailModalBody pair directly in this file
// (ORD-MODAL-FOOTER-STABILITY-1053 parses it here), and export stays the
// shared ExportDrawer scoped to the 'orders-outbound' report.
//
// The shell's internal grid is owned by the shared shell tests and is
// deliberately not asserted here. Plain source-text scan, matching this
// repo's existing *.architecture.contract.test.ts convention.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const PAGE_FILE = 'apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx';

/** Comments may name retired patterns for documentation; code may not. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readCode(): string {
  return stripComments(fs.readFileSync(path.join(REPO, PAGE_FILE), 'utf8'));
}

describe('OrdersOutboundPage — shared screen architecture', () => {
  it('imports OperationalContextShell', () => {
    expect(readCode()).toMatch(
      /\bimport\s+(?:type\s+)?\{[^}]*\bOperationalContextShell\b[^}]*\}\s*from\s*['"][^'"]+['"]/
    );
  });

  it('renders <OperationalContextShell', () => {
    expect(readCode()).toMatch(/<OperationalContextShell\b/);
  });
});

describe('OrdersOutboundPage — canonical Ops Console state', () => {
  it('reads isOpsConsoleOpen through the canonical Config context hook', () => {
    const code = readCode();

    expect(code).toMatch(/\bimport\s+useConfig\s+from\s*['"][^'"]*hooks\/useConfig['"]/);
    expect(code).toMatch(/\buseConfig\s*\(\s*\)/);
    expect(code).toMatch(/\bisOpsConsoleOpen\b/);
  });

  it('wires suppressRail from isOpsConsoleOpen', () => {
    expect(readCode()).toMatch(/\bsuppressRail\s*=\s*\{[^}]*\bisOpsConsoleOpen\b[^}]*\}/);
  });
});

describe('OrdersOutboundPage — canonical shared surfaces stay in this file', () => {
  it('renders EntityDetailModal wrapping OrderDetailModalBody directly', () => {
    const code = readCode();

    expect(code).toMatch(/\bimport\s+\{[^}]*\bEntityDetailModal\b[^}]*\}\s*from\s*['"]@lasyncro\/shared\/ui['"]/);
    expect(code).toMatch(/\bimport\s+\{[^}]*\bOrderDetailModalBody\b[^}]*\}\s*from\s*['"][^'"]*pages\/orders\/OrderDetailModalBody['"]/);
    expect(code).toMatch(/<EntityDetailModal\b[\s\S]*<OrderDetailModalBody\b[\s\S]*<\/EntityDetailModal>/);
  });

  it('keeps the shared ExportDrawer scoped to the orders-outbound report', () => {
    const code = readCode();

    expect(code).toMatch(/\bimport\s+\{[^}]*\bExportDrawer\b[^}]*\}\s*from\s*['"][^'"]*components\/ExportDrawer['"]/);
    // Props may contain arrow functions ("=>"), so bound the element by its
    // self-closing tag rather than by the first ">".
    const drawer = code.match(/<ExportDrawer\b[\s\S]*?\/>/);
    expect(drawer).not.toBeNull();
    expect(drawer![0]).toMatch(/\breportIds\s*=\s*\{\s*\[\s*['"]orders-outbound['"]\s*\]\s*\}/);
  });
});

describe('OrdersOutboundPage — retired local attention and execution surfaces', () => {
  it('has no local "Needs attention" inbox', () => {
    expect(readCode()).not.toMatch(/Needs attention/i);
  });

  it('has no carrier handoff queue or handoff confirmation', () => {
    const code = readCode();

    expect(code).not.toMatch(/\/wms\/outbound\/handoff-queue\b/);
    expect(code).not.toMatch(/\/wms\/batch\/[^'"`]*\/ship\b/);
  });

  it('has no label backfill', () => {
    expect(readCode()).not.toMatch(/\/wms\/orders\/bulk-generate-label\b/);
  });
});
