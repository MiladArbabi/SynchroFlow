/* eslint-disable @typescript-eslint/no-unused-vars */
import { CustomerApiResponse } from 'api-src/api/customers/customers.service';
import { useMemo } from 'react';
import type { CustomerOrder } from '../components/Customer360/CustomerOrderHistory';

export interface RFMScores {
  recency: number; // 1-5 (days since last purchase)
  frequency: number; // 1-5 (order count)
  monetary: number; // 1-5 (total spend)
  composite: number; // 1-5 (average of R, F, M)
}

export interface RFMInsight {
  type: 'success' | 'warning' | 'info' | 'error';
  message: string;
  priority: 'high' | 'medium' | 'low';
}

export interface NudgeRecommendation {
  type: 'discount' | 'upsell' | 'cross_sell' | 'loyalty' | 'reactivation';
  message: string;
  segment: string;
  confidence: number;
}

export interface RFMResult {
  rfmScores: RFMScores;
  rfmSegment: string;
  insights: RFMInsight[];
  nudgeRecommendations: NudgeRecommendation[];
}

/**
 * Custom hook for calculating RFM (Recency, Frequency, Monetary) scores
 * and generating insights and nudge recommendations for customer segmentation
 */
export const useRFMScoring = (customerData: CustomerApiResponse | null): RFMResult => {
  return useMemo(() => {
    if (!customerData) {
      return getDefaultRFMResult();
    }

    const orders = customerData.orders;
    const metrics = customerData.metrics;

    // If orders array is missing/undefined, treat as no orders regardless of metrics
    if (!orders) {
      return {
        rfmScores: { recency: 1, frequency: 1, monetary: 1, composite: 1 },
        rfmSegment: 'New',
        insights: [{
          type: 'info',
          message: 'No order history available for RFM analysis',
          priority: 'medium'
        }],
        nudgeRecommendations: []
      };
    }

    // Calculate RFM scores
    const recencyScore = calculateRecencyScore(orders);
    const frequencyScore = calculateFrequencyScore(orders, metrics);
    const monetaryScore = calculateMonetaryScore(orders, metrics);
    const compositeScore = (recencyScore + frequencyScore + monetaryScore) / 3;

    const rfmScores: RFMScores = {
      recency: recencyScore,
      frequency: frequencyScore,
      monetary: monetaryScore,
      composite: Math.round(compositeScore * 10) / 10 // Round to 1 decimal
    };

    // Determine RFM segment
    const rfmSegment = determineRFMSegment(rfmScores);

    // Generate insights
    const insights = generateRFMInsights(rfmScores, rfmSegment, customerData);

    // Generate nudge recommendations
    const nudgeRecommendations = generateNudgeRecommendations(rfmSegment, rfmScores, customerData);

    return {
      rfmScores,
      rfmSegment,
      insights,
      nudgeRecommendations
    };
  }, [customerData]);
};

// Helper functions

function getDefaultRFMResult(): RFMResult {
  return {
    rfmScores: { recency: 1, frequency: 1, monetary: 1, composite: 1 },
    rfmSegment: 'New',
    insights: [{
      type: 'info',
      message: 'No customer data available for RFM analysis',
      priority: 'medium'
    }],
    nudgeRecommendations: []
  };
}

function calculateRecencyScore(orders: CustomerOrder[]): number {
  if (orders.length === 0) return 1;

  const lastOrderDate = new Date(Math.max(...orders.map(order => new Date(order.orderDate).getTime())));
  const daysSinceLastOrder = Math.floor((Date.now() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24));

  // Score based on days since last purchase
  if (daysSinceLastOrder <= 30) return 5; // Very recent (0-30 days)
  if (daysSinceLastOrder <= 60) return 4; // Recent (31-60 days)
  if (daysSinceLastOrder <= 90) return 3; // Somewhat recent (61-90 days)
  if (daysSinceLastOrder <= 180) return 2; // Not recent (91-180 days)
  return 1; // Very not recent (180+ days)
}

function calculateFrequencyScore(orders: CustomerOrder[], metrics: CustomerApiResponse['metrics']): number {
  const orderCount = orders.length || metrics.total_orders || 0;

  // Score based on order count
  if (orderCount >= 10) return 5; // Very frequent (10+ orders)
  if (orderCount >= 5) return 4; // Frequent (5-9 orders)
  if (orderCount >= 3) return 3; // Moderate (3-4 orders)
  if (orderCount >= 2) return 2; // Occasional (2 orders)
  if (orderCount >= 1) return 1; // One-time (1 order)
  return 1; // No orders
}

function calculateMonetaryScore(orders: CustomerOrder[], metrics: CustomerApiResponse['metrics']): number {
  const totalSpent = metrics.total_revenue || 
    orders.reduce((sum, order) => sum + order.total, 0);

  // Score based on total spend
  if (totalSpent >= 1000) return 5; // High spender ($1000+)
  if (totalSpent >= 500) return 4; // Medium-high ($500-999)
  if (totalSpent >= 250) return 3; // Medium ($250-499)
  if (totalSpent >= 100) return 2; // Low-medium ($100-249)
  if (totalSpent > 0) return 1; // Low ($1-99)
  return 1; // No spend
}

function determineRFMSegment(scores: RFMScores): string {
  const { recency, frequency, monetary } = scores;

  // Handle customers with no orders (all scores = 1)
  if (recency === 1 && frequency === 1 && monetary === 1) {
    return 'New';
  }

  // RFM Segment Matrix
  if (recency >= 4 && frequency >= 4 && monetary >= 4) return 'Champion';
  if (recency >= 3 && frequency >= 3 && monetary >= 3) return 'Loyal';
  if (recency >= 4 && frequency <= 2 && monetary <= 2) return 'New';
  if (recency <= 2 && frequency >= 3 && monetary >= 3) return 'Cannot Lose';
  if (recency <= 2 && frequency >= 2 && monetary >= 2) return 'At Risk';
  if (recency >= 3 && frequency <= 2 && monetary >= 3) return 'Potential';
  
  return 'Need Attention';
}

function generateRFMInsights(
  scores: RFMScores, 
  segment: string, 
  customerData: CustomerApiResponse
): RFMInsight[] {
  const insights: RFMInsight[] = [];
  const { recency, frequency, monetary } = scores;

  // Recency insights
  if (recency <= 2) {
    insights.push({
      type: 'warning',
      message: `Customer hasn't purchased in over 90 days. Consider reactivation campaign.`,
      priority: 'high'
    });
  } else if (recency >= 4) {
    insights.push({
      type: 'success',
      message: 'Customer purchased recently. Great opportunity for cross-selling.',
      priority: 'medium'
    });
  }

  // Frequency insights
  if (frequency <= 2 && recency <= 3) {
    insights.push({
      type: 'info',
      message: 'Low order frequency but recent activity. Opportunity to increase engagement.',
      priority: 'medium'
    });
  } else if (frequency >= 4) {
    insights.push({
      type: 'success',
      message: 'High order frequency indicates loyal customer behavior.',
      priority: 'low'
    });
  }

  // Monetary insights
  if (monetary >= 4 && frequency <= 2) {
    insights.push({
      type: 'info',
      message: 'High value customer with low frequency. Opportunity for repeat purchases.',
      priority: 'high'
    });
  }

  // Segment-specific insights
  if (segment === 'At Risk') {
    insights.push({
      type: 'warning',
      message: 'Customer showing signs of churn. Immediate reactivation needed.',
      priority: 'high'
    });
  } else if (segment === 'Champion') {
    insights.push({
      type: 'success',
      message: 'VIP customer. Focus on retention and premium offerings.',
      priority: 'low'
    });
  }

  return insights.length > 0 ? insights : [{
    type: 'info',
    message: 'Monitor customer behavior for optimization opportunities.',
    priority: 'low'
  }];
}

function generateNudgeRecommendations(
  segment: string,
  scores: RFMScores,
  customerData: CustomerApiResponse
): NudgeRecommendation[] {
  const recommendations: NudgeRecommendation[] = [];

  switch (segment) {
    case 'Champion':
      recommendations.push({
        type: 'loyalty',
        message: 'Offer exclusive early access to new products',
        segment: 'Champion',
        confidence: 0.9
      });
      recommendations.push({
        type: 'upsell',
        message: 'Premium bundle offer with 15% discount',
        segment: 'Champion',
        confidence: 0.8
      });
      break;

    case 'Loyal':
      recommendations.push({
        type: 'cross_sell',
        message: 'Recommend complementary products based on purchase history',
        segment: 'Loyal',
        confidence: 0.7
      });
      break;

    case 'New':
      recommendations.push({
        type: 'discount',
        message: 'Welcome back offer: 10% off next purchase',
        segment: 'New',
        confidence: 0.6
      });
      break;

    case 'At Risk':
      recommendations.push({
        type: 'reactivation',
        message: 'We miss you! Special 20% discount to welcome you back',
        segment: 'At Risk',
        confidence: 0.8
      });
      break;

    case 'Cannot Lose':
      recommendations.push({
        type: 'reactivation',
        message: 'Personalized win-back offer with free shipping',
        segment: 'Cannot Lose',
        confidence: 0.7
      });
      break;

    case 'Potential':
      recommendations.push({
        type: 'upsell',
        message: 'Volume discount on frequently purchased items',
        segment: 'Potential',
        confidence: 0.6
      });
      break;
  }

  // Add monetary-based recommendations
  if (scores.monetary >= 4) {
    recommendations.push({
      type: 'upsell',
      message: 'Premium product recommendations based on high spending pattern',
      segment,
      confidence: 0.7
    });
  }

  return recommendations;
}