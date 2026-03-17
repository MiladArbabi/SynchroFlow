/**
 * OperationalPressurePanel
 * ------------------------
 * Control Tower visualization of operational pressure trends.
 *
 * Data source:
 * orders_operational_control_snapshot
 *
 * Design rules:
 * - read-only visualization
 * - no inference
 * - deterministic projection passthrough
 */
import Chart from 'react-apexcharts'

export interface OperationalPressurePoint {
  snapshot_date: string;
  queue_awaiting_inventory: number;
  orders_at_sla_risk: number;
  revenue_blocked_inventory: number;
}

export interface OperationalPressurePanelProps {
  series: OperationalPressurePoint[] | null;
  isStale?: boolean;
  lastSnapshotDate?: string | null;
}

export function OperationalPressurePanel({
  series,
  isStale,
  lastSnapshotDate,
}: OperationalPressurePanelProps) {

  /**
   * Sparse data guard
   */
  if (!series || series.length < 2) {
    return (
      <>
        <div style={{ padding: 16 }}>
          Operational timeline unavailable — snapshots not yet accumulated.
        </div>
      </>
    );
  };

  /**
   * Chart series mapping
   */
  const chartSeries = [
    {
      name: 'Inventory Backlog',
      /**
       * ⚠️ Do not default to 0 — preserves backend truth
       */
      data: series.map((p) => p.queue_awaiting_inventory),
    },
    {
      name: 'SLA Breach Risk',
      /**
       * ⚠️ Do not default to 0 — preserves backend truth
       */
      data: series.map((p) => p.orders_at_sla_risk),
    },
    {
      name: 'Blocked Revenue',
      /**
       * ⚠️ Do not default to 0 — preserves backend truth
       */
      data: series.map((p) => p.revenue_blocked_inventory),
    },
  ];

  const categories = series.map((p) => p.snapshot_date);

  /**
   * Apex chart options
   */
  const options = {
    chart: {
      id: 'operational-pressure',
      toolbar: { show: false },
      zoom: { enabled: false },
    },
    stroke: {
      curve: 'smooth',
      width: 3,
    },
    xaxis: {
      categories,
      labels: {
        rotate: -45,
      },
    },
    tooltip: {
      shared: true,
      intersect: false,
    },
    legend: {
      position: 'bottom',
    },
  };

  return (
  <>
    {/* 
      ⚠️ Staleness indicator
      Ensures stale data is never silent
    */}
    {isStale && (
      <div
        style={{
          padding: '8px 16px',
          background: '#fff3e0',
          borderBottom: '1px solid #eee',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        ⚠ Operational data may be stale
        {lastSnapshotDate && ` (last update: ${lastSnapshotDate})`}
      </div>
    )}

    <Chart
        type="line"
        height={320}
        options={options}
        series={chartSeries}
      />
    </>
  );
}