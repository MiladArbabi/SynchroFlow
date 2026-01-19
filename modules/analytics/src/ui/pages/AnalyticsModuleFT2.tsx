import React from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

import type {
  AnalyticsModuleFT2Props,
} from './AnalyticsModuleFT2.types';

export default function AnalyticsModuleFT2(
  props: AnalyticsModuleFT2Props
) {
  const {
  snapshot,
  domains,
} = props;

  return (
    <FT2Layout>
      <FT2Layout>
      {/* ───────── Snapshot Metadata ─────────
          Purpose:
          - Anchor the user in time WITHOUT interpreting it
          - No business meaning
      */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Snapshot ID">
          {snapshot.id || '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Extracted At">
          {snapshot.extractedAt || '—'}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Domain Observability ─────────
          Purpose:
          - Show WHAT is observable
          - Never explain WHY
          - Never judge GOOD/BAD
      */}
      <FT2Row intent="analysis">
        <FT2Surface title="Orders — Observability">
          <DomainObservability domain={domains.orders} />
        </FT2Surface>

        <FT2Surface title="Products — Observability">
          <DomainObservability domain={domains.products} />
        </FT2Surface>

        <FT2Surface title="Customers — Observability">
          <DomainObservability domain={domains.customers} />
        </FT2Surface>

        <FT2Surface title="Finances — Observability">
          <DomainObservability domain={domains.finances} />
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
    </FT2Layout>
  );
}

/**
 * DomainObservability
 *
 * Dumb renderer for FT2 observability signals.
 *
 * Rules:
 * - null === intentional absence
 * - NO interpretation
 * - NO advice
 * - NO performance framing
 */
function DomainObservability({
  domain,
}: {
  domain:
    | {
        presence: boolean | null;
        observationCount: number | null;
        nullSurface: number | null;
        firstSeenAt: string | null;
        lastSeenAt: string | null;
      }
    | null;
}) {
  if (domain === null) {
    return <div>—</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div>
        <strong>Presence:</strong>{' '}
        {domain.presence === null
          ? '—'
          : domain.presence
          ? 'Yes'
          : 'No'}
      </div>

      <div>
        <strong>Observation Count:</strong>{' '}
        {domain.observationCount === null ? '—' : domain.observationCount}
      </div>

      <div>
        <strong>Null Surface:</strong>{' '}
        {domain.nullSurface ?? '—'}
      </div>

      <div>
        <strong>First Seen:</strong>{' '}
        {domain.firstSeenAt ?? '—'}
      </div>

      <div>
        <strong>Last Seen:</strong>{' '}
        {domain.lastSeenAt ?? '—'}
      </div>
    </div>
  );
}