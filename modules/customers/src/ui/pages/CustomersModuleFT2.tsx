// modules/customers/src/ui/pages/CustomersModuleFT2.tsx

import React from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

export interface CustomersModuleFT2Props {
  context: {
    sessionsObserved: number | null;
  };

  systemState: {
    status: 'healthy' | 'degraded' | 'partial' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    reason?: string;
  } | null;

  /**
   * CNS Signals (future-backed, nullable by design)
   */
  dataCoverage?: 'complete' | 'partial' | 'insufficient' | null;
  identityConfidence?: 'low' | 'medium' | 'high' | null;
  truthStability?: 'stable' | 'volatile' | 'regressing' | null;

  timeSignal: {
    trend:
      | 'improving'
      | 'deteriorating'
      | 'stable'
      | 'volatile'
      | 'unknown';
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
}

type CTRLevel = 'CTR-0' | 'CTR-1' | 'CTR-2' | 'CTR-3' | 'CTR-4';

/**
 * Infer CTR strictly from observable truth.
 * No assumptions. No enrichment.
 */
function deriveCTR(props: CustomersModuleFT2Props): CTRLevel {
  const { sessionsObserved } = props.context;
  const system = props.systemState;
  const time = props.timeSignal;

  if (sessionsObserved === null) {
    return 'CTR-0';
  }

  if (sessionsObserved > 0 && !system && !time) {
    return 'CTR-1';
  }

  if (sessionsObserved > 0 && system && system.confidence === 'low') {
    return 'CTR-2';
  }

  if (system && system.confidence === 'medium') {
    return 'CTR-3';
  }

  if (system && system.confidence === 'high') {
    return 'CTR-4';
  }

  return 'CTR-1';
}

export default function CustomersModuleFT2(
  props: CustomersModuleFT2Props
) {
  const ctr = deriveCTR(props);

  return (
    <FT2Layout>

      {/* ───────── Primary Truth Surface ───────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Customer truth readiness">
          {ctr}
        </FT2Surface>

       {ctr !== 'CTR-0' && ctr !== 'CTR-1' && (
        <FT2Surface variant="kpi" title="Session activity">
          Observed
        </FT2Surface>
      )}
      
         <FT2Surface variant="kpi" title="Data coverage">
          {ctr === 'CTR-0' || ctr === 'CTR-1'
            ? '—'
            : props.dataCoverage ?? '—'}
        </FT2Surface>
      
        <FT2Surface variant="kpi" title="Identity confidence">
          {ctr === 'CTR-3' || ctr === 'CTR-4'
            ? props.identityConfidence ?? '—'
            : '—'}
        </FT2Surface>
      
        <FT2Surface variant="kpi" title="Truth stability">
          {ctr === 'CTR-4'
            ? props.truthStability ?? '—'
            : '—'}
        </FT2Surface>
      </FT2Row>

      {/* ───────── CTR-Aware Explanation Surface ───────── */}
      <FT2Row intent="analysis">
        {ctr === 'CTR-0' && (
          <FT2Surface title="Current state">
            We’re connected, but no customer or session activity has been
            observed yet. This view will activate automatically once real
            traffic is detected.
          </FT2Surface>
        )}

        {ctr === 'CTR-1' && (
          <FT2Surface title="Current state">
            Visitor activity is detected, but customer identity cannot be
            confirmed yet. Traffic exists, but customer truth is not
            established.
          </FT2Surface>
        )}

        {ctr === 'CTR-2' && (
          <FT2Surface title="Current state">
            Customers have been observed, but identity resolution is still
            basic. This data is safe to observe, not yet safe to act on.
          </FT2Surface>
        )}

        {(ctr === 'CTR-2' || ctr === 'CTR-3' || ctr === 'CTR-4') && (
          <FT2Surface title="Data coverage">
            {props.dataCoverage === 'complete' &&
              'All expected systems reported customer data.'}
            {props.dataCoverage === 'partial' &&
              'Some systems did not report customer data.'}
            {props.dataCoverage === 'insufficient' &&
              'Too little data is available to assess customer truth.'}
            {!props.dataCoverage && 'Coverage assessment is not yet available.'}
          </FT2Surface>
        )}
      
        {(ctr === 'CTR-3' || ctr === 'CTR-4') && (
          <FT2Surface title="Identity confidence">
            {props.identityConfidence === 'low' &&
              'Customer identities are unstable. Duplication risk exists.'}
            {props.identityConfidence === 'medium' &&
              'Most customer identities are consistent.'}
            {props.identityConfidence === 'high' &&
              'Customer identities are stable across systems.'}
            {!props.identityConfidence &&
              'Identity confidence has not been established yet.'}
          </FT2Surface>
        )}

        {ctr === 'CTR-3' && (
          <FT2Surface title="Current state">
            Customer identity is stable across systems. Customer data shown
            here is reliable for operational decisions.
          </FT2Surface>
        )}

        {ctr === 'CTR-4' && (
          <FT2Surface title="Truth stability">
            {props.truthStability === 'stable' &&
              'Customer truth has remained consistent over time.'}
            {props.truthStability === 'volatile' &&
              'Customer truth varies across periods.'}
            {props.truthStability === 'regressing' &&
              'Customer truth quality is declining.'}
            {!props.truthStability &&
              'Truth stability has not been evaluated yet.'}
          </FT2Surface>
        )}

        {ctr === 'CTR-4' && (
          <FT2Surface title="Current state">
            Customer behavior and identity are coherent over time. Signals
            are suitable for forecasting and optimization.
          </FT2Surface>
        )}
      </FT2Row>

      {/* ───────── Support / Guardrails ───────── */}
      <FT2Row intent="support">
        <FT2Surface title="Why some data may be missing">
          Missing values are intentional. LaSyncro only shows customer data
          when there is enough evidence to trust it.
        </FT2Surface>

        <FT2Surface title="System note">
          {props.systemState?.reason ?? 'No system warnings detected.'}
        </FT2Surface>
      </FT2Row>

    </FT2Layout>
  );
}