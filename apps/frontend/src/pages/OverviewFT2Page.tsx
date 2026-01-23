import { useROOverview } from '../api/useROOverview';

/**
 * RO Overview — FT2
 * Observational surface only.
 */
export default function OverviewFT2Page() {
  const data = useROOverview(0);

  if (!data) return null;

  const { trust, domains } = data;

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <div style={{ flex: 1 }}>
        <pre>{trust ?? '—'}</pre>
      </div>

      {Object.entries(domains).map(([moduleId, surface]) => (
        <div key={moduleId} style={{ flex: 1 }}>
          <pre>{surface ?? '—'}</pre>
        </div>
      ))}
    </div>
  );
}