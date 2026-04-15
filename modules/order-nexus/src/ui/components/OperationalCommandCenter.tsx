/**
 * OperationalCommandCenter
 * ------------------------
 * Primary decision surface for operational control.
 *
 * RULES:
 * - No charts
 * - No historical views
 * - Only actionable, prioritized information
 *
 * DATA SOURCE:
 * - operationalControl snapshot (backend authoritative)
 */

import { FC } from 'react';
import { useTheme } from '@mui/material/styles';


type Props = {
  operationalControl: {
    total_at_risk_revenue: number;
    sla_breach_24h_revenue: number;
    top_blocking_type: string;

    revenue_blocked_inventory: number;
    revenue_blocked_customer: number;
    revenue_blocked_operational: number;
  };

  /**
   * ACTION HOOKS
   * -------------
   * Must trigger operational workflows.
   */
  onDriverClick?: (driver: string) => void;
  onBreakdownClick?: (type: string) => void;
  onUrgencyClick?: () => void;
};

export const OperationalCommandCenter: FC<Props> = ({
  operationalControl,
  onDriverClick,
  onBreakdownClick,
  onUrgencyClick,
}) => {
    const theme = useTheme();

  /**
   * PRIMARY METRICS
   * ----------------
   * These define operator focus.
   */
  const totalAtRisk = operationalControl.total_at_risk_revenue;
  const urgency = operationalControl.sla_breach_24h_revenue;
    /**
     * URGENCY CLASSIFICATION
     * ----------------------
     * Forces visibility of time-critical risk.
     */
    const isCritical = urgency > 0;
  const topDriver = operationalControl.top_blocking_type;

  const breakdown = [
    {
        label: 'Inventory',
        value: operationalControl.revenue_blocked_inventory,
    },
    {
        label: 'Customer',
        value: operationalControl.revenue_blocked_customer,
    },
    {
        label: 'Operational',
        value: operationalControl.revenue_blocked_operational,
    },
  ]
    .sort((a, b) => b.value - a.value);


    /**
     * PRIMARY ISSUE DERIVATION
     * ------------------------
     * Always take highest impact blocker.
     */
    const primaryIssue = breakdown[0];

    /**
     * DRIVER → ACTION MAPPING
     * -----------------------
     * Converts system state into explicit operator action.
     */
    const driverActionMap: Record<string, string> = {
    inventory: 'Resolve inventory shortages',
    customer: 'Contact customers',
    operational: 'Fix operational blockers',
    none: 'No active blockers',
    };

    const driverActionLabel = driverActionMap[topDriver] ?? 'Investigate issue';

    const handleDriverClick = () => {
        onDriverClick?.(topDriver);
    };

    const handleUrgencyClick = () => {
        if (isCritical) {
            onUrgencyClick?.();
        }
    };

  return (
    <div style={{ padding: 16 }}>

    {/* PRIMARY DIRECTIVE
        * ------------------
        * This replaces passive metrics.
        * Must tell operator exactly what to fix. */ }
    <div
    onClick={handleDriverClick}
    style={{ cursor: 'pointer', marginBottom: 12 }}
    >
        <strong>
            Fix {primaryIssue.label} blockage — {primaryIssue.value}
        </strong>

        <div style={{ fontSize: 12, opacity: 0.7 }}>
            {driverActionLabel}
        </div>
    </div>

     {/* URGENCY INTERRUPT
        * ------------------
        * Critical risk must override the entire panel.
        * Not just be displayed — must demand action. */}
    {isCritical && (
    <div
        onClick={handleUrgencyClick}
        style={{
          marginTop: 12,
          padding: 8,
          background: 'var(--mui-palette-error-light)',
          border: '1px solid var(--mui-palette-error-main)',
          cursor: 'pointer',
        }}
    >
        <strong>
        Immediate risk: {urgency} revenue breaching SLA
        </strong>

        <div style={{ fontSize: 12 }}>
        Click to prioritize these orders now
        </div>
    </div>
    )}

      {/* BREAKDOWN GRID */}
    <div style={{ marginTop: 16 }}>
    <strong>Breakdown:</strong>

    {/* /**
    * PRIORITIZATION ENFORCEMENT
    * --------------------------
    * Highest impact issue MUST always appear first.
    * No neutral ordering allowed.
    */ }
    {breakdown
        .filter(item => item.value > 0)
        .slice(0, 2)
        .map((item, index) => (
    <div
        key={item.label}
        onClick={() => onBreakdownClick?.(item.label)}
        style={{ cursor: 'pointer' }}
    >
        {index === 0 ? <strong>→ </strong> : null}
        {item.label}: {item.value}
    </div>
    ))}
    </div>
    </div>
  );
};