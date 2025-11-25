# **Comprehensive Data Entry Model Blueprint (purchase price and landed cost)**

## **1. Core Data Architecture**

### **1.1 Enhanced Data Models**
```typescript
// Primary Cost Data Model
interface ProductCost {
  platform_product_id: string;        // Primary key (Shopify ID)
  purchase_price: Decimal(10,2);      // Supplier cost per unit
  landed_cost_per_unit: Decimal(10,2); // Total cost (shipping, duties, etc.)
  currency: string;                   // ISO 4217 code
  exchange_rate: Decimal(10,6);       // Rate to base currency
  base_currency_amount: Decimal(10,2); // Normalized amount
  cost_breakdown: CostBreakdown;      // Detailed cost components
  confidence_score: Decimal(3,2);     // AI/model confidence
  data_source: DataSource;            // Manual, AI, Supplier, Import
  version: number;                    // Optimistic locking
  created_at: Timestamp;
  updated_at: Timestamp;
}

// Detailed Cost Breakdown
interface CostBreakdown {
  material_cost: Decimal(10,2);
  labor_cost: Decimal(10,2);
  shipping_cost: Decimal(10,2);
  duties_taxes: Decimal(10,2);
  packaging_cost: Decimal(10,2);
  overhead_allocation: Decimal(10,2);
  profit_margin: Decimal(10,2);
  notes: string; // Cost calculation rationale
}

// Audit & Compliance
interface CostAuditLog {
  id: string;
  user_id: string;
  platform_product_id: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  old_values: Partial<ProductCost>;
  new_values: Partial<ProductCost>;
  change_reason: ChangeReason;
  source: 'ui' | 'api' | 'integration' | 'ai';
  confidence_score?: Decimal(3,2);
  ip_address: string;
  user_agent: string;
  timestamp: Timestamp;
}

// User Consent Management
interface UserConsent {
  user_id: string;
  consent_type: 'ocr_processing' | 'voice_recording' | 'data_retention';
  granted: boolean;
  granted_at: Timestamp;
  revoked_at?: Timestamp;
  data_retention_policy: RetentionPolicy;
}
```

### **1.2 Database Schema Optimizations**
```sql
-- Optimized indexes for performance
CREATE INDEX idx_product_costs_platform_id ON product_costs(platform_product_id);
CREATE INDEX idx_product_costs_updated_at ON product_costs(updated_at DESC);
CREATE INDEX idx_audit_product_timestamp ON cost_audit_logs(platform_product_id, timestamp DESC);
CREATE INDEX idx_consent_user_type ON user_consents(user_id, consent_type);

-- Partitioning for large datasets (10M+ records)
CREATE TABLE product_costs_2024 PARTITION OF product_costs 
FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

-- Full-text search for cost notes
CREATE INDEX idx_cost_notes_search ON product_costs USING gin(to_tsvector('english', cost_breakdown->>'notes'));
```

## **2. Multi-Layer Data Entry Architecture**

### **2.1 Entry Point Strategy**
```typescript
interface DataEntryStrategy {
  // Context-aware entry points
  entry_points: {
    products_table: 'inline_quick_edit',
    product_360: 'detailed_modal',
    cost_dashboard: 'bulk_operations',
    mobile_app: 'camera_ocr_voice'
  };
  
  // Progressive disclosure
  disclosure_levels: {
    basic: ['purchase_price', 'landed_cost'],
    advanced: ['cost_breakdown', 'supplier_info', 'margin_analysis'],
    expert: ['formula_calculations', 'ai_optimization', 'supplier_comparison']
  };
  
  // User mode adaptations
  mode_adaptations: {
    survival: { cognitive_load: 'low', features: ['quick_entry', 'basic_validation'] },
    growth: { cognitive_load: 'medium', features: ['bulk_ops', 'margin_calc'] },
    architect: { cognitive_load: 'high', features: ['ai_assistance', 'advanced_analytics'] }
  };
}
```

### **2.2 Real-time Validation Engine**
```typescript
class CostValidationEngine {
  private validators: Validator[] = [
    new NumericRangeValidator({ min: 0, max: 999999.99 }),
    new CurrencyConsistencyValidator(),
    new MarginSafetyValidator({ minMargin: 0.05 }), // 5% minimum margin
    new HistoricalDeviationValidator({ threshold: 0.5 }), // 50% change alert
    new SupplierPatternValidator(),
    new CrossFieldValidator()
  ];

  async validate(costData: Partial<ProductCost>, context: ValidationContext): Promise<ValidationResult> {
    const results = await Promise.all(
      this.validators.map(validator => validator.validate(costData, context))
    );

    return {
      isValid: results.every(r => r.isValid),
      warnings: results.flatMap(r => r.warnings),
      errors: results.flatMap(r => r.errors),
      suggestions: results.flatMap(r => r.suggestions),
      confidence: this.calculateOverallConfidence(results)
    };
  }
}

// Example Validator Implementation
class MarginSafetyValidator implements Validator {
  async validate(costData: Partial<ProductCost>, context: ValidationContext): Promise<ValidatorResult> {
    if (!costData.landed_cost_per_unit || !context.product?.price) {
      return { isValid: true }; // Skip if insufficient data
    }

    const margin = (context.product.price - costData.landed_cost_per_unit) / context.product.price;
    const isValid = margin >= this.config.minMargin;

    return {
      isValid,
      warnings: !isValid ? [{
        code: 'LOW_MARGIN_WARNING',
        message: `Margin (${(margin * 100).toFixed(1)}%) below safety threshold`,
        severity: 'warning',
        suggestion: 'Consider increasing price or reducing costs'
      }] : []
    };
  }
}
```

## **3. Intelligent Data Processing Pipeline**

### **3.1 AI-Assisted Entry Pipeline**
```typescript
class AIDataEntryPipeline {
  private dataSources: AIDataSource[] = [
    new HistoricalCostsSource(),
    new CategoryBenchmarksSource(),
    new SupplierPriceHistorySource(),
    new MarketTrendsSource(),
    new CompetitorAnalysisSource()
  ];

  private validators: AIValidator[] = [
    new InvoiceOCRValidator(),
    new HistoricalConsistencyValidator(),
    new SupplierPatternValidator(),
    new MarketRateValidator()
  ];

  async generateSuggestions(product: Product, userContext: UserContext): Promise<AISuggestion[]> {
    // Gather data from all sources
    const sourceData = await Promise.all(
      this.dataSources.map(source => source.getData(product, userContext))
    );

    // Apply ML model to generate suggestions
    const rawSuggestions = await this.mlModel.predict(sourceData, userContext);

    // Validate suggestions
    const validatedSuggestions = await Promise.all(
      rawSuggestions.map(suggestion => this.validateSuggestion(suggestion, product))
    );

    return validatedSuggestions
      .filter(s => s.confidence >= userContext.confidenceThreshold)
      .sort((a, b) => b.confidence - a.confidence);
  }

  private async validateSuggestion(suggestion: AISuggestion, product: Product): Promise<AISuggestion> {
    const validationResults = await Promise.all(
      this.validators.map(validator => validator.validate(suggestion, product))
    );

    const overallConfidence = this.calculateValidationConfidence(validationResults);
    const requiresManualReview = overallConfidence < 0.8;

    return {
      ...suggestion,
      confidence: overallConfidence,
      validationResults,
      requiresManualReview,
      reasoning: this.generateReasoning(validationResults)
    };
  }
}
```

### **3.2 Bulk Processing Engine**
```typescript
class BulkDataEntryEngine {
  private config = {
    chunkSize: 100,
    maxConcurrent: 5,
    retryAttempts: 3,
    rollbackOnFailure: true
  };

  async processBulkOperation(
    operations: BulkOperation[],
    user: User,
    strategy: ProcessingStrategy
  ): Promise<BulkOperationResult> {
    const chunks = this.chunkOperations(operations, this.config.chunkSize);
    const results: ChunkResult[] = [];

    for (let i = 0; i < chunks.length; i += this.config.maxConcurrent) {
      const concurrentChunks = chunks.slice(i, i + this.config.maxConcurrent);
      const chunkResults = await Promise.all(
        concurrentChunks.map(chunk => this.processChunk(chunk, user, strategy))
      );
      results.push(...chunkResults);
    }

    return this.aggregateResults(results);
  }

  private async processChunk(
    chunk: BulkOperation[],
    user: User,
    strategy: ProcessingStrategy
  ): Promise<ChunkResult> {
    const transaction = await db.transaction();
    
    try {
      const operations = await Promise.all(
        chunk.map(op => this.processSingleOperation(op, user, transaction))
      );

      await transaction.commit();
      
      return {
        successful: operations.filter(op => op.success).length,
        failed: operations.filter(op => !op.success).length,
        errors: operations.filter(op => !op.success).map(op => op.error!)
      };
    } catch (error) {
      await transaction.rollback();
      
      if (strategy === 'continue_with_errors') {
        return this.handlePartialFailure(chunk, error);
      } else {
        throw error;
      }
    }
  }
}
```

## **4. Multi-Currency & Internationalization**

### **4.1 Currency Management System**
```typescript
class CurrencyManagementSystem {
  private sources: ExchangeRateSource[] = [
    new ECBSource(), // Primary: free, unlimited daily
    new FixerSource(), // Fallback: 100 req/month free
    new OpenExchangeRatesSource() // Backup: paid service
  ];

  private cache = new Map<string, { rate: number; timestamp: number }>();
  private readonly CACHE_TTL = 3600000; // 1 hour

  async getExchangeRate(from: string, to: string): Promise<ExchangeRate> {
    const cacheKey = `${from}-${to}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return { rate: cached.rate, source: 'cache', timestamp: cached.timestamp };
    }

    // Try sources in priority order
    for (const source of this.sources) {
      try {
        const rate = await source.getRate(from, to);
        this.cache.set(cacheKey, { rate, timestamp: Date.now() });
        
        return {
          rate,
          source: source.name,
          timestamp: Date.now(),
          reliability: source.reliabilityScore
        };
      } catch (error) {
        console.warn(`Failed to get rate from ${source.name}:`, error);
        continue;
      }
    }

    throw new Error('All exchange rate sources failed');
  }

  async convertCosts(
    costs: ProductCost[],
    targetCurrency: string,
    user: User
  ): Promise<ConvertedCost[]> {
    const rates = await Promise.all(
      costs.map(cost => this.getExchangeRate(cost.currency, targetCurrency))
    );

    return costs.map((cost, index) => ({
      ...cost,
      base_currency_amount: cost.purchase_price * rates[index].rate,
      exchange_rate: rates[index].rate,
      conversion_timestamp: rates[index].timestamp,
      conversion_source: rates[index].source
    }));
  }
}
```

### **4.2 Internationalization Framework**
```typescript
class I18nDataEntryFramework {
  private supportedLocales = ['en', 'es', 'fr', 'de', 'ja', 'ar', 'zh'];
  private rtlLocales = ['ar', 'he'];

  getLocalizedConfig(locale: string): LocalizationConfig {
    return {
      direction: this.rtlLocales.includes(locale) ? 'rtl' : 'ltr',
      numberFormat: this.getNumberFormat(locale),
      currencyFormat: this.getCurrencyFormat(locale),
      dateFormat: this.getDateFormat(locale),
      validationMessages: this.getValidationMessages(locale)
    };
  }

  createLocalizedComponent(component: React.ComponentType, locale: string) {
    const config = this.getLocalizedConfig(locale);
    
    return (props: any) => (
      <I18nProvider value={config}>
        <component {...props} />
      </I18nProvider>
    );
  }
}

// Usage in components
const LocalizedCostInput = i18n.createLocalizedComponent(CostInput, userLocale);
```

## **5. Security & Compliance Framework**

### **5.1 Comprehensive Security Layer**
```typescript
class DataEntrySecurityManager {
  private validators: SecurityValidator[] = [
    new HMACValidator(),
    new RateLimitValidator(),
    new IPWhitelistValidator(),
    new UserPermissionValidator(),
    new DataSanitizationValidator()
  ];

  async validateRequest(request: DataEntryRequest): Promise<SecurityValidationResult> {
    const results = await Promise.all(
      this.validators.map(validator => validator.validate(request))
    );

    const securityScore = this.calculateSecurityScore(results);
    const isAllowed = securityScore >= this.config.minimumSecurityThreshold;

    return {
      isAllowed,
      securityScore,
      violations: results.flatMap(r => r.violations),
      warnings: results.flatMap(r => r.warnings),
      requiredActions: this.determineRequiredActions(results)
    };
  }

  async auditSecurityEvent(event: SecurityEvent): Promise<void> {
    await this.auditLogger.log({
      ...event,
      timestamp: Date.now(),
      sessionId: this.currentSession.id,
      riskLevel: this.calculateRiskLevel(event)
    });

    // Trigger alerts for high-risk events
    if (event.riskLevel === 'high') {
      await this.alertSystem.notifyAdmins(event);
    }
  }
}

// HMAC Validation Implementation
class HMACValidator implements SecurityValidator {
  async validate(request: DataEntryRequest): Promise<SecurityResult> {
    const signature = request.headers['x-signature'];
    const payload = JSON.stringify(request.body);
    const expectedSignature = this.generateHMAC(payload, this.secret);

    if (signature !== expectedSignature) {
      return {
        isValid: false,
        violations: [{
          type: 'INVALID_SIGNATURE',
          severity: 'critical',
          message: 'HMAC signature verification failed'
        }]
      };
    }

    return { isValid: true, violations: [] };
  }
}
```

### **5.2 GDPR/CCPA Compliance Engine**
```typescript
class ComplianceManager {
  private retentionPolicies: RetentionPolicy[] = [
    { dataType: 'ocr_data', duration: '72h', action: 'auto_delete' },
    { dataType: 'voice_recordings', duration: '24h', action: 'auto_delete' },
    { dataType: 'audit_logs', duration: '7y', action: 'archive' },
    { dataType: 'user_consents', duration: '5y', action: 'retain' }
  ];

  async processConsentUpdate(userId: string, consent: UserConsent): Promise<void> {
    // Log consent change for audit
    await this.auditLogger.consentChange(userId, consent);

    // Process immediate actions for revoked consents
    if (!consent.granted) {
      await this.executeDataPurge(userId, consent.consent_type);
    }

    // Update user preferences
    await this.userService.updateConsentPreferences(userId, consent);
  }

  async executeDataPurge(userId: string, dataType: string): Promise<void> {
    const policy = this.retentionPolicies.find(p => p.dataType === dataType);
    
    if (!policy) {
      throw new Error(`No retention policy for data type: ${dataType}`);
    }

    switch (policy.action) {
      case 'auto_delete':
        await this.dataPurgingService.immediatePurge(userId, dataType);
        break;
      case 'archive':
        await this.dataPurgingService.archiveData(userId, dataType);
        break;
      case 'retain':
        // Legal requirement to retain certain data
        break;
    }

    await this.auditLogger.dataPurge(userId, dataType, policy);
  }
}
```

## **6. Performance & Scalability Optimizations**

### **6.1 Advanced Caching Strategy**
```typescript
class DataEntryCacheManager {
  private caches: Map<string, Cache> = new Map();
  private readonly DEFAULT_TTL = 300000; // 5 minutes

  constructor() {
    this.initializeCaches();
  }

  private initializeCaches() {
    // Product data cache (frequently accessed)
    this.caches.set('products', new Cache({
      maxSize: 1000,
      ttl: 60000, // 1 minute
      strategy: 'lru'
    }));

    // Exchange rates cache (longer TTL)
    this.caches.set('exchange_rates', new Cache({
      maxSize: 100,
      ttl: 3600000, // 1 hour
      strategy: 'lru'
    }));

    // AI suggestions cache (short TTL for freshness)
    this.caches.set('ai_suggestions', new Cache({
      maxSize: 500,
      ttl: 30000, // 30 seconds
      strategy: 'lru'
    }));
  }

  async getWithCache<T>(
    key: string,
    cacheName: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cache = this.caches.get(cacheName);
    if (!cache) {
      return await fetcher();
    }

    const cached = cache.get(key);
    if (cached) {
      return cached as T;
    }

    const freshData = await fetcher();
    cache.set(key, freshData);
    return freshData;
  }
}
```

### **6.2 Virtualized Data Handling**
```typescript
class VirtualizedDataManager {
  private viewport: Viewport = { start: 0, end: 0 };
  private chunkSize: number = 100;
  private prefetchThreshold: number = 20;

  constructor(private dataLoader: DataLoader) {}

  async getVisibleData(viewport: Viewport): Promise<VirtualizedData> {
    this.viewport = viewport;
    
    // Calculate chunks needed for current viewport
    const startChunk = Math.floor(viewport.start / this.chunkSize);
    const endChunk = Math.floor(viewport.end / this.chunkSize);
    
    // Load visible chunks
    const chunks = await Promise.all(
      this.getChunkRange(startChunk, endChunk).map(chunkIndex => 
        this.dataLoader.loadChunk(chunkIndex)
      )
    );

    // Prefetch adjacent chunks
    this.prefetchAdjacentChunks(startChunk, endChunk);

    return {
      data: this.mergeChunks(chunks),
      totalCount: await this.dataLoader.getTotalCount(),
      loadedChunks: this.getChunkRange(startChunk, endChunk)
    };
  }

  private prefetchAdjacentChunks(start: number, end: number): void {
    const prefetchStart = Math.max(0, start - this.prefetchThreshold);
    const prefetchEnd = end + this.prefetchThreshold;

    for (let i = prefetchStart; i <= prefetchEnd; i++) {
      if (!this.dataLoader.isChunkLoaded(i)) {
        this.dataLoader.prefetchChunk(i);
      }
    }
  }
}
```

## **7. Advanced User Experience Features**

### **7.1 Intelligent Defaults & Personalization**
```typescript
class PersonalizationEngine {
  private userProfiles: Map<string, UserProfile> = new Map();

  async getPersonalizedDefaults(userId: string, context: EntryContext): Promise<PersonalizedDefaults> {
    const profile = await this.getUserProfile(userId);
    const history = await this.getUserHistory(userId);
    const preferences = await this.getUserPreferences(userId);

    return {
      defaultCurrency: preferences.currency || profile.baseCurrency,
      costBreakdownTemplate: this.getPreferredTemplate(profile, history),
      validationStrictness: profile.riskTolerance === 'low' ? 'strict' : 'balanced',
      aiAssistanceLevel: this.calculateAIAssistanceLevel(profile, history),
      preferredEntryMethod: this.determinePreferredMethod(profile, history, context)
    };
  }

  private calculateAIAssistanceLevel(profile: UserProfile, history: UserHistory): AILevel {
    const acceptanceRate = history.aiSuggestionsAccepted / history.aiSuggestionsOffered;
    
    if (acceptanceRate > 0.7) {
      return 'aggressive'; // User frequently accepts AI suggestions
    } else if (acceptanceRate > 0.3) {
      return 'balanced'; // User sometimes uses AI suggestions
    } else {
      return 'conservative'; // User prefers manual entry
    }
  }
}
```

### **7.2 Real-time Collaboration Features**
```typescript
class CollaborationManager {
  private sessions: Map<string, CollaborationSession> = new Map();

  async startCollaborativeSession(
    productId: string,
    users: User[],
    sessionType: SessionType
  ): Promise<CollaborationSession> {
    const session: CollaborationSession = {
      id: generateId(),
      productId,
      participants: users,
      sessionType,
      startTime: Date.now(),
      changes: [],
      lockManager: new LockManager(),
      conflictResolver: new ConflictResolver()
    };

    this.sessions.set(session.id, session);
    
    // Notify all participants
    await this.notificationService.notifyUsers(users, {
      type: 'collaboration_invite',
      sessionId: session.id,
      productId
    });

    return session;
  }

  async handleConcurrentUpdate(
    session: CollaborationSession,
    update: CostUpdate,
    user: User
  ): Promise<UpdateResult> {
    // Acquire lock for the product
    const lock = await session.lockManager.acquire(update.platform_product_id, user.id);
    
    try {
      // Check for conflicts
      const conflicts = await session.conflictResolver.detectConflicts(update, session.changes);
      
      if (conflicts.length > 0) {
        return {
          success: false,
          conflicts,
          resolution: await this.resolveConflicts(conflicts, user)
        };
      }

      // Apply update
      const result = await this.applyUpdate(update);
      session.changes.push({
        ...update,
        userId: user.id,
        timestamp: Date.now()
      });

      // Broadcast to other participants
      await this.broadcastUpdate(session, update, user);

      return { success: true, conflicts: [] };
    } finally {
      await session.lockManager.release(lock);
    }
  }
}
```

## **8. Monitoring, Analytics & Optimization**

### **8.1 Comprehensive Telemetry System**
```typescript
class DataEntryTelemetry {
  private metrics: TelemetryMetric[] = [];
  private readonly FLUSH_INTERVAL = 30000; // 30 seconds

  trackEvent(event: TelemetryEvent): void {
    this.metrics.push({
      ...event,
      timestamp: Date.now(),
      sessionId: this.currentSession.id,
      userAgent: navigator.userAgent,
      viewport: this.getViewportInfo()
    });

    // Batch flush to reduce network overhead
    if (this.metrics.length >= 100 || this.shouldFlush()) {
      this.flushMetrics();
    }
  }

  private async flushMetrics(): Promise<void> {
    const batch = this.metrics.splice(0, this.metrics.length);
    
    try {
      await this.analyticsService.recordBatch(batch);
    } catch (error) {
      // Requeue failed metrics with exponential backoff
      this.metrics.unshift(...batch);
      this.scheduleRetry();
    }
  }

  getPerformanceInsights(): PerformanceInsights {
    return {
      averageEntryTime: this.calculateAverageEntryTime(),
      errorRate: this.calculateErrorRate(),
      userSatisfaction: this.calculateSatisfactionScore(),
      featureAdoption: this.calculateAdoptionRates(),
      performanceBottlenecks: this.identifyBottlenecks()
    };
  }
}
```

### **8.2 A/B Testing & Experimentation Framework**
```typescript
class ExperimentationEngine {
  private experiments: Map<string, Experiment> = new Map();
  private readonly SIGNIFICANCE_LEVEL = 0.95;

  async runExperiment(experiment: ExperimentConfig): Promise<ExperimentResult> {
    const variantAssignment = this.assignVariant(experiment);
    const tracking = await this.trackVariantPerformance(experiment, variantAssignment);

    return {
      experimentId: experiment.id,
      variant: variantAssignment.variant,
      metrics: tracking.metrics,
      statisticalSignificance: this.calculateSignificance(tracking),
      confidenceInterval: this.calculateConfidenceInterval(tracking),
      recommendation: this.generateRecommendation(tracking)
    };
  }

  private assignVariant(experiment: ExperimentConfig): VariantAssignment {
    // Use consistent hashing for user assignment
    const userHash = this.hashUser(experiment.userId);
    const variantIndex = userHash % experiment.variants.length;
    
    return {
      userId: experiment.userId,
      experimentId: experiment.id,
      variant: experiment.variants[variantIndex],
      assignmentTimestamp: Date.now()
    };
  }

  async autoRollout(experiment: Experiment): Promise<void> {
    const results = await this.getExperimentResults(experiment.id);
    
    if (results.statisticalSignificance >= this.SIGNIFICANCE_LEVEL && 
        results.metrics.primary > experiment.successThreshold) {
      
      await this.rolloutManager.rolloutVariant(
        experiment.id,
        results.variant,
        results.confidenceInterval
      );
    }
  }
}
```

## **9. Error Handling & Resilience**

### **9.1 Comprehensive Error Recovery**
```typescript
class ErrorRecoveryManager {
  private recoveryStrategies: Map<string, RecoveryStrategy> = new Map();

  async handleError(error: DataEntryError, context: ErrorContext): Promise<RecoveryResult> {
    const strategy = this.recoveryStrategies.get(error.type) || this.getFallbackStrategy();
    
    try {
      const result = await strategy.execute(error, context);
      
      await this.telemetry.trackRecoveryAttempt(error, strategy, result);
      
      return result;
    } catch (recoveryError) {
      // Escalate to fallback strategy
      return await this.executeFallbackStrategy(error, context, recoveryError);
    }
  }

  private getFallbackStrategy(): RecoveryStrategy {
    return {
      execute: async (error: DataEntryError, context: ErrorContext) => {
        // Conservative fallback: preserve data, notify user
        await this.notificationService.notifyUser(context.userId, {
          type: 'error_recovery',
          error: error.message,
          action: 'manual_review_required'
        });

        return {
          success: false,
          action: 'manual_intervention_required',
          preservedData: context.unsavedData,
          recoverySteps: ['Contact support if issue persists']
        };
      }
    };
  }
}
```

### **9.2 Circuit Breaker Pattern**
```typescript
class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly threshold: number = 5;
  private readonly timeout: number = 60000; // 1 minute

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await operation();
      
      // Reset on success
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failureCount = 0;
      }
      
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.threshold) {
        this.state = 'open';
      }

      throw error;
    }
  }
}
```

## **10. Deployment & Operations**

### **10.1 Infrastructure as Code**
```yaml
# Kubernetes Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cost-data-entry
  labels:
    app: cost-data-entry
    tier: frontend
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: cost-data-entry
  template:
    metadata:
      labels:
        app: cost-data-entry
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      containers:
      - name: cost-data-entry
        image: cost-data-entry:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: API_BASE_URL
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: api.url
        - name: AI_SERVICE_URL
          valueFrom:
            secretKeyRef:
              name: ai-service-secret
              key: url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: cost-data-entry-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: cost-data-entry
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### **10.2 Monitoring & Alerting**
```yaml
# Prometheus Monitoring Rules
groups:
- name: cost_data_entry
  rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High error rate detected"
      description: "Error rate is above 5% for the last 5 minutes"
  
  - alert: SlowResponseTime
    expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Slow response times detected"
      description: "95th percentile response time is above 2 seconds"
  
  - alert: AI Service Degradation
    expr: rate(ai_suggestion_failures_total[5m]) > 10
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "AI service degradation"
      description: "High rate of AI suggestion failures detected"
```

This comprehensive data entry model blueprint provides a robust, scalable, and intelligent foundation for the Cost Data Entry Portal, incorporating all enhancements and optimizations discussed while ensuring enterprise-grade security, performance, and user experience.
