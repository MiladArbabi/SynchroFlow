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
    kpi: {
      height: 120,
    },
    analysis: {
      columns: 2,
      height: 280,
    },
    support: {
      columns: 3,
      height: 160,
    },
  },
} as const;