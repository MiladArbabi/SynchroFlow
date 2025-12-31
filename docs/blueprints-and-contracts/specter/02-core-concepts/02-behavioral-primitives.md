# Specter: Behavioral Primitives System

## Overview

Behavioral primitives are the fundamental building blocks of customer intelligence in Specter. These are privacy-safe, mathematically-defined metrics that describe customer behavior without revealing individual identity. This system transforms raw session data into actionable intelligence while maintaining strict PCD compliance.

## Core Philosophy

### The Primitive Mindset

1. **Atomism**: Complex behaviors decompose into simple, measurable primitives
2. **Privacy**: Primitives never contain PII; they're aggregated or anonymized
3. **Composition**: Complex insights emerge from primitive combinations
4. **Evolution**: Primitives evolve from simple (v1) to sophisticated (v3)

### Why Primitives Matter

```
Raw Data → Primitives → Insights → Actions
    ↓           ↓          ↓         ↓
 Sessions  → Metrics → Patterns → Decisions
(Anonymized)          (Emergent)  (Safe)
```

## Tier 1: Foundational Primitives (v1/v1.5)

### Session-Level Primitives

#### 1. Session Count (`session_count`)

**Definition**: Total number of anonymous sessions for a given time window
```typescript
interface SessionCountPrimitive {
  value: number;
  timeWindow: '1h' | '24h' | '7d' | '30d';
  shopId: number;
  confidence: number; // 0-1, based on data completeness
}
```

**Calculation**:
```sql
-- Pseudocode for session_count calculation
SELECT COUNT(DISTINCT session_id) as session_count
FROM anonymous_sessions
WHERE shop_id = ?
  AND created_at >= ?
  AND created_at < ?
```

**Use Case**: Baseline metric for all behavioral analysis. Serves as denominator for rates.

#### 2. Exit Intent Count (`exit_intent_count`)

**Definition**: Number of sessions where exit intent was detected
```typescript
interface ExitIntentPrimitive {
  value: number;
  timeWindow: '1h' | '24h' | '7d' | '30d';
  shopId: number;
  detectedAt: number[]; // Timestamps of exit intents (optional)
}
```

**Detection Criteria**:
1. Mouse movement toward browser chrome (non-page area)
2. Tab/window close attempt detected
3. Idle timeout with no interaction
4. Multiple rapid back/forward navigation attempts

**Privacy Consideration**: Only track existence, not the specific user action.

#### 3. Page-Level Primitives

##### Page View Count (`page_view_count`)

**Definition**: Number of times a specific page was viewed
```typescript
interface PageViewPrimitive {
  pageKey: string; // Normalized page path
  viewCount: number;
  uniqueSessionCount: number;
  timeWindow: '1h' | '24h' | '7d' | '30d';
}
```

##### Page Exit Intent Rate (`page_exit_intent_rate`)

**Definition**: Likelihood of exit intent on a specific page
```typescript
interface PageExitIntentPrimitive {
  pageKey: string;
  exitIntentRate: number; // 0-1
  confidence: number; // Based on sample size
  sessionsWithExitIntent: number;
  totalSessionsOnPage: number;
}
```

**Calculation**:
```
page_exit_intent_rate = 
  sessions_with_exit_intent_on_page / total_sessions_on_page
```

### Behavioral Rate Primitives

#### 1. Exit Intent Rate (`exit_intent_rate`)

**Definition**: Overall probability of exit intent across all sessions
```typescript
interface ExitIntentRatePrimitive {
  value: number; // 0-1
  timeWindow: '1h' | '24h' | '7d' | '30d';
  shopId: number;
  confidenceInterval: [number, number]; // 95% CI
}
```

**Calculation**:
```
exit_intent_rate = exit_intent_count / session_count
```

**Interpretation**:
- `< 0.1`: Low abandonment concern
- `0.1 - 0.3`: Moderate optimization opportunity
- `> 0.3`: High priority for intervention

#### 2. Session Depth (`session_depth`)

**Definition**: Average number of pages viewed per session
```typescript
interface SessionDepthPrimitive {
  mean: number;
  median: number;
  distribution: Array<{
    depth: number;
    frequency: number;
  }>;
}
```

**Calculation**:
```
session_depth = total_page_views / session_count
```

### Time-Based Primitives

#### 1. Session Duration (`session_duration`)

**Definition**: Time spent in session (without PII-based tracking)
```typescript
interface SessionDurationPrimitive {
  meanSeconds: number;
  medianSeconds: number;
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
}
```

**Privacy-Safe Calculation**:
```typescript
// Calculated from first to last page view timestamp
// Never tracks continuous activity
function calculateSessionDuration(session: AnonymousSession): number {
  const firstView = session.createdAt;
  const lastView = session.pagesViewed.length > 0 
    ? getLastPageViewTime(session) 
    : firstView;
  return lastView - firstView;
}
```

#### 2. Peak Activity Windows

**Definition**: Time periods with highest session activity
```typescript
interface PeakActivityPrimitive {
  shopId: number;
  peaks: Array<{
    hourOfDay: number; // 0-23
    dayOfWeek: number; // 0-6
    intensity: number; // 0-1, relative to max
    sessionCount: number;
  }>;
  timezone: string; // Shop's timezone
}
```

## Tier 2: Derived Behavioral Metrics

### Funnel Analysis Primitives

#### 1. Conversion Path Analysis

```typescript
interface ConversionPathPrimitive {
  commonPaths: Array<{
    path: string[]; // Array of page keys
    frequency: number;
    conversionRate: number;
    avgPathLength: number;
  }>;
  dropOffPoints: Array<{
    pageKey: string;
    dropOffRate: number;
    sessionsReaching: number;
    sessionsContinuing: number;
  }>;
}
```

**Calculation Example**:
```
// For page X in conversion path
drop_off_rate(X) = 
  sessions_dropping_at_X / sessions_reaching_X
```

#### 2. Page Transition Probability

**Definition**: Likelihood of moving from one page to another
```typescript
interface PageTransitionPrimitive {
  fromPage: string;
  toPage: string;
  probability: number; // 0-1
  sampleSize: number;
  confidence: number;
}
```

**Privacy Note**: Only calculated for cohorts, never individuals.

### Engagement Score Primitives

#### 1. Session Engagement Score

```typescript
interface EngagementScorePrimitive {
  score: number; // 0-100
  components: {
    durationScore: number; // Weight: 0.3
    depthScore: number;    // Weight: 0.4
    interactionScore: number; // Weight: 0.3
  };
  timeWindow: '24h' | '7d' | '30d';
}
```

**Calculation**:
```
engagement_score = 
  (duration_normalized * 0.3) +
  (depth_normalized * 0.4) + 
  (interaction_normalized * 0.3)
```

#### 2. Page Engagement Score

```typescript
interface PageEngagementPrimitive {
  pageKey: string;
  engagementScore: number;
  metrics: {
    avgTimeOnPage: number;
    bounceRate: number;
    scrollDepth: number; // Aggregate only, not per user
    interactionRate: number; // Clicks, hovers (aggregate)
  };
}
```

## Tier 3: Behavioral Cohorts & Patterns

### Cohort Primitives

#### 1. Behavioral Cohort Signature

```typescript
interface CohortSignaturePrimitive {
  cohortId: string; // e.g., "high_engagement_exit_intent"
  size: number;     // Minimum 50 for privacy
  signature: {
    exitIntentRate: number;
    sessionDepth: number;
    sessionDuration: number;
    conversionRate: number;
    pagePreferences: Array<{
      pageKey: string;
      preferenceScore: number;
    }>;
  };
  stability: number; // How stable this cohort is over time
}
```

**Privacy Guarantee**: No individual can be identified from cohort signature.

#### 2. Cohort Evolution Tracking

```typescript
interface CohortEvolutionPrimitive {
  cohortId: string;
  changes: Array<{
    timestamp: string;
    metric: string;
    oldValue: number;
    newValue: number;
    changeMagnitude: number;
  }>;
  driftScore: number; // 0-1, how much cohort has changed
}
```

### Pattern Detection Primitives

#### 1. Behavioral Sequence Pattern

```typescript
interface SequencePatternPrimitive {
  pattern: string[]; // Sequence of behavioral events
  support: number;   // How often this pattern occurs
  confidence: number; // How predictive this pattern is
  lift: number;      // Improvement over random
}
```

**Example Pattern**:
```
["landing_page", "product_page", "cart", "exit_intent"]
```

#### 2. Anomaly Detection Primitives

```typescript
interface BehavioralAnomalyPrimitive {
  anomalyType: 'spike' | 'drop' | 'shift' | 'outlier';
  metric: string;
  expectedValue: number;
  observedValue: number;
  deviation: number; // In standard deviations
  startTime: string;
  endTime: string;
  confidence: number;
}
```

## Tier 4: Predictive & Advanced Primitives (v2/v3)

### Predictive Behavioral Primitives

#### 1. Exit Intent Probability

```typescript
interface ExitIntentPredictionPrimitive {
  sessionId: string;
  probability: number; // 0-1
  contributingFactors: Array<{
    factor: string;
    weight: number;
    value: number;
  }>;
  predictionHorizon: number; // Seconds until predicted exit
  confidence: number;
}
```

**Prediction Factors**:
- Time on page
- Scroll behavior (aggregate)
- Previous page sequence
- Time of day/day of week

#### 2. Conversion Probability

```typescript
interface ConversionPredictionPrimitive {
  sessionId: string;
  probability: number;
  expectedValue: number; // Predicted order value
  timeToConversion: number; // Predicted minutes
  keyInfluencers: string[]; // Which factors most influence
}
```

### Advanced Behavioral Primitives

#### 1. Behavioral Volatility

```typescript
interface BehavioralVolatilityPrimitive {
  shopId: number;
  volatilityScore: number; // 0-1
  metrics: {
    sessionCountVariance: number;
    exitIntentRateVariance: number;
    engagementVariance: number;
  };
  timeWindows: {
    hourly: number;
    daily: number;
    weekly: number;
  };
}
```

**Interpretation**: High volatility may indicate inconsistent experience or external factors.

#### 2. Behavioral Seasonality

```typescript
interface SeasonalityPrimitive {
  shopId: number;
  patterns: Array<{
    period: 'hourly' | 'daily' | 'weekly' | 'monthly';
    amplitude: number; // Strength of pattern
    phase: number;     // When pattern occurs
    confidence: number;
  }>;
  decomposition: {
    trend: number[];
    seasonal: number[];
    residual: number[];
  };
}
```

## Primitive Combination Framework

### Formula-Based Derived Metrics

#### 1. Nudge Opportunity Score

```typescript
interface NudgeOpportunityPrimitive {
  pageKey: string;
  opportunityScore: number; // 0-100
  components: {
    exitIntentRate: number;      // Weight: 0.4
    pageValueScore: number;      // Weight: 0.3
    conversionProbability: number; // Weight: 0.3
  };
  expectedLift: number;    // 0-1, predicted conversion lift
  confidence: number;      // 0-1, confidence in prediction
}
```

**Calculation**:
```
opportunity_score = 
  (exit_intent_rate * 40) +
  (page_value_score * 30) +
  (conversion_probability * 30)
```

#### 2. Behavioral Health Score

```typescript
interface BehavioralHealthPrimitive {
  shopId: number;
  overallScore: number;
  dimensions: {
    engagement: number;
    conversion: number;
    retention: number;
    satisfaction: number; // Derived from behavior patterns
  };
  trends: {
    dayOverDay: number;
    weekOverWeek: number;
    monthOverMonth: number;
  };
}
```

### Cascading Primitive Calculations

```
Level 1: Raw Primitives
  ↓
  session_count
  exit_intent_count
  page_view_count
  ↓
Level 2: Rate Primitives
  ↓
  exit_intent_rate = exit_intent_count / session_count
  session_depth = total_page_views / session_count
  ↓
Level 3: Composite Primitives
  ↓
  engagement_score = f(session_depth, session_duration, ...)
  nudge_opportunity = g(exit_intent_rate, page_value, ...)
  ↓
Level 4: Predictive Primitives
  ↓
  conversion_probability = h(engagement_score, behavioral_patterns, ...)
```

## Privacy-Preserving Computation

### Differential Privacy Framework

```typescript
class DifferentialPrivacyEngine {
  private epsilon: number;
  
  constructor(epsilon: number = 0.1) {
    this.epsilon = epsilon;
  }
  
  // Add Laplace noise for privacy
  addNoise(value: number, sensitivity: number = 1): number {
    const scale = sensitivity / this.epsilon;
    return value + this.laplaceNoise(0, scale);
  }
  
  // Aggregate with privacy guarantees
  async computePrivatePrimitive(
    data: number[],
    operation: 'sum' | 'mean' | 'count'
  ): PrivatePrimitiveResult {
    const trueResult = this.computeTrueValue(data, operation);
    const noisyResult = this.addNoise(trueResult);
    
    return {
      value: noisyResult,
      privacyBudgetUsed: this.epsilon,
      confidenceInterval: this.computeConfidence(noisyResult),
      isPrivate: true
    };
  }
}
```

### Cohort-Based Aggregation Rules

#### Rule 1: Minimum Cohort Size

```typescript
const MIN_COHORT_SIZE = 50;

function ensureCohortPrivacy(
  cohort: BehavioralCohort
): PrivacySafeCohort | null {
  if (cohort.size < MIN_COHORT_SIZE) {
    // Merge with similar cohort or suppress
    return this.mergeOrSuppress(cohort);
  }
  return this.anonymizeCohort(cohort);
}
```

#### Rule 2: Value Suppression

```typescript
function suppressSensitiveValues(
  primitive: BehavioralPrimitive
): PrivacySafePrimitive {
  // Remove any values that could reveal individuals
  const safePrimitive = { ...primitive };
  
  if (primitive.sampleSize < 10) {
    safePrimitive.value = null;
    safePrimitive.confidence = 0;
  }
  
  return safePrimitive;
}
```

## Storage and Retrieval Architecture

### Redis Data Structure for Primitives

#### Time-Series Storage

```typescript
// Store primitives with timestamp for time-series analysis
const primitiveKey = `specter:shop:${shopId}:primitives:${primitiveName}`;

// Using Redis Sorted Sets for time-series
await redis.zadd(primitiveKey, timestamp, JSON.stringify({
  value: primitiveValue,
  timestamp,
  window: timeWindow,
  confidence: confidence
}));

// Retrieve time range
const primitives = await redis.zrangebyscore(
  primitiveKey,
  startTimestamp,
  endTimestamp
);
```

#### Aggregated View Storage

```typescript
// Store pre-computed aggregates for common queries
const aggregateKey = `specter:shop:${shopId}:aggregates:${window}`;

const aggregates = {
  '24h': {
    session_count: 1500,
    exit_intent_rate: 0.25,
    top_pages: [...]
  },
  '7d': {
    session_count: 10500,
    exit_intent_rate: 0.23,
    top_pages: [...]
  }
};

await redis.set(aggregateKey, JSON.stringify(aggregates));
await redis.expire(aggregateKey, 3600); // Refresh every hour
```

### Primitive Calculation Pipeline

```typescript
class PrimitiveCalculationPipeline {
  async computePrimitives(
    sessions: AnonymousSession[],
    events: SpecterEvent[]
  ): Promise<ComputedPrimitives> {
    // Step 1: Compute raw counts
    const rawPrimitives = await this.computeRawPrimitives(sessions);
    
    // Step 2: Compute rates and ratios
    const ratePrimitives = await this.computeRatePrimitives(rawPrimitives);
    
    // Step 3: Apply privacy transforms
    const privatePrimitives = await this.applyPrivacyTransforms(ratePrimitives);
    
    // Step 4: Compute derived metrics
    const derivedPrimitives = await this.computeDerivedPrimitives(privatePrimitives);
    
    // Step 5: Generate insights
    const insights = await this.generateInsights(derivedPrimitives);
    
    return {
      raw: rawPrimitives,
      rates: ratePrimitives,
      private: privatePrimitives,
      derived: derivedPrimitives,
      insights
    };
  }
}
```

## Usage Examples

### Example 1: Identifying Top Nudge Opportunities

```typescript
async function identifyNudgeOpportunities(shopId: number): Promise<NudgeOpportunity[]> {
  // Get primitives for last 7 days
  const primitives = await primitiveStore.getPrimitives(shopId, '7d');
  
  // Filter pages with sufficient data
  const candidatePages = primitives.pages.filter(
    page => page.sessionCount >= 100
  );
  
  // Calculate opportunity score for each page
  const opportunities = candidatePages.map(page => ({
    pageKey: page.pageKey,
    opportunityScore: calculateOpportunityScore(page),
    exitIntentRate: page.exitIntentRate,
    conversionProbability: predictConversionProbability(page),
    expectedLift: calculateExpectedLift(page)
  }));
  
  // Sort by opportunity score
  return opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);
}
```

### Example 2: Behavioral Trend Analysis

```typescript
async function analyzeBehavioralTrends(shopId: number): Promise<TrendAnalysis> {
  // Get primitives for multiple time windows
  const [daily, weekly, monthly] = await Promise.all([
    primitiveStore.getPrimitives(shopId, '24h'),
    primitiveStore.getPrimitives(shopId, '7d'),
    primitiveStore.getPrimitives(shopId, '30d')
  ]);
  
  // Calculate trends
  const trends = {
    exitIntentRate: {
      daily: daily.exitIntentRate,
      weekly: weekly.exitIntentRate,
      monthly: monthly.exitIntentRate,
      trend: calculateTrend([daily, weekly, monthly], 'exitIntentRate')
    },
    engagement: {
      daily: daily.engagementScore,
      weekly: weekly.engagementScore,
      monthly: monthly.engagementScore,
      trend: calculateTrend([daily, weekly, monthly], 'engagementScore')
    }
  };
  
  // Detect anomalies
  const anomalies = detectAnomalies(trends);
  
  return { trends, anomalies };
}
```

## Evolution of Primitives

### v1 Primitives (Current)

- Session count
- Exit intent count/rate
- Page view counts
- Basic engagement metrics
- Simple nudge opportunities

### v2 Primitives (Near-term)

- Behavioral sequences
- Cohort signatures
- Predictive probabilities
- Advanced anomaly detection
- Cross-session patterns

### v3 Primitives (Future)

- Real-time behavioral forecasting
- Causal inference models
- Multi-channel behavior patterns
- Automated experiment design
- Ecosystem-wide behavioral coordination

## Validation and Testing

### Unit Testing Primitives

```typescript
describe('Behavioral Primitives', () => {
  describe('Exit Intent Rate', () => {
    it('calculates rate correctly', () => {
      const sessions = [
        { exitIntent: true },
        { exitIntent: false },
        { exitIntent: true },
        { exitIntent: false },
        { exitIntent: false }
      ];
      
      const rate = calculateExitIntentRate(sessions);
      expect(rate).toBe(0.4); // 2/5
    });
    
    it('handles empty sessions', () => {
      const rate = calculateExitIntentRate([]);
      expect(rate).toBe(0);
    });
    
    it('respects privacy constraints', () => {
      const sessions = [
        { exitIntent: true, sessionId: 's1' },
        { exitIntent: false, sessionId: 's2' }
      ];
      
      // Should not leak session IDs in calculation
      const rate = calculateExitIntentRate(sessions);
      expect(rate).toBe(0.5);
    });
  });
});
```

### Integration Testing

```typescript
describe('Primitive Calculation Pipeline', () => {
  let pipeline: PrimitiveCalculationPipeline;
  
  beforeEach(() => {
    pipeline = new PrimitiveCalculationPipeline();
  });
  
  it('computes full primitive set', async () => {
    const mockSessions = generateMockSessions(100);
    const mockEvents = generateMockEvents(500);
    
    const result = await pipeline.computePrimitives(mockSessions, mockEvents);
    
    expect(result.raw.session_count).toBe(100);
    expect(result.rates.exit_intent_rate).toBeGreaterThan(0);
    expect(result.derived.engagement_score).toBeDefined();
    expect(result.insights.nudge_opportunities).toBeDefined();
    
    // Verify privacy compliance
    expect(isPrivacyCompliant(result.private)).toBe(true);
  });
});
```

## Conclusion

Specter's behavioral primitives system provides a rigorous, privacy-safe framework for understanding customer behavior. By decomposing complex behaviors into measurable components, Specter enables:

1. **Actionable Insights**: Clear metrics that drive decisions
2. **Privacy Protection**: Intelligence without identity
3. **Scalable Analysis**: From simple counts to predictive models
4. **Continuous Evolution**: Primitive system grows with business needs

These primitives form the foundation of all Specter intelligence, ensuring that every recommendation and insight is based on measurable, understandable, and privacy-compliant behavioral data.

---

*The behavioral primitive system is the language through which Specter understands customers. By defining this language clearly and rigorously, we ensure that our intelligence is both powerful and responsible.*