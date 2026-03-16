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
/**
 * IMPORTANT — HEADLESS VISUALIZATION COMPONENT
 * -------------------------------------------
 * This widget must NOT render FT2Panel surfaces.
 * The parent module (OrdersModuleFT2) owns the surface container.
 *
 * Rendering a panel here causes nested surfaces
 * which produce the frame-in-frame visual defect.
 */

/**
 * Operational severity classification
 */
type SeverityLevel = 'green' | 'amber' | 'red';

/**
 * Pressure acceleration classification
 */
type AccelerationLevel = 'stable' | 'accelerating';

/**
 * Control Tower incident signal
 */
type OperationalIncident =
  | 'inventory_constraint'
  | 'sla_breach'
  | 'revenue_blockage';

export interface OperationalPressurePoint {
  snapshot_date: string;
  queue_awaiting_inventory: number;
  orders_at_sla_risk: number;
  revenue_blocked_inventory: number;
}

export interface OperationalPressurePanelProps {
  series: OperationalPressurePoint[] | null;
}

export function OperationalPressurePanel({
  series,
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
  }

  function severityInventory(value: number): SeverityLevel {
    if (value > 100) return 'red';
    if (value > 20) return 'amber';
    return 'green';
  }

  function severitySla(value: number): SeverityLevel {
    if (value > 10) return 'red';
    if (value > 0) return 'amber';
    return 'green';
  }

  function severityRevenue(value: number): SeverityLevel {
    if (value > 10000) return 'red';
    if (value > 1000) return 'amber';
    return 'green';
  }

  function severityIcon(level: SeverityLevel) {
    if (level === 'red') return '⚠';
    if (level === 'amber') return '▲';
    return '✓';
  }

  /**
   * Pressure trend computation
   * --------------------------
   * Compare the last two snapshots to determine
   * directional change of operational pressure.
   */
  const latest = series[series.length - 1];
  const previous = series[series.length - 2];

  function trend(
  current: number,
  prev: number
): 'up' | 'down' | 'flat' {
    if (current > prev) return 'up';
    if (current < prev) return 'down';
    return 'flat';
  }

/**
 * Acceleration detection
 * ----------------------
 * Detects rapid operational pressure increases.
 *
 * Rule:
 * acceleration occurs if the delta between the
 * last two snapshots exceeds 20%.
 */
function acceleration(current: number, prev: number): AccelerationLevel {
  if (prev === 0) return 'stable';

  const delta = current - prev;
  const rate = delta / prev;

  if (rate > 0.2) return 'accelerating';

  return 'stable';
}

  const trends = {
    inventory: trend(
      latest.queue_awaiting_inventory,
      previous.queue_awaiting_inventory
    ),
    sla: trend(
      latest.orders_at_sla_risk,
      previous.orders_at_sla_risk
    ),
    revenue: trend(
      latest.revenue_blocked_inventory,
      previous.revenue_blocked_inventory
    ),
  };

/**
 * Pressure acceleration signals
 */
const accelerationSignals = {
  inventory: acceleration(
    latest.queue_awaiting_inventory,
    previous.queue_awaiting_inventory
  ),
  sla: acceleration(
    latest.orders_at_sla_risk,
    previous.orders_at_sla_risk
  ),
  revenue: acceleration(
    latest.revenue_blocked_inventory,
    previous.revenue_blocked_inventory
  ),
};

/**
 * Incident detection
 * ------------------
 * Detects critical operational states from latest snapshot.
 *
 * Rules:
 * inventory_constraint → severe inventory backlog
 * sla_breach           → significant SLA breach exposure
 * revenue_blockage     → critical revenue blocked
 */
const incidents: OperationalIncident[] = [];

if (latest.queue_awaiting_inventory > 100) {
  incidents.push('inventory_constraint');
}

if (latest.orders_at_sla_risk > 10) {
  incidents.push('sla_breach');
}

if (latest.revenue_blocked_inventory > 10000) {
  incidents.push('revenue_blockage');
}

  /**
   * Severity classification
   * -----------------------
   * Determines operational state from latest snapshot.
   */
  const severity = {
    inventory: severityInventory(latest.queue_awaiting_inventory),
    sla: severitySla(latest.orders_at_sla_risk),
    revenue: severityRevenue(latest.revenue_blocked_inventory),
  };

  function severityColor(level: SeverityLevel) {
    if (level === 'red') return '#d32f2f';
    if (level === 'amber') return '#f57c00';
    return '#2e7d32';
  }

  /**
   * Chart series mapping
   */
  const chartSeries = [
    {
      name: 'Inventory Backlog',
      data: series.map((p) => p.queue_awaiting_inventory ?? 0),
    },
    {
      name: 'SLA Breach Risk',
      data: series.map((p) => p.orders_at_sla_risk ?? 0),
    },
    {
      name: 'Blocked Revenue',
      data: series.map((p) => p.revenue_blocked_inventory ?? 0),
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

  function arrow(direction: 'up' | 'down' | 'flat') {
    if (direction === 'up') return '↑';
    if (direction === 'down') return '↓';
    return '→';
  }

  function accelerationIcon(level: AccelerationLevel) {
    if (level === 'accelerating') return '⇡';
    return '';
  }

  function incidentLabel(type: OperationalIncident) {
    switch (type) {
      case 'inventory_constraint':
        return '🚨 Inventory Constraint Incident';
      case 'sla_breach':
        return '⚠ SLA Breach Incident';
      case 'revenue_blockage':
        return '⚠ Revenue Blockage Incident';
    }
  }

  return (
    <>

      {/* Operational Incident Banner */}
      {incidents.length > 0 && (
        <div
          style={{
            padding: '10px 16px',
            background: '#fff3e0',
            borderBottom: '1px solid #eee',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {incidents.map((i) => (
            <div key={i}>{incidentLabel(i)}</div>
          ))}
        </div>
      )}

      <Chart
        type="line"
        height={320}
        options={options}
        series={chartSeries}
      />

            {/* Pressure Summary Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))',
          gap: 12,
          padding: '12px 16px',
          fontSize: 14,
          fontWeight: 500,
        }}
      >
       <div
        style={{
          color: severityColor(severity.inventory),
          fontSize: 12,
          fontFamily: 'arial',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
        aria-label={`Inventory backlog ${severity.inventory}`}
      >
        <span>{severityIcon(severity.inventory)}</span>
        <span>Inventory Backlog</span>
        <span>{latest.queue_awaiting_inventory}</span>
        <span>{arrow(trends.inventory)}</span>
        <span>{accelerationIcon(accelerationSignals.inventory)}</span>
      </div>

        <div
          style={{
          color: severityColor(severity.sla),
          fontSize: 12,
          fontFamily: 'arial',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
          aria-label={`SLA risk ${severity.sla}`}
        >
          <span>{severityIcon(severity.sla)}</span>
          <span>SLA Breach Risk</span>
          <span>{latest.orders_at_sla_risk}</span>
          <span>{arrow(trends.sla)}</span>
          <span>{accelerationIcon(accelerationSignals.sla)}</span>
        </div>

        <div
          style={{
          color: severityColor(severity.revenue),
          fontSize: 12,
          fontFamily: 'arial',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
          aria-label={`Blocked revenue ${severity.revenue}`}
        >
          <span>{severityIcon(severity.revenue)}</span>
          <span>Blocked Revenue</span>
          <span>${latest.revenue_blocked_inventory.toLocaleString()}</span>
          <span>{arrow(trends.revenue)}</span>
          <span>{accelerationIcon(accelerationSignals.revenue)}</span>
        </div>
      </div>

    </>
  );
}