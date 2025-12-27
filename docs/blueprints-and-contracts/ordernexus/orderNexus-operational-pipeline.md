# **Document 4: OrderNexus - Operational Pipeline**
**Version:** 2.0 (Locked Blueprint)
**Last Updated:** 2025-01-15
**Related Documents:**
- OrderNexus - Core Architecture & Boundaries
- OrderNexus - Engine Implementation

---

## 12. Ingestion Pipeline & SLA

### 12.1 Queue Message & Worker

```typescript
// packages/order-nexus/src/ingestion/order-ingestion-queue.ts

import { NormalizedOrder } from '../types/core-types';

export interface OrderQueueMessage {
  shopId: number;
  orderId: string;
  order: NormalizedOrder;
  topic: string; // 'orders/create', 'orders/updated', etc.
}

export interface OrderIngestionQueue {
  enqueue(msg: OrderQueueMessage): Promise<void>;
}
```

```typescript
// packages/order-nexus/src/metrics/metrics-client.ts

export interface MetricsClient {
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void;
  incrementCounter(name: string, tags?: Record<string, string>): void;
}
```

```typescript
// packages/order-nexus/src/operations/sla-monitor.ts

export interface SLASpec {
  targetProcessingTime: number;
  warningThreshold: number;
  maxExpectedTime: number;
  successRateTarget: number;
  availabilityTarget: number;
}

export class OrderProcessingSLA {
  private readonly TARGET_PROCESSING_TIME_MS = 5000;
  private readonly WARNING_THRESHOLD_MS = 25000;
  private readonly MAX_EXPECTED_TIME_MS = 60000;

  constructor(private readonly metrics: MetricsClient) {}

  async processOrderWithSLA(
    handler: () => Promise<void>,
    msg: OrderQueueMessage
  ): Promise<void> {
    const startTime = Date.now();

    try {
      await handler();
      const processingTime = Date.now() - startTime;

      this.metrics.recordHistogram('order_processing_time_ms', processingTime, {
        shopId: String(msg.shopId)
      });

      if (processingTime > this.TARGET_PROCESSING_TIME_MS) {
        this.metrics.incrementCounter('order_processing_time_exceeded', {
          shopId: String(msg.shopId)
        });
      }

      if (processingTime > this.WARNING_THRESHOLD_MS) {
        this.metrics.incrementCounter('order_processing_delay_warning', {
          shopId: String(msg.shopId)
        });
      }
    } catch (error: any) {
      this.metrics.incrementCounter('order_processing_error', {
        shopId: String(msg.shopId),
        error: error?.name || 'unknown'
      });
      throw error;
    }
  }

  getSLASpecification(): SLASpec {
    return {
      targetProcessingTime: this.TARGET_PROCESSING_TIME_MS,
      warningThreshold: this.WARNING_THRESHOLD_MS,
      maxExpectedTime: this.MAX_EXPECTED_TIME_MS,
      successRateTarget: 0.99,
      availabilityTarget: 0.995
    };
  }
}
```

```typescript
// packages/order-nexus/src/ingestion/order-worker.ts

export class OrderWorker {
  constructor(
    private readonly profitService: OrderProfitService,
    private readonly slaMonitor: OrderProcessingSLA
  ) {}

  async handleMessage(msg: OrderQueueMessage): Promise<void> {
    await this.slaMonitor.processOrderWithSLA(
      async () => {
        await this.profitService.computeInitialProfit(msg.order);
      },
      msg
    );
  }
}
```

---

## 12.2 Pipeline Health Monitoring

```typescript
// packages/order-nexus/src/operations/pipeline-health-monitor.ts

export interface PipelineHealthMetrics {
  processingTimeP95: number;
  processingTimeP99: number;
  errorRate: number;
  queueDepth: number;
  backlogAgeMinutes: number;
  throughputPerMinute: number;
}

export interface HealthStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  issues: string[];
  lastUpdated: Date;
}

export class PipelineHealthMonitor {
  constructor(
    private readonly metricsClient: MetricsClient,
    private readonly queueClient: OrderIngestionQueue,
    private readonly logger: Logger
  ) {}

  async checkHealth(): Promise<HealthStatus> {
    const issues: string[] = [];
    
    try {
      const metrics = await this.collectMetrics();
      
      // Check processing time thresholds
      if (metrics.processingTimeP99 > 60000) {
        issues.push(`Processing time P99 exceeds 60s: ${metrics.processingTimeP99}ms`);
      }
      
      if (metrics.processingTimeP95 > 30000) {
        issues.push(`Processing time P95 exceeds 30s: ${metrics.processingTimeP95}ms`);
      }
      
      // Check error rate
      if (metrics.errorRate > 0.05) {
        issues.push(`Error rate exceeds 5%: ${(metrics.errorRate * 100).toFixed(1)}%`);
      }
      
      // Check backlog
      if (metrics.backlogAgeMinutes > 30) {
        issues.push(`Backlog age exceeds 30 minutes: ${metrics.backlogAgeMinutes}m`);
      }
      
      // Determine status
      let status: HealthStatus['status'] = 'HEALTHY';
      if (issues.length > 0) {
        status = issues.some(issue => issue.includes('exceeds 60s') || issue.includes('exceeds 10%')) 
          ? 'CRITICAL' 
          : 'DEGRADED';
      }
      
      return {
        status,
        issues,
        lastUpdated: new Date()
      };
      
    } catch (error) {
      this.logger.error('Failed to check pipeline health', { error });
      return {
        status: 'CRITICAL',
        issues: ['Health check failed'],
        lastUpdated: new Date()
      };
    }
  }

  private async collectMetrics(): Promise<PipelineHealthMetrics> {
    // Implementation would integrate with actual metrics storage
    // For now, return stub data
    return {
      processingTimeP95: 4500,
      processingTimeP99: 8500,
      errorRate: 0.01,
      queueDepth: 150,
      backlogAgeMinutes: 5,
      throughputPerMinute: 45
    };
  }
}
```

---

## 12.3 Backfill & Recovery Strategy

```typescript
// packages/order-nexus/src/ingestion/backfill-service.ts

export interface BackfillJob {
  jobId: string;
  shopId: number;
  startDate: string; // ISO
  endDate: string;   // ISO
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  processedCount: number;
  totalCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackfillOptions {
  batchSize: number;
  concurrency: number;
  recomputeExisting: boolean;
  costModelVersion?: string;
}

export class OrderBackfillService {
  constructor(
    private readonly orderSource: OrderSource,
    private readonly profitService: OrderProfitService,
    private readonly queueClient: OrderIngestionQueue,
    private readonly logger: Logger
  ) {}

  async startBackfill(
    shopId: number,
    startDate: Date,
    endDate: Date,
    options: BackfillOptions = {
      batchSize: 100,
      concurrency: 5,
      recomputeExisting: false
    }
  ): Promise<BackfillJob> {
    const jobId = `backfill_${shopId}_${Date.now()}`;
    const job: BackfillJob = {
      jobId,
      shopId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      status: 'PENDING',
      processedCount: 0,
      totalCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Store job metadata
    await this.storeJob(job);
    
    // Start async processing
    this.processBackfillJob(job, options).catch(error => {
      this.logger.error('Backfill job failed', { jobId, error });
    });

    return job;
  }

  private async processBackfillJob(job: BackfillJob, options: BackfillOptions): Promise<void> {
    try {
      job.status = 'RUNNING';
      await this.updateJob(job);

      const orders = await this.orderSource.getOrdersInRange(
        job.shopId,
        new Date(job.startDate),
        new Date(job.endDate)
      );

      job.totalCount = orders.length;
      await this.updateJob(job);

      // Process in batches
      const batches = this.chunkArray(orders, options.batchSize);
      
      for (let i = 0; i < batches.length; i += options.concurrency) {
        const batchPromises = batches
          .slice(i, i + options.concurrency)
          .map(batch => this.processBatch(job, batch, options));
        
        await Promise.all(batchPromises);
        
        job.processedCount = Math.min(
          job.processedCount + (options.batchSize * options.concurrency),
          job.totalCount
        );
        await this.updateJob(job);
      }

      job.status = 'COMPLETED';
      await this.updateJob(job);

    } catch (error) {
      job.status = 'FAILED';
      await this.updateJob(job);
      throw error;
    }
  }

  private async processBatch(
    job: BackfillJob,
    batch: NormalizedOrder[],
    options: BackfillOptions
  ): Promise<void> {
    for (const order of batch) {
      try {
        if (options.recomputeExisting) {
          await this.profitService.recomputeOrderProfitability(
            order.shopId,
            order.id,
            'backfill_recomputation'
          );
        } else {
          await this.queueClient.enqueue({
            shopId: order.shopId,
            orderId: order.id,
            order,
            topic: 'orders/backfill'
          });
        }
      } catch (error) {
        this.logger.warn('Failed to process order in backfill', {
          jobId: job.jobId,
          orderId: order.id,
          error: error.message
        });
        // Continue with other orders in batch
      }
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private async storeJob(job: BackfillJob): Promise<void> {
    // Implementation would store in database
  }

  private async updateJob(job: BackfillJob): Promise<void> {
    job.updatedAt = new Date();
    // Implementation would update in database
  }
}
```

---

## 12.4 Alerting & Notification System

```typescript
// packages/order-nexus/src/operations/alerting-service.ts

export interface AlertRule {
  id: string;
  shopId: number;
  type: 'PROCESSING_DELAY' | 'ERROR_SPIKE' | 'BACKLOG_GROWTH' | 'HEALTH_DEGRADATION';
  threshold: number;
  windowMinutes: number;
  enabled: boolean;
  notificationChannels: ('slack' | 'email' | 'in_app')[];
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  shopId: number;
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  metricValue: number;
  threshold: number;
  triggeredAt: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
}

export class AlertingService {
  constructor(
    private readonly healthMonitor: PipelineHealthMonitor,
    private readonly notificationService: NotificationService,
    private readonly logger: Logger
  ) {}

  async evaluateAlertRules(shopId: number): Promise<AlertEvent[]> {
    const rules = await this.getActiveRules(shopId);
    const health = await this.healthMonitor.checkHealth();
    const events: AlertEvent[] = [];

    for (const rule of rules) {
      const event = await this.evaluateRule(rule, health);
      if (event) {
        events.push(event);
        await this.triggerNotifications(event);
      }
    }

    return events;
  }

  private async evaluateRule(rule: AlertRule, health: HealthStatus): Promise<AlertEvent | null> {
    switch (rule.type) {
      case 'HEALTH_DEGRADATION':
        if (health.status === 'DEGRADED' || health.status === 'CRITICAL') {
          return this.createAlertEvent(
            rule,
            'CRITICAL',
            `Pipeline health is ${health.status}: ${health.issues.join('; ')}`,
            health.status === 'CRITICAL' ? 1.0 : 0.5
          );
        }
        break;
        
      case 'ERROR_SPIKE':
        // Implementation would check actual error rates
        break;
        
      case 'PROCESSING_DELAY':
        // Implementation would check processing time metrics
        break;
        
      case 'BACKLOG_GROWTH':
        // Implementation would check queue depth
        break;
    }
    
    return null;
  }

  private createAlertEvent(
    rule: AlertRule,
    severity: AlertEvent['severity'],
    message: string,
    metricValue: number
  ): AlertEvent {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ruleId: rule.id,
      shopId: rule.shopId,
      severity,
      message,
      metricValue,
      threshold: rule.threshold,
      triggeredAt: new Date(),
      acknowledged: false
    };
  }

  private async triggerNotifications(event: AlertEvent): Promise<void> {
    const rule = await this.getRule(event.ruleId);
    if (!rule) return;

    for (const channel of rule.notificationChannels) {
      try {
        await this.notificationService.send({
          channel,
          title: `OrderNexus Alert: ${event.severity}`,
          message: event.message,
          severity: event.severity,
          metadata: {
            shopId: event.shopId,
            metricValue: event.metricValue,
            threshold: event.threshold
          }
        });
      } catch (error) {
        this.logger.error('Failed to send notification', { channel, error });
      }
    }
  }

  private async getActiveRules(shopId: number): Promise<AlertRule[]> {
    // Implementation would fetch from database
    return [
      {
        id: 'health_degradation',
        shopId,
        type: 'HEALTH_DEGRADATION',
        threshold: 0,
        windowMinutes: 5,
        enabled: true,
        notificationChannels: ['slack', 'in_app']
      }
    ];
  }

  private async getRule(ruleId: string): Promise<AlertRule | null> {
    // Implementation would fetch from database
    return null;
  }
}
```

---

## 12.5 Performance Optimization Strategies

```typescript
// packages/order-nexus/src/optimization/performance-optimizer.ts

export interface PerformanceMetrics {
  averageProcessingTimeMs: number;
  p95ProcessingTimeMs: number;
  memoryUsageMb: number;
  cpuUsagePercent: number;
  databaseQueryTimeMs: number;
  cacheHitRate: number;
}

export interface OptimizationRecommendation {
  id: string;
  type: 'BATCHING' | 'CACHING' | 'INDEXING' | 'CONCURRENCY' | 'QUERY_OPTIMIZATION';
  description: string;
  expectedImprovement: number; // percentage
  difficulty: 'LOW' | 'MEDIUM' | 'HIGH';
  actions: string[];
}

export class PerformanceOptimizer {
  constructor(
    private readonly metricsClient: MetricsClient,
    private readonly databaseClient: DatabaseClient,
    private readonly logger: Logger
  ) {}

  async analyzePerformance(shopId: number): Promise<{
    metrics: PerformanceMetrics;
    recommendations: OptimizationRecommendation[];
  }> {
    const metrics = await this.collectMetrics(shopId);
    const recommendations: OptimizationRecommendation[] = [];

    // Check for slow processing
    if (metrics.averageProcessingTimeMs > 8000) {
      recommendations.push({
        id: 'batch_processing',
        type: 'BATCHING',
        description: 'Order processing is taking longer than optimal',
        expectedImprovement: 40,
        difficulty: 'MEDIUM',
        actions: [
          'Implement batch processing for COGS lookups',
          'Use bulk inserts for profitability history',
          'Cache customer signals across batch'
        ]
      });
    }

    // Check database performance
    if (metrics.databaseQueryTimeMs > 500) {
      recommendations.push({
        id: 'query_optimization',
        type: 'QUERY_OPTIMIZATION',
        description: 'Database queries are slower than expected',
        expectedImprovement: 60,
        difficulty: 'LOW',
        actions: [
          'Add composite indexes on shop_id + order_date',
          'Optimize JOIN queries in profitability calculations',
          'Implement query result caching for common lookups'
        ]
      });
    }

    // Check cache efficiency
    if (metrics.cacheHitRate < 0.7) {
      recommendations.push({
        id: 'caching_strategy',
        type: 'CACHING',
        description: 'Cache hit rate is below optimal level',
        expectedImprovement: 30,
        difficulty: 'MEDIUM',
        actions: [
          'Increase TTL for cost model cache',
          'Implement predictive caching for high-volume shops',
          'Cache customer profitability tiers'
        ]
      });
    }

    return { metrics, recommendations };
  }

  private async collectMetrics(shopId: number): Promise<PerformanceMetrics> {
    // Implementation would collect actual metrics
    return {
      averageProcessingTimeMs: 5200,
      p95ProcessingTimeMs: 12500,
      memoryUsageMb: 256,
      cpuUsagePercent: 45,
      databaseQueryTimeMs: 320,
      cacheHitRate: 0.65
    };
  }

  async applyOptimization(
    shopId: number,
    recommendationId: string
  ): Promise<{ success: boolean; message: string }> {
    // Implementation would apply specific optimizations
    this.logger.info('Applying optimization', { shopId, recommendationId });
    
    // Simulate optimization application
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      success: true,
      message: `Optimization ${recommendationId} applied successfully`
    };
  }
}
```

---

**End of Document 4: Operational Pipeline**

*Next document will cover: Product Vision & Evolution*