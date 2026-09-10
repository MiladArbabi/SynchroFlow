/**
 * GH-1086 / PACK-GATE-01 — permanent Hold-semantics copy & documentation contract.
 *
 * The behaviour is already enforced by
 * tests/integration/wms/pack-gate-1086.test.ts: a rejected pack decision holds
 * the order, keeps it attached to pick_batch_orders, and never returns it to
 * Order Pool or Blocked Orders.
 *
 * This contract protects the half a runtime test cannot see — what the product
 * TELLS people. An owner who is told the order will be "re-queued" will go
 * looking for it in Order Pool, where it will never appear. Stale copy and
 * stale documentation are a real operational defect, not cosmetics.
 *
 * LEGACY TOKEN
 * ------------
 * 'hold_and_requeue' is a wire/storage/API value with existing rows and
 * existing clients. It is deliberately NOT renamed. This contract pins it in
 * place, and separately requires that no human-readable copy repeats the
 * obsolete promise the token's name still carries.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const PROBLEM_CENTER_PAGE = 'apps/frontend/src/pages/ft2-pages/ProblemCenterPage.tsx';
const PACK_DECISION_SERVICE = 'apps/backend/src/services/wms/packDecision.service.ts';
const WMS_CONTROLLER = 'apps/backend/src/api/wms/wms.controller.ts';

/** The legacy wire token, allowed to appear anywhere. */
const LEGACY_TOKEN = 'hold_and_requeue';
const REQUEUE = /re-?queue/i;

function read(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
}

function source(relative: string): ts.SourceFile {
  return ts.createSourceFile(
    path.resolve(__dirname, '../..', relative),
    read(relative),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function nodes(root: ts.Node, predicate: (n: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    if (predicate(n)) found.push(n);
    ts.forEachChild(n, walk);
  };
  walk(root);
  return found;
}

/**
 * Every human-readable string the file can render, including the text segments
 * of template literals with substitutions — which is exactly where the Hold
 * confirmation copy lives.
 */
function literals(root: ts.SourceFile): string[] {
  const KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ]);
  return nodes(root, (n) => KINDS.has(n.kind)).map(
    (n) => (n as ts.LiteralLikeNode).text
  );
}

/** Copy that merely names the legacy wire token is not a promise to a human. */
function humanCopy(root: ts.SourceFile): string[] {
  return literals(root).filter((text) => !text.includes(LEGACY_TOKEN));
}

/**
 * Documented outcome mappings for the `rejected` decision, e.g.
 *   " * rejected                          → order is HELD, not packable"
 */
function rejectedOutcomeLines(relative: string): string[] {
  return read(relative)
    .split('\n')
    .filter((line) => /\brejected\b/i.test(line) && /→/.test(line));
}

// ── USER-FACING COPY ────────────────────────────────────────────────────────

it('Problem Center Hold confirmation never promises the order will be re-queued', () => {
  const offending = humanCopy(source(PROBLEM_CENTER_PAGE)).filter((t) =>
    REQUEUE.test(t)
  );
  expect(offending).toEqual([]);
});

it('Problem Center Hold confirmation states the order stays out of packing, and keeps the Hold order action', () => {
  const copy = humanCopy(source(PROBLEM_CENTER_PAGE));

  // The owner is told what actually happens: it stays held, it does not pack.
  expect(
    copy.some((t) => /remain on hold/i.test(t) && /will not move to packing/i.test(t))
  ).toBe(true);

  // The action itself is unchanged.
  expect(copy.some((t) => /^Hold order$/.test(t.trim()))).toBe(true);

  // The owner is never sent looking in Order Pool or Blocked Orders.
  expect(copy.filter((t) => /order pool|blocked orders/i.test(t))).toEqual([]);
});

it('Pack decision notification does not tell the operator the order is being re-queued', () => {
  const offending = humanCopy(source(PACK_DECISION_SERVICE)).filter((t) =>
    REQUEUE.test(t)
  );
  expect(offending).toEqual([]);
});

it('Pack decision notification asks to hold the order', () => {
  expect(
    humanCopy(source(PACK_DECISION_SERVICE)).some((t) => /^Hold order\?$/.test(t.trim()))
  ).toBe(true);
});

// ── BACKEND DOCUMENTATION ───────────────────────────────────────────────────

it.each([
  ['pack decision service', PACK_DECISION_SERVICE],
  ['WMS controller', WMS_CONTROLLER],
])(
  '%s documents a rejected decision as a hold, never as a requeue or Order Pool return',
  (_label, relative) => {
    const lines = rejectedOutcomeLines(relative);

    // The outcome mapping must still be documented at all.
    expect(lines.length).toBeGreaterThan(0);

    expect(
      lines.filter((l) => REQUEUE.test(l) || /order pool/i.test(l))
    ).toEqual([]);

    for (const line of lines) {
      expect(line).toMatch(/\b(hold|held)\b/i);
    }
  }
);

// ── LEGACY WIRE TOKEN PRESERVED ─────────────────────────────────────────────

it('PackDecisionQuestion still carries the legacy hold_and_requeue token', () => {
  const alias = nodes(
    source(PACK_DECISION_SERVICE),
    (n) => ts.isTypeAliasDeclaration(n) && n.name.getText() === 'PackDecisionQuestion'
  ) as ts.TypeAliasDeclaration[];

  expect(alias).toHaveLength(1);
  expect(ts.isUnionTypeNode(alias[0].type)).toBe(true);

  const members = (alias[0].type as ts.UnionTypeNode).types
    .map((t) => t.getText().replace(/['"]/g, ''))
    .sort();

  expect(members).toEqual(['hold_and_requeue', 'ship_partial']);
});

it('the raise-decision route still accepts the legacy hold_and_requeue value', () => {
  const accepted = (
    nodes(
      source(WMS_CONTROLLER),
      (n) =>
        ts.isArrayLiteralExpression(n) &&
        n.elements.length === 2 &&
        n.elements.every(ts.isStringLiteral) &&
        n.elements.some((e) => (e as ts.StringLiteral).text === 'ship_partial')
    ) as ts.ArrayLiteralExpression[]
  ).map((a) =>
    a.elements.map((e) => (e as ts.StringLiteral).text).sort()
  );

  expect(accepted).toContainEqual(['hold_and_requeue', 'ship_partial']);
});
