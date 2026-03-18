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

type Props = {
  operationalControl: {
    total_at_risk_revenue: number;
    sla_breach_24h_revenue: number;
    top_blocking_type: string;
  };
};

export const OperationalCommandCenter: FC<Props> = ({
  operationalControl,
}) => {

  /**
   * PRIMARY METRICS
   * ----------------
   * These define operator focus.
   */
  const totalAtRisk = operationalControl.total_at_risk_revenue;
  const urgency = operationalControl.sla_breach_24h_revenue;
  const topDriver = operationalControl.top_blocking_type;

  return (
    <div style={{ padding: 16 }}>

      {/* TOTAL AT RISK */}
      <div>
        <strong>Total Revenue at Risk:</strong> {totalAtRisk}
      </div>

      {/* TOP DRIVER */}
      <div>
        <strong>Top Blocking Driver:</strong> {topDriver}
      </div>

      {/* URGENCY */}
      <div>
        <strong>Urgency (Next 24h):</strong> {urgency}
      </div>

    </div>
  );
};