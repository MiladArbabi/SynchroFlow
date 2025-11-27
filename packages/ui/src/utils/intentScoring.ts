// packages/ui/src/utils/intentScoring.ts
export interface PageView {
  path: string;
  timestamp: number;
}

export interface IntentData {
  pageViews: PageView[];
  timeOnSite: number;
  productsViewed: string[];
  scrollDepth: number;
  mouseMovements: number;
  clicks: number;
}

export type IntentLevel = 'low' | 'medium' | 'high';

export const calculateIntentScore = (intentData: IntentData): number => {
  let score = 0;

  // Page views scoring (max 25 points)
  const pageViewScore = Math.min(intentData.pageViews.length * 5, 25);
  score += pageViewScore;

  // Time on site scoring (max 20 points)
  const timeScore = Math.min(intentData.timeOnSite / 60, 20); // 1 point per minute, max 20
  score += timeScore;

  // Products viewed scoring (max 20 points)
  const productScore = Math.min(intentData.productsViewed.length * 5, 20);
  score += productScore;

  // Scroll depth scoring (max 15 points)
  const scrollScore = (intentData.scrollDepth / 100) * 15;
  score += scrollScore;

  // Engagement scoring (max 20 points)
  const engagementScore = Math.min(
    (intentData.mouseMovements * 0.5) + (intentData.clicks * 2),
    20
  );
  score += engagementScore;

  // High-intent page bonuses
  const highIntentPaths = intentData.pageViews.filter(view => 
    view.path.includes('/cart') || 
    view.path.includes('/checkout') ||
    view.path.includes('/product/')
  );
  
  const highIntentBonus = highIntentPaths.reduce((bonus, view) => {
    if (view.path.includes('/checkout')) return bonus + 20; // Highest priority
    if (view.path.includes('/cart')) return bonus + 15;     // High priority  
    if (view.path.includes('/product/')) return bonus + 10; // Medium priority
    return bonus;
    }, 0);
    
  score += highIntentBonus;

  // Ensure score is between 0-100
  return Math.min(Math.max(score, 0), 100);
};

export const updateIntentScore = (
  currentIntent: IntentData, 
  newData: Partial<IntentData> & { pageView?: PageView }
): IntentData => {
  const updatedIntent = { ...currentIntent, ...newData };

  // Handle page view separately to append to array
  if (newData.pageView) {
    updatedIntent.pageViews = [...currentIntent.pageViews, newData.pageView];
  }

  return updatedIntent;
};

export const getIntentLevel = (score: number): IntentLevel => {
  if (score < 30) return 'low';
  if (score <= 70) return 'medium';
  return 'high';
};