/**
 * Decision Design Tokens
 * -----------------------
 * Strictly separated from FT2 tokens.
 *
 * Semantic Layer:
 * - Urgency
 * - Ranking
 * - Priority emphasis
 *
 * Must NOT import from ui-ft2.
 */

export const decisionTokens = {
  spacing: {
    stackGap: 12,
  },

  // Resolved by the host theme (apps/frontend/src/themes/tokens.ts) so the
  // decision layer follows light/dark like every other surface.
  surface: {
    background: 'var(--surface)',
    border: 'var(--rule)',
  },

  // Urgency reuses the pulse severity scale; *-text variants hold 4.5:1.
  urgency: {
    high: 'var(--critical-text)',
    medium: 'var(--warning-text)',
    low: 'var(--good-ink)',
  },
} as const;