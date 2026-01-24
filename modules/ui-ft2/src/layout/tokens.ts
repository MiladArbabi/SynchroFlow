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
  colGap: 24,

  surfacePadding: {
    kpi: 16,
    standard: 24,
  },

  surfaceTitle: {
    background: 'rgba(0, 0, 0, 0.02)',
    divider: 'rgba(0, 0, 0, 0.06)',
  },

  surfaceShadow: {
    /**
     * FT2 Surface Shadow
     * ------------------
     * Structural depth only.
     * No semantic meaning.
     */
    default: '0px 2px 6px rgba(0, 0, 0, 0.08)',
    hover: '0px 4px 10px rgba(0, 0, 0, 0.12)', // optional, future-safe
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
      columns: 6,
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