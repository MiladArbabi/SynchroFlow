// WMS-CTA-CONSISTENCY-34
//
// Regression contract for WMS CTA tier styling. Rendering the full
// WmsModuleFT2 / CountingSessionPage pages requires extensive fixture data
// (order/pick/pack/stow/receive props) unrelated to this issue, so per the
// approved test strategy this suite instead:
//
//   1. Renders the exported, WMS-local style constants directly on a real
//      MUI <Button> (the smallest real unit that can prove the token
//      contract — see CountingSessionPage.tsx's `toHaveStyle` spike, which
//      confirmed jest-dom correctly resolves emotion-generated `sx` output
//      for literal `var(--token)` strings, both positively and negatively).
//   2. Reads the two page files' source text, scoped narrowly to each named
//      CTA's own block (never a whole-file match), to prove the actual
//      call site references — or, for secondary controls, does NOT
//      reference — that exact constant. This is the "exact CTA style
//      constants introduced for this issue" fallback the test strategy
//      pre-approved, not a broad architecture/string test.
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import Button from '@mui/material/Button';
import {
  WMS_TIER1_ACTION_SX,
  wmsTier2SelectionSx,
} from '../../../../modules/wms/src/ui/pages/CountingSessionPage';

const countingSessionSrc = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../../modules/wms/src/ui/pages/CountingSessionPage.tsx'
  ),
  'utf8'
);
const wmsModuleSrc = fs.readFileSync(
  path.resolve(__dirname, '../../../../modules/wms/src/ui/pages/WmsModuleFT2.tsx'),
  'utf8'
);

/**
 * Returns the source slice from `label`'s own JSX open tag back to the
 * nearest preceding `<Button` (or `<Box component="button"`), so the
 * assertion is scoped to that one control's props — never the whole file.
 */
function ctaBlock(src: string, label: string): string {
  const labelIndex = src.indexOf(label);
  if (labelIndex === -1) {
    throw new Error(`CTA label not found in source: ${label}`);
  }
  const openers = ['<Button', '<Box'];
  let start = -1;
  for (const opener of openers) {
    const idx = src.lastIndexOf(opener, labelIndex);
    if (idx > start) start = idx;
  }
  if (start === -1) {
    throw new Error(`No enclosing <Button>/<Box> found before label: ${label}`);
  }
  return src.slice(start, labelIndex);
}

describe('CONTRACT-WMS-CTA-01 — mutation/workflow CTAs use the Tier-1 token pair', () => {
  it('WMS_TIER1_ACTION_SX itself resolves to var(--accent) / var(--accent-ink) on a real Button', () => {
    render(<Button sx={WMS_TIER1_ACTION_SX}>Tier 1 probe</Button>);
    const btn = screen.getByText('Tier 1 probe');
    expect(btn).toHaveStyle({ backgroundColor: 'var(--accent)' });
    expect(btn).toHaveStyle({ color: 'var(--accent-ink)' });
  });

  it.each([
    ['Confirm bin', countingSessionSrc],
    ['Next Bin', countingSessionSrc],
    // Handler is handleFinishBin — the "Finish Bin" copy assumed during the
    // WMS-CTA-CONSISTENCY-34 audit does not match the actual rendered label;
    // corrected here (see DEVIATIONS).
    ['Done With This Bin', countingSessionSrc],
    ['Finish Count', countingSessionSrc],
    ['Record finding', countingSessionSrc],
    ['Skip item', countingSessionSrc],
    ['None here', countingSessionSrc],
  ])('%s references WMS_TIER1_ACTION_SX at its call site', (label, src) => {
    expect(ctaBlock(src, label)).toMatch(/WMS_TIER1_ACTION_SX/);
  });

  it.each([
    ['Start count', wmsModuleSrc],
    ['Continue', wmsModuleSrc],
  ])('%s (counting-task card) references WMS_TIER1_ACTION_SX at its call site', (label, src) => {
    const block = ctaBlock(src, label === 'Continue' ? "'Continue'" : "'Start count'");
    expect(block).toMatch(/WMS_TIER1_ACTION_SX/);
  });
});

describe('CONTRACT-WMS-CTA-02 — selection controls stay neutral, not raw MUI primary blue', () => {
  it('wmsTier2SelectionSx(false) — idle — is neutral: no accent fill, no MUI primary', () => {
    render(<Button sx={wmsTier2SelectionSx(false)}>Idle probe</Button>);
    const btn = screen.getByText('Idle probe');
    expect(btn).not.toHaveStyle({ backgroundColor: 'var(--accent)' });
    expect(btn).toHaveStyle({ color: 'var(--ink)' });
    expect(btn).toHaveStyle({ border: '1px solid var(--rule)' });
  });

  it('wmsTier2SelectionSx(true) — selected — stays neutral and visually subordinate to Tier 1', () => {
    render(<Button sx={wmsTier2SelectionSx(true)}>Selected probe</Button>);
    const btn = screen.getByText('Selected probe');
    expect(btn).not.toHaveStyle({ backgroundColor: 'var(--accent)' });
    expect(btn).toHaveStyle({ backgroundColor: 'var(--surface)' });
    expect(btn).toHaveStyle({ border: '1px solid var(--rule-2)' });
  });

  it.each(['Product defect', 'Packaging defect'])(
    '%s finding-type toggle references wmsTier2SelectionSx',
    (label) => {
      expect(ctaBlock(countingSessionSrc, label)).toMatch(/wmsTier2SelectionSx/);
    }
  );

  it('skip-reason options reference wmsTier2SelectionSx', () => {
    const optionsBlockStart = countingSessionSrc.indexOf('SKIP_OPTIONS.map');
    const optionsBlockEnd = countingSessionSrc.indexOf('))', optionsBlockStart);
    const block = countingSessionSrc.slice(optionsBlockStart, optionsBlockEnd);
    expect(block).toMatch(/wmsTier2SelectionSx/);
  });
});

describe('CONTRACT-WMS-CTA-03 — secondary controls stay non-Tier-1', () => {
  it.each([
    ['Leave count', countingSessionSrc],
    ['Report defect', countingSessionSrc],
  ])('%s does not reference WMS_TIER1_ACTION_SX or wmsTier2SelectionSx', (label, src) => {
    const block = ctaBlock(src, label);
    expect(block).not.toMatch(/WMS_TIER1_ACTION_SX/);
    expect(block).not.toMatch(/wmsTier2SelectionSx/);
  });

  it('"Select all suggested bins" (WmsModuleFT2) keeps its existing ghost treatment', () => {
    const block = ctaBlock(wmsModuleSrc, 'Select all suggested bins');
    expect(block).toMatch(/var\(--rule\)/);
    expect(block).toMatch(/var\(--ink\)/);
    expect(block).not.toMatch(/var\(--accent\)/);
    expect(block).not.toMatch(/WMS_TIER1_ACTION_SX/);
  });

  it('dialog Cancel buttons in CountingSessionPage are unchanged (no accent/tier styling added)', () => {
    const cancelBlocks = [...countingSessionSrc.matchAll(/<Button\s+onClick=\{[^}]*\}\s*\n\s*disabled=\{submitting\}\s*\n\s*>\s*\n\s*Cancel/g)];
    expect(cancelBlocks.length).toBeGreaterThan(0);
    for (const match of cancelBlocks) {
      expect(match[0]).not.toMatch(/WMS_TIER1_ACTION_SX/);
    }
  });
});

describe('CONTRACT-WMS-CTA-04 — pick CTA token hygiene', () => {
  it('pick-batch CTA family uses var(--accent-ink), not the literal hex #10151E', () => {
    const pickCtaStart = wmsModuleSrc.indexOf("{ctaLabel && (");
    const pickCtaEnd = wmsModuleSrc.indexOf('</Box>', pickCtaStart);
    const block = wmsModuleSrc.slice(pickCtaStart, pickCtaEnd);
    expect(block).toMatch(/var\(--accent-ink\)/);
    expect(block).not.toMatch(/#10151E/);
  });

  it('no #10151E literal remains anywhere in WmsModuleFT2.tsx', () => {
    expect(wmsModuleSrc).not.toMatch(/#10151E/);
  });
});
