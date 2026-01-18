// modules/customers/src/ui/pages/CustomersModuleFT2.tsx
//
// Customers FT2 — Canonical UI Renderer
// ------------------------------------
// ROLE:
// - Pure FT2 presentation layer
// - Renders only FTEP-exposed truth
// - No inference, no readiness logic, no lifecycle thinking
//
// RULES (ENFORCED BY DESIGN):
// - One surface = one truth
// - Null means absence (surface hidden unless specified)
// - Unknown is rendered explicitly only when allowed
// - Free vs Paid is visibility-only (no placeholders, no degradation)
//
// NOTE:
// - This component assumes all gating and downgrading
//   already happened in Specter FTEP.
// - This file must remain boring. That is the feature.

import React from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

/* =========================
   Public Props (FT2 Shape)
   ========================= */

export interface CustomersModuleFT2Props {
  // --- Existence & Context (Free)
  sessionsObserved: number | null;
  period: { from: string; to: string } | null;

  // --- Directional Movement (Free)
  activityDirection: 'up' | 'down' | 'flat' | 'unknown' | null;

    // --- Behavioral Structure
    exitIntentDetected: boolean | null;
    structuredJourneysDetected: boolean | null;

    /**
     * Behavioral depth (Free).
     */
    multiStepSessionsPresent: boolean | null;

    /**
     * Surface breadth (Free).
     */
    surfaceBreadthPresent: boolean | null;

    /**
     * Returning behavior (Free).
     */
    returningSessionsPresent: boolean | null;

    /**
     * Average session depth (Free).
     * Existence-only.
     */
    averageSessionDepthPresent: boolean | null;

    /**
     * Early exit without interaction (Free).
     */
    exitWithoutInteractionPresent: boolean | null;

  // --- Trust Calibration (Free)
  dataCoverage: 'complete' | 'partial' | 'insufficient' | null;

  // --- Entitlement (UI-only visibility switch)
  isPaid: boolean;
}

/* =========================
   Small Render Helpers
   ========================= */

// Boolean existence → human-safe, non-explanatory labels
function renderDetected(value: boolean | null): string {
  if (value === true) return 'Detected';
  if (value === false) return 'Not detected';
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
    sessionsObserved,
    period,
    activityDirection,
    exitIntentDetected,
    structuredJourneysDetected,
    multiStepSessionsPresent,
    surfaceBreadthPresent,
    returningSessionsPresent,
    averageSessionDepthPresent,
    exitWithoutInteractionPresent,
    dataCoverage,
    isPaid,
  } = props;

  return (
    <FT2Layout>

      {/* =========================
          Row 1 — System Overview (KPI)
          OpsConsole + Core Signals
        ========================= */}
      <FT2Row intent="kpi">
        {/* Ops Console (span = 2) */}
        <FT2Surface
          variant="standard"
          title="Insights"
          span={2}
        >
          {/* Placeholder — dynamic OpsConsole will replace this */}
          <div>• Signal ingestion active</div>
          <div>• Data coverage nominal</div>
          <div>• No blocking anomalies</div>
        </FT2Surface>

        {/* Core KPI 1 — Activity Direction */}
        <FT2Surface variant="kpi" title="Customer activity movement">
          {renderDirection(activityDirection)}
        </FT2Surface>

        {/* Core KPI 2 — Multi-step Sessions */}
        <FT2Surface variant="kpi" title="Multi-step sessions">
          {renderDetected(multiStepSessionsPresent)}
        </FT2Surface>

        {/* Core KPI 3 — Early Exit */}
        <FT2Surface variant="kpi" title="Exited without interaction">
          {renderDetected(exitWithoutInteractionPresent)}
        </FT2Surface>

        {/* Core KPI 4 — Returning Visitors */}
        <FT2Surface variant="kpi" title="Returning visitors">
          {renderDetected(returningSessionsPresent)}
        </FT2Surface>
      </FT2Row>

      {/* =========================
          Row 2 — Analysis / Shape
          (Charts & Visuals)
        ========================= */}
      <FT2Row intent="analysis">
        <FT2Surface title="Session distribution">
          {/* Placeholder for FT2Distribution / FT2Scatter */}
        </FT2Surface>

        <FT2Surface title="Activity over time">
          {/* Placeholder for FT2TimeSeries */}
        </FT2Surface>
      </FT2Row>

      {/* =========================
          Row 3 — Supporting Signals
          (Complementary KPIs)
        ========================= */}
      <FT2Row intent="support">
        <FT2Surface variant="kpi" title="Average session depth">
          {renderDetected(averageSessionDepthPresent)}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Exit intent detected">
          {renderDetected(exitIntentDetected)}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Structured journeys">
          {renderDetected(structuredJourneysDetected)}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Data coverage">
          {renderCoverage(dataCoverage)}
        </FT2Surface>

        <FT2Surface
          variant="standard"
          title="Insights"
          span={2}
        >
          {renderDetected(surfaceBreadthPresent)}
        </FT2Surface>
      </FT2Row>

    </FT2Layout>
  );
}