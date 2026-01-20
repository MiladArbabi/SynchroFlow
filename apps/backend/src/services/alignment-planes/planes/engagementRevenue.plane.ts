import { AlignmentPlane } from '../alignmentPlane.types';

type EngagementRevenueInput = {
  customers: {
    engagementTrend: 'up' | 'down' | 'flat' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
  orders: {
    outcome: 'positive' | 'negative' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
};

export const engagementRevenuePlane: AlignmentPlane<EngagementRevenueInput> = {
  id: 'engagement-revenue',

  compute({ customers, orders }) {
    if (
      customers.visibility !== 'sufficient' ||
      orders.visibility !== 'sufficient'
    ) {
      return 'unknown';
    }

    if (
      customers.engagementTrend === null ||
      orders.outcome === null
    ) {
      return 'unknown';
    }

    if (customers.engagementTrend === 'flat') {
      return 'unknown';
    }

    if (
      customers.engagementTrend === 'up' &&
      orders.outcome === 'positive'
    ) {
      return 'aligned';
    }

    if (
      customers.engagementTrend === 'down' &&
      orders.outcome === 'negative'
    ) {
      return 'aligned';
    }

    return 'divergent';
  },
};