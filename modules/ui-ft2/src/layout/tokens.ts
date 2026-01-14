export const FT2_TOKENS = {
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