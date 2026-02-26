export const FT2_TOKENS = {
  /**
   * Trust Tone Tokens
   * -----------------
   * Epistemic surface boundary indicators.
   * Non-judgmental. No semantic overload.
   */
  trustTone: {
    trusted: '#2E7D32',     // green — epistemically usable
    constrained: '#F9A825', // yellow — partial / risky
    blocked: '#C62828',     // red — unsafe / unreliable
  },
  
  layoutMaxWidth: 1440,

  padding: {
    desktop: 32,
    tablet: 24,
    mobile: 16,
  },

  rowGap: 32,
  surfaceGap: 64,

  surfacePadding: {
    kpi: 16,
    standard: 24,
  },

  surface: {
    /**
     * Surface background
     * ------------------
     * Slight lift from app background.
     * Actual color resolved by host theme.
     */
    background: 'var(--ft2-surface-bg)',
  },

  surfaceTitle: {
    /**
     * Control zone background
     * -----------------------
     * Slight lift above surface.
     * Must remain neutral and non-semantic.
     */
    background: 'var(--ft2-surface-inset-bg)',
    divider: 'var(--ft2-surface-divider)',
  },

    /**
   * FT2 Typography Grammar
   * ---------------------
   * KPI-first. Dense. Non-decorative.
   * These tokens define semantic weight, not aesthetics.
   */
  typography: {
    surfaceTitle: {
      fontSize: '12px',
      fontWeight: 600,
      lineHeight: 1.2,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: 'var(--mui-palette-text-secondary)',
    },

    body: {
      fontSize: '13px',
      fontWeight: 400,
      lineHeight: 1.4,
      color: 'var(--mui-palette-text-primary)',
    },

    kpiValue: {
      fontSize: '20px',
      fontWeight: 600,
      lineHeight: 1.1,
      letterSpacing: '-0.01em',
      color: 'var(--mui-palette-text-primary)',
    },

    kpiUnit: {
      fontSize: '11px',
      fontWeight: 500,
      lineHeight: 1.1,
      color: 'var(--mui-palette-text-secondary)',
    },

    hint: {
      fontSize: '11px',
      fontWeight: 400,
      lineHeight: 1.3,
      color: 'var(--mui-palette-text-secondary)',
    },
  },

  surfaceShadow: {
    /**
     * Structural shadow only.
     * Resolved by host theme (mode-aware).
     */
    default: 'var(--ft2-surface-shadow)',
    hover: 'var(--ft2-surface-shadow-hover)',
  },

  controlZoneHeight: 32,

  analyticalWidth: {
    desktop: '85%',
    tablet: '92%',
    mobile: '100%',
  },

  /**
   * FT2 Row Grammar
   * ---------------
   * Semantic layout intents mapped to
   * deterministic geometry.
   */
   row: {
    /**
     * KPI Tier
     * --------
     * Epistemic snapshot layer.
     */
    kpi: {
      height: 120,
    },

    /**
     * Decision Tier
     * -------------
     * Operational prioritization layer.
     *
     * Characteristics:
     * - Full-width
     * - Single-column
     * - Taller than analysis
     * - Sits directly below KPI
     *
     * Purpose:
     * - Surface urgency
     * - Drive attention
     * - Bridge KPI → Analysis
     */
    decision: {
      columns: 1,
      height: 340,
    },

    /**
     * Analysis Tier
     * -------------
     * Multi-column breakdown layer.
     */
    analysis: {
      columns: 2,
      height: 280,
    },

    /**
     * Support Tier
     * ------------
     * Contextual, secondary surfaces.
     */
    support: {
      columns: 3,
      height: 160,
    },
  },
} as const;