// modules/customers/src/ui/pages/CustomersModuleFT2.tsx


import {
  FT2Layout,
  FT2Row,
  FT2Panel,
  PanelRow
} from '@lasyncro/ui-ft2';

/* =========================
   Public Props (FT2 Shape)
   ========================= */

export interface CustomersModuleFT2Props {
  // ── Domain 1 & 2 Context ──────────
  sessionsPresent: boolean | null;

  // ── Domain 3 Context ───────────────
  multiStepSessionsPresent: boolean | null;
  averageSessionDepthPresent: boolean | null;

  // ── Domain 4, 5 & 6 Context ──────────
  surfaceBreadthPresent: boolean | null;
  returningSessionsPresent: boolean | null;
  exitWithoutInteractionPresent: boolean | null;

  // ── Domain 7 Context ───────────────
  funnelsDetected: boolean | null;

  /**
   * Direction is NOT available in Customers FT2.
   * Always null by contract.
   */
  activityDirection: null;

  // Structural signals
  exitIntentDetected: boolean | null;


  // ── Coverage (not yet exposed) ─────────
  dataCoverage: 'complete' | 'partial' | 'insufficient' | null;
}

/* =========================
   Small Render Helpers
   ========================= */

// Boolean existence → human-safe, non-explanatory labels
function renderDetected(value: boolean | null): string {
  if (value === true) return 'Detected';
  if (value === false) return '—';
  return 'Unknown';
}

// Direction → arrow-only, no magnitude, no explanation
function renderDirection(
  value: 'up' | 'down' | 'flat' | 'unknown' | null
): string {
  switch (value) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'flat':
      return '→';
    case 'unknown':
    default:
      return '—';
  }
}

// Coverage → calibrated trust labels
function renderCoverage(
  value: 'complete' | 'partial' | 'insufficient' | null
): string {
  if (value === 'complete') return 'Complete';
  if (value === 'partial') return 'Partial';
  if (value === 'insufficient') return 'Insufficient';
  return 'Unknown';
}

/* =========================
   Component
   ========================= */

export default function CustomersModuleFT2(
  props: CustomersModuleFT2Props
) {
  const {
    sessionsPresent,
    activityDirection,
    exitIntentDetected,
    multiStepSessionsPresent,
    surfaceBreadthPresent,
    returningSessionsPresent,
    averageSessionDepthPresent,
    exitWithoutInteractionPresent,
    dataCoverage,
  } = props;

  return (
    <FT2Layout>

      {/* =========================
          Row 1 — System Overview (KPI)
          OpsConsole + Core Signals
        ========================= */}
      <FT2Row intent="kpi">

      <FT2Panel span={1} title="Customers System Status">

        {/* Temporary operational placeholder
          Ensures runtime JSX emission until
          full Customers FT2 panel implementation.
        */}

        <PanelRow label="Signal ingestion" value="Active" />
        <PanelRow label="Data coverage" value="Nominal" />
        <PanelRow label="Blocking anomalies" value="None detected" />

      </FT2Panel>

    </FT2Row>

    </FT2Layout>
  );
}