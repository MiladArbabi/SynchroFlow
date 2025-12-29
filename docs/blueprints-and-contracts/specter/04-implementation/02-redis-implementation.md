# Specter: Redis Implementation Guide

## Overview

This document provides a comprehensive deep dive into Specter's Redis implementation, covering architecture, data structures, performance optimizations, and operational patterns. Redis serves as the primary hot store for Specter's stateful data, enabling low-latency access to session and event data.

## Architecture

### Redis Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Specter Application                   │
├─────────────────────────────────────────────────────────┤
│  Redis Client (ioredis)                                 │
│    ├── Connection Pooling                               │
│    ├── Pipeline Support                                 │
│    ├── Cluster Awareness                                │
│    └── Sentinel Support                                 │
├─────────────────────────────────────────────────────────┤
│                    Redis Cluster                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Shard 1  │  │ Shard 2  │  │ Shard 3  │              │
│  │ Master   │  │ Master   │  │ Master   │              │
│  │ Replica  │  │ Replica  │  │ Replica  │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│        │             │             │                    │
│        └─────────────┼─────────────┘                    │
│                      │                                  │
│                Cluster Coordinator                      │
└─────────────────────────────────────────────────────────┘
```

### Connection Management

```typescript
// Redis connection configuration
interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  
  // Connection settings
  retryStrategy?: (times: number) => number | null;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
  autoResendUnfulfilledCommands?: boolean;
  
  // Pool settings
  connectionPoolSize?: number;
  connectionPoolMinIdle?: number;
  
  // Cluster settings
  cluster?: boolean;
  nodes?: Array<{ host: string; port: number }>;
  scaleReads?: 'master' | 'slave' | 'all';
}

// Default configuration
const DEFAULT_REDIS_CONFIG: RedisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  enableReadyCheck: true,
  autoResendUnfulfilledCommands: true,
  
  connectionPoolSize: 10,
  connectionPoolMinIdle: 2
};
```

### Redis Client Factory

```typescript
import Redis, { Cluster } from 'ioredis';

export class RedisClientFactory {
  static createClient(config: RedisConfig): Redis | Cluster {
    if (config.cluster && config.nodes) {
      return new Cluster(config.nodes, {
        scaleReads: config.scaleReads || 'slave',
        redisOptions: {
          password: config.password,
          maxRetriesPerRequest: config.maxRetriesPerRequest,
          retryStrategy: config.retryStrategy
        }
      });
    }
    
    return new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      maxRetriesPerRequest: config.maxRetriesPerRequest,
      retryStrategy: config.retryStrategy,
      enableReadyCheck: config.enableReadyCheck,
      autoResendUnfulfilledCommands: config.autoResendUnfulfilledCommands,
      connectionPoolSize: config.connectionPoolSize,
      connectionPoolMinIdle: config.connectionPoolMinIdle
    });
  }
}
```

## Data Structures

### Key Design Patterns

#### 1. Namespacing Strategy

```
specter:{namespace}:{entity}:{id}:{field}
```

Where:

- `specter`: Root namespace for all Specter keys
- `namespace`: Data type classification (shop, global, system)
- `entity`: Entity type (session, event, config, state, insight)
- `id`: Entity identifier (shopId, sessionId, etc.)
- `field`: Optional field specifier

#### 2. Complete Key Reference

| Key Pattern | Redis Type | Description | TTL | Shard Key |
|-------------|------------|-------------|-----|-----------|
| `specter:shop:{shopId}:sessions` | LIST | AnonymousSession objects, newest-first | 7 days | shopId |
| `specter:shop:{shopId}:events` | LIST | SpecterEvent objects, newest-first | 30 days | shopId |
| `specter:shop:{shopId}:config` | STRING | JSON-serialized config | 1 day | shopId |
| `specter:shop:{shopId}:state` | HASH | State machine state (FT1) | none | shopId |
| `specter:shop:{shopId}:insights` | LIST | Insight objects (FT1) | 30 days | shopId |
| `specter:shop:{shopId}:commands` | LIST | Command history (FT1) | 90 days | shopId |
| `specter:shop:{shopId}:meta` | HASH | Metadata and counters | 7 days | shopId |
| `specter:global:shops:active` | SET | Set of active shop IDs | none | global |
| `specter:global:counters` | HASH | Global counters | none | global |
| `specter:system:locks:{resource}` | STRING | Distributed locks | 10 seconds | resource |

### Data Serialization

#### JSON Serialization with Compression

```typescript
interface RedisSerializer {
  serialize<T>(data: T): string;
  deserialize<T>(json: string): T;
  compressedSerialize<T>(data: T): Buffer;
  compressedDeserialize<T>(buffer: Buffer): T;
}

class SpecterRedisSerializer implements RedisSerializer {
  private compressionThreshold: number = 1024; // 1KB
  
  serialize<T>(data: T): string {
    return JSON.stringify(data, this.getReplacer());
  }
  
  deserialize<T>(json: string): T {
    return JSON.parse(json, this.getReviver());
  }
  
  compressedSerialize<T>(data: T): Buffer {
    const json = this.serialize(data);
    
    if (json.length > this.compressionThreshold) {
      return this.compress(json);
    }
    
    return Buffer.from(json, 'utf8');
  }
  
  compressedDeserialize<T>(buffer: Buffer): T {
    try {
      const json = this.decompress(buffer);
      return this.deserialize(json);
    } catch {
      // Fallback to direct buffer conversion
      return this.deserialize(buffer.toString('utf8'));
    }
  }
  
  private compress(text: string): Buffer {
    // Use zlib for compression
    return zlib.deflateSync(text);
  }
  
  private decompress(buffer: Buffer): string {
    return zlib.inflateSync(buffer).toString('utf8');
  }
  
  private getReplacer(): (key: string, value: any) => any {
    return (key, value) => {
      // Handle special types like Date
      if (value instanceof Date) {
        return { __type: 'Date', value: value.toISOString() };
      }
      return value;
    };
  }
  
  private getReviver(): (key: string, value: any) => any {
    return (key, value) => {
      if (value && value.__type === 'Date') {
        return new Date(value.value);
      }
      return value;
    };
  }
}
```

## Core Operations

### Session Store Operations

```typescript
export class RedisSessionStore implements SessionStore {
  private redis: Redis | Cluster;
  private serializer: RedisSerializer;
  private config: RedisStoreConfig;
  
  constructor(
    redis: Redis | Cluster,
    serializer: RedisSerializer = new SpecterRedisSerializer(),
    config: RedisStoreConfig = DEFAULT_REDIS_STORE_CONFIG
  ) {
    this.redis = redis;
    this.serializer = serializer;
    this.config = config;
  }
  
  // Save a session (newest-first pattern)
  async saveSession(shopId: number, session: AnonymousSession): Promise<void> {
    const key = this.getSessionKey(shopId);
    const serialized = this.serializer.serialize(session);
    
    // Use pipeline for atomic operations
    const pipeline = this.redis.pipeline();
    
    // Add to front of list
    pipeline.lpush(key, serialized);
    
    // Trim list to max size
    pipeline.ltrim(key, 0, this.config.maxSessions - 1);
    
    // Update metadata
    pipeline.hincrby(this.getMetaKey(shopId), 'sessionCount', 1);
    pipeline.hset(this.getMetaKey(shopId), 'lastSession', Date.now().toString());
    
    // Set TTL if configured
    if (this.config.sessionTTL > 0) {
      pipeline.expire(key, this.config.sessionTTL);
    }
    
    await pipeline.exec();
  }
  
  // Get recent sessions
  async getRecentSessions(shopId: number, limit: number = 50): Promise<AnonymousSession[]> {
    const key = this.getSessionKey(shopId);
    const serialized = await this.redis.lrange(key, 0, limit - 1);
    
    return serialized.map(s => this.serializer.deserialize<AnonymousSession>(s));
  }
  
  // Get sessions within time range
  async getSessionsInRange(
    shopId: number, 
    startTime: number, 
    endTime: number
  ): Promise<AnonymousSession[]> {
    const key = this.getSessionKey(shopId);
    const allSessions = await this.redis.lrange(key, 0, -1);
    
    return allSessions
      .map(s => this.serializer.deserialize<AnonymousSession>(s))
      .filter(session => {
        const sessionTime = new Date(session.createdAt).getTime();
        return sessionTime >= startTime && sessionTime <= endTime;
      });
  }
  
  // Append an event to the event ledger
  async appendEvent(shopId: number, event: SpecterEvent): Promise<void> {
    const key = this.getEventKey(shopId);
    const serialized = this.serializer.serialize(event);
    
    const pipeline = this.redis.pipeline();
    
    // Add event to front of list
    pipeline.lpush(key, serialized);
    
    // Trim list to max size
    pipeline.ltrim(key, 0, this.config.maxEvents - 1);
    
    // Update event metadata
    pipeline.hset(
      this.getMetaKey(shopId), 
      'lastEvent', 
      JSON.stringify({ type: event.type, timestamp: event.timestamp })
    );
    
    // Increment event counter
    pipeline.hincrby(this.getMetaKey(shopId), 'eventCount', 1);
    
    // Set TTL if configured
    if (this.config.eventTTL > 0) {
      pipeline.expire(key, this.config.eventTTL);
    }
    
    await pipeline.exec();
  }
  
  // Get recent events
  async getRecentEvents(shopId: number, limit: number = 50): Promise<SpecterEvent[]> {
    const key = this.getEventKey(shopId);
    const serialized = await this.redis.lrange(key, 0, limit - 1);
    
    return serialized.map(s => this.serializer.deserialize<SpecterEvent>(s));
  }
  
  // Get shop configuration
  async getShopConfig(shopId: number): Promise<ShopConfig | null> {
    const key = this.getConfigKey(shopId);
    const serialized = await this.redis.get(key);
    
    if (!serialized) return null;
    
    return this.serializer.deserialize<ShopConfig>(serialized);
  }
  
  // Update shop configuration
  async updateShopConfig(shopId: number, config: ShopConfig): Promise<void> {
    const key = this.getConfigKey(shopId);
    const serialized = this.serializer.serialize(config);
    
    await this.redis.set(key, serialized);
    
    // Set TTL for cache invalidation
    if (this.config.configTTL > 0) {
      await this.redis.expire(key, this.config.configTTL);
    }
  }
  
  // Warm cache with configuration
  async warmCache(shopId: number, config: ShopConfig): Promise<void> {
    const key = this.getConfigKey(shopId);
    const serialized = this.serializer.serialize(config);
    
    await this.redis.set(key, serialized);
    
    // Set TTL for cache invalidation
    if (this.config.configTTL > 0) {
      await this.redis.expire(key, this.config.configTTL);
    }
  }
  
  // Reset all data for a shop (for testing)
  async reset(shopId: number): Promise<void> {
    const pattern = `specter:shop:${shopId}:*`;
    
    // Scan and delete all keys for this shop
    let cursor = '0';
    do {
      const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];
      
      if (keys.length > 0) {
        await this.redis.unlink(...keys);
      }
    } while (cursor !== '0');
    
    // Also remove from active shops set
    await this.redis.srem('specter:global:shops:active', shopId.toString());
  }
  
  // Helper methods for key generation
  private getSessionKey(shopId: number): string {
    return `specter:shop:${shopId}:sessions`;
  }
  
  private getEventKey(shopId: number): string {
    return `specter:shop:${shopId}:events`;
  }
  
  private getConfigKey(shopId: number): string {
    return `specter:shop:${shopId}:config`;
  }
  
  private getMetaKey(shopId: number): string {
    return `specter:shop:${shopId}:meta`;
  }
}
```

### Advanced Operations

#### Bulk Operations with Pipeline

```typescript
class RedisBatchProcessor {
  private redis: Redis | Cluster;
  
  constructor(redis: Redis | Cluster) {
    this.redis = redis;
  }
  
  async batchAppendEvents(
    shopId: number, 
    events: SpecterEvent[]
  ): Promise<BatchResult> {
    const eventKey = this.getEventKey(shopId);
    const metaKey = this.getMetaKey(shopId);
    
    const pipeline = this.redis.pipeline();
    
    // Add all events
    events.forEach(event => {
      const serialized = this.serializer.serialize(event);
      pipeline.lpush(eventKey, serialized);
    });
    
    // Trim list after batch insert
    pipeline.ltrim(eventKey, 0, this.config.maxEvents - 1);
    
    // Update metadata
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      pipeline.hset(
        metaKey, 
        'lastEvent', 
        JSON.stringify({ 
          type: lastEvent.type, 
          timestamp: lastEvent.timestamp 
        })
      );
      pipeline.hincrby(metaKey, 'eventCount', events.length);
    }
    
    const results = await pipeline.exec();
    
    return {
      success: true,
      processed: events.length,
      errors: results.filter(r => r[0]).map(r => r[0]?.message)
    };
  }
  
  async getShopStateWithMetadata(shopId: number): Promise<ShopStateWithMetadata> {
    const keys = [
      this.getSessionKey(shopId),
      this.getEventKey(shopId),
      this.getConfigKey(shopId),
      this.getMetaKey(shopId)
    ];
    
    // Use MGET for parallel fetching
    const pipeline = this.redis.pipeline();
    
    keys.forEach(key => {
      pipeline.get(key);
    });
    
    // Also get list lengths
    pipeline.llen(this.getSessionKey(shopId));
    pipeline.llen(this.getEventKey(shopId));
    
    const results = await pipeline.exec();
    
    return {
      sessions: this.parseListResult(results[0], AnonymousSession),
      events: this.parseListResult(results[1], SpecterEvent),
      config: this.parseSingleResult(results[2], ShopConfig),
      metadata: this.parseHashResult(results[3]),
      sessionCount: results[4][1],
      eventCount: results[5][1]
    };
  }
}
```

#### Distributed Locks

```typescript
class RedisDistributedLock {
  private redis: Redis | Cluster;
  private lockTimeout: number = 10000; // 10 seconds
  private retryDelay: number = 100; // 100ms
  private maxRetries: number = 10;
  
  constructor(redis: Redis | Cluster) {
    this.redis = redis;
  }
  
  async acquire(
    resource: string, 
    clientId: string = generateClientId()
  ): Promise<LockResult> {
    const lockKey = `specter:system:locks:${resource}`;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      // Try to acquire lock with SET NX PX
      const result = await this.redis.set(
        lockKey, 
        clientId, 
        'PX', 
        this.lockTimeout, 
        'NX'
      );
      
      if (result === 'OK') {
        return {
          acquired: true,
          lockId: clientId,
          resource
        };
      }
      
      // Wait before retrying
      await this.delay(this.retryDelay * Math.pow(2, attempt));
    }
    
    return {
      acquired: false,
      lockId: null,
      resource,
      error: 'Failed to acquire lock after maximum retries'
    };
  }
  
  async release(resource: string, clientId: string): Promise<boolean> {
    const lockKey = `specter:system:locks:${resource}`;
    
    // Use Lua script for atomic check-and-delete
    const luaScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    
    const result = await this.redis.eval(luaScript, 1, lockKey, clientId);
    return result === 1;
  }
  
  async withLock<T>(
    resource: string,
    operation: () => Promise<T>,
    clientId?: string
  ): Promise<T> {
    const lock = await this.acquire(resource, clientId);
    
    if (!lock.acquired) {
      throw new Error(`Failed to acquire lock for resource: ${resource}`);
    }
    
    try {
      return await operation();
    } finally {
      await this.release(resource, lock.lockId!);
    }
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## Performance Optimizations

### Memory Optimization Strategies

```typescript
interface MemoryOptimizationConfig {
  // Compression settings
  enableCompression: boolean;
  compressionThreshold: number; // bytes
  
  // Data pruning
  enableAutoPruning: boolean;
  pruningStrategy: 'lru' | 'ttl' | 'hybrid';
  maxMemoryUsage: number; // bytes
  
  // Serialization optimizations
  useBinaryProtocol: boolean;
  customSerializers: Record<string, CustomSerializer>;
}

class RedisMemoryOptimizer {
  private redis: Redis | Cluster;
  private config: MemoryOptimizationConfig;
  
  constructor(redis: Redis | Cluster, config: MemoryOptimizationConfig) {
    this.redis = redis;
    this.config = config;
  }
  
  async optimizeMemory(): Promise<OptimizationReport> {
    const report: OptimizationReport = {
      memoryBefore: 0,
      memoryAfter: 0,
      keysRemoved: 0,
      compressionRatio: 1,
      duration: 0
    };
    
    const startTime = Date.now();
    
    // Get current memory usage
    const memoryInfo = await this.redis.info('memory');
    report.memoryBefore = this.parseMemoryUsage(memoryInfo);
    
    if (this.config.enableAutoPruning) {
      await this.performPruning();
    }
    
    if (this.config.enableCompression) {
      await this.performCompression();
    }
    
    // Get memory usage after optimization
    const memoryInfoAfter = await this.redis.info('memory');
    report.memoryAfter = this.parseMemoryUsage(memoryInfoAfter);
    report.duration = Date.now() - startTime;
    
    return report;
  }
  
  private async performPruning(): Promise<void> {
    const shopKeys = await this.redis.keys('specter:shop:*:sessions');
    
    for (const key of shopKeys) {
      // Trim sessions to last 1000
      await this.redis.ltrim(key, 0, 999);
      
      // Trim events to last 100
      const eventKey = key.replace(':sessions', ':events');
      await this.redis.ltrim(eventKey, 0, 99);
      
      // Remove expired metadata
      const metaKey = key.replace(':sessions', ':meta');
      const ttl = await this.redis.ttl(metaKey);
      if (ttl < 0) {
        await this.redis.del(metaKey);
      }
    }
  }
  
  private async performCompression(): Promise<void> {
    // Compress large values
    const largeKeys = await this.findLargeKeys(this.config.compressionThreshold);
    
    for (const { key, size } of largeKeys) {
      const value = await this.redis.get(key);
      if (value && value.length > this.config.compressionThreshold) {
        const compressed = zlib.deflateSync(value);
        await this.redis.set(key, compressed);
      }
    }
  }
  
  private async findLargeKeys(threshold: number): Promise<Array<{ key: string; size: number }>> {
    const result: Array<{ key: string; size: number }> = [];
    
    let cursor = '0';
    do {
      const scanResult = await this.redis.scan(cursor, 'COUNT', 100);
      cursor = scanResult[0];
      const keys = scanResult[1];
      
      for (const key of keys) {
        const memory = await this.redis.memory('USAGE', key);
        if (memory > threshold) {
          result.push({ key, size: memory });
        }
      }
    } while (cursor !== '0');
    
    return result;
  }
}
```

### Connection Pool Optimization

```typescript
class RedisConnectionManager {
  private pools: Map<string, Redis | Cluster> = new Map();
  private configs: Map<string, RedisConfig> = new Map();
  
  async getPool(tenantId: string): Promise<Redis | Cluster> {
    if (!this.pools.has(tenantId)) {
      const config = await this.loadTenantConfig(tenantId);
      const pool = RedisClientFactory.createClient(config);
      
      // Test connection
      await pool.ping();
      
      this.pools.set(tenantId, pool);
      this.configs.set(tenantId, config);
    }
    
    return this.pools.get(tenantId)!;
  }
  
  async releasePool(tenantId: string): Promise<void> {
    const pool = this.pools.get(tenantId);
    if (pool) {
      await pool.quit();
      this.pools.delete(tenantId);
      this.configs.delete(tenantId);
    }
  }
  
  async optimizePool(tenantId: string): Promise<void> {
    const pool = await this.getPool(tenantId);
    const config = this.configs.get(tenantId)!;
    
    // Monitor pool metrics
    const metrics = await this.collectPoolMetrics(pool);
    
    // Adjust pool size based on load
    if (metrics.activeConnections > config.connectionPoolSize! * 0.8) {
      await this.resizePool(tenantId, Math.ceil(config.connectionPoolSize! * 1.5));
    } else if (metrics.activeConnections < config.connectionPoolSize! * 0.3) {
      await this.resizePool(tenantId, Math.floor(config.connectionPoolSize! * 0.7));
    }
  }
  
  private async collectPoolMetrics(pool: Redis | Cluster): Promise<PoolMetrics> {
    const info = await pool.info();
    return {
      activeConnections: this.parseConnections(info),
      totalCommandsProcessed: this.parseCommands(info),
      memoryUsage: this.parseMemory(info),
      uptime: this.parseUptime(info)
    };
  }
}
```

## Monitoring and Observability

### Redis Metrics Collection

```typescript
interface RedisMetrics {
  // Performance metrics
  commandLatency: Histogram;
  memoryUsage: Gauge;
  connectionCount: Gauge;
  keyCount: Gauge;
  
  // Business metrics
  sessionsStored: Counter;
  eventsProcessed: Counter;
  configUpdates: Counter;
  
  // Error metrics
  redisErrors: Counter;
  connectionErrors: Counter;
  timeoutErrors: Counter;
}

class RedisMetricsCollector {
  private redis: Redis | Cluster;
  private metrics: RedisMetrics;
  
  constructor(redis: Redis | Cluster, metricsClient: MetricsClient) {
    this.redis = redis;
    this.metrics = this.initializeMetrics(metricsClient);
  }
  
  async collectMetrics(): Promise<MetricsSnapshot> {
    const info = await this.redis.info();
    
    return {
      timestamp: Date.now(),
      memory: this.parseMemoryInfo(info),
      clients: this.parseClientInfo(info),
      stats: this.parseStatsInfo(info),
      persistence: this.parsePersistenceInfo(info),
      replication: this.parseReplicationInfo(info),
      cpu: this.parseCpuInfo(info),
      cluster: this.parseClusterInfo(info)
    };
  }
  
  async monitorCommandLatency(): Promise<void> {
    const slowlog = await this.redis.slowlog('get', 10);
    
    slowlog.forEach((entry: any) => {
      this.metrics.commandLatency.observe(entry.duration);
      
      if (entry.duration > 1000) { // 1 second threshold
        this.logSlowCommand(entry);
      }
    });
  }
  
  async detectAnomalies(): Promise<AnomalyReport> {
    const metrics = await this.collectMetrics();
    const anomalies: Anomaly[] = [];
    
    // Check memory usage
    if (metrics.memory.usedMemory > metrics.memory.maxMemory * 0.8) {
      anomalies.push({
        type: 'HIGH_MEMORY_USAGE',
        severity: 'WARNING',
        message: `Memory usage at ${(metrics.memory.usedMemory / metrics.memory.maxMemory * 100).toFixed(1)}%`
      });
    }
    
    // Check connection count
    if (metrics.clients.connectedClients > 1000) {
      anomalies.push({
        type: 'HIGH_CONNECTION_COUNT',
        severity: 'WARNING',
        message: `High connection count: ${metrics.clients.connectedClients}`
      });
    }
    
    // Check command latency
    if (metrics.stats.instantaneousOpsPerSec < 100) {
      anomalies.push({
        type: 'LOW_THROUGHPUT',
        severity: 'INFO',
        message: `Low operations per second: ${metrics.stats.instantaneousOpsPerSec}`
      });
    }
    
    return {
      timestamp: Date.now(),
      anomalies,
      metrics
    };
  }
}
```

### Health Checks

```typescript
class RedisHealthChecker {
  private redis: Redis | Cluster;
  
  constructor(redis: Redis | Cluster) {
    this.redis = redis;
  }
  
  async performHealthCheck(): Promise<HealthCheckResult> {
    const checks: HealthCheck[] = [
      { name: 'connectivity', check: () => this.checkConnectivity() },
      { name: 'memory', check: () => this.checkMemory() },
      { name: 'persistence', check: () => this.checkPersistence() },
      { name: 'replication', check: () => this.checkReplication() },
      { name: 'latency', check: () => this.checkLatency() }
    ];
    
    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          return await check.check();
        } catch (error) {
          return {
            name: check.name,
            status: 'FAILED',
            error: error.message,
            duration: 0
          };
        }
      })
    );
    
    const allHealthy = results.every(r => r.status === 'HEALTHY');
    
    return {
      status: allHealthy ? 'HEALTHY' : 'UNHEALTHY',
      checks: results,
      timestamp: new Date().toISOString()
    };
  }
  
  private async checkConnectivity(): Promise<HealthCheck> {
    const start = Date.now();
    await this.redis.ping();
    const duration = Date.now() - start;
    
    return {
      name: 'connectivity',
      status: 'HEALTHY',
      duration,
      details: { latency: duration }
    };
  }
  
  private async checkMemory(): Promise<HealthCheck> {
    const info = await this.redis.info('memory');
    const usedMemory = parseInt(info.split('\r\n').find(line => line.startsWith('used_memory:'))?.split(':')[1] || '0');
    const maxMemory = parseInt(info.split('\r\n').find(line => line.startsWith('maxmemory:'))?.split(':')[1] || '0');
    
    const memoryUsage = maxMemory > 0 ? usedMemory / maxMemory : 0;
    
    return {
      name: 'memory',
      status: memoryUsage < 0.8 ? 'HEALTHY' : 'WARNING',
      details: { usedMemory, maxMemory, memoryUsage }
    };
  }
  
  private async checkLatency(): Promise<HealthCheck> {
    const start = Date.now();
    const promises = Array(10).fill(null).map(() => this.redis.ping());
    await Promise.all(promises);
    const duration = Date.now() - start;
    const avgLatency = duration / 10;
    
    return {
      name: 'latency',
      status: avgLatency < 100 ? 'HEALTHY' : avgLatency < 500 ? 'WARNING' : 'FAILED',
      duration: avgLatency,
      details: { averageLatency: avgLatency }
    };
  }
}
```

## Failure Handling and Recovery

### Circuit Breaker Pattern

```typescript
class RedisCircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  
  private readonly failureThreshold = 5;
  private readonly resetTimeout = 30000; // 30 seconds
  private readonly successThreshold = 3;
  
  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldTryReset()) {
        this.state = 'HALF_OPEN';
      } else {
        if (fallback) {
          return await fallback();
        }
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      
      if (this.state === 'OPEN' && fallback) {
        return await fallback();
      }
      
      throw error;
    }
  }
  
  private recordSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      if (++this.successThreshold >= 3) {
        this.state = 'CLOSED';
      }
    }
  }
  
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
  
  private shouldTryReset(): boolean {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime > this.resetTimeout;
  }
  
  getState(): string {
    return this.state;
  }
  
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}
```

### Fallback Strategies

```typescript
class RedisFallbackManager {
  private primaryRedis: Redis | Cluster;
  private secondaryRedis: Redis | Cluster | null;
  private memoryStore: InMemorySessionStore;
  private circuitBreaker: RedisCircuitBreaker;
  
  constructor(
    primaryRedis: Redis | Cluster,
    secondaryRedis: Redis | Cluster | null = null
  ) {
    this.primaryRedis = primaryRedis;
    this.secondaryRedis = secondaryRedis;
    this.memoryStore = new InMemorySessionStore();
    this.circuitBreaker = new RedisCircuitBreaker();
  }
  
  async executeWithFallback<T>(
    operation: (redis: Redis | Cluster) => Promise<T>,
    context: OperationContext
  ): Promise<T> {
    return this.circuitBreaker.execute(
      () => operation(this.primaryRedis),
      async () => {
        // Try secondary Redis if available
        if (this.secondaryRedis) {
          try {
            return await operation(this.secondaryRedis);
          } catch (error) {
            console.warn('Secondary Redis also failed, falling back to memory store');
          }
        }
        
        // Fall back to memory store
        return await this.executeInMemory(operation, context);
      }
    );
  }
  
  private async executeInMemory<T>(
    operation: (redis: Redis | Cluster) => Promise<T>,
    context: OperationContext
  ): Promise<T> {
    // Map Redis operations to memory store operations
    switch (context.operationType) {
      case 'SAVE_SESSION':
        return this.memoryStore.saveSession(
          context.shopId!,
          context.session!
        ) as T;
        
      case 'GET_SESSIONS':
        return this.memoryStore.getRecentSessions(
          context.shopId!,
          context.limit
        ) as T;
        
      case 'APPEND_EVENT':
        return this.memoryStore.appendEvent(
          context.shopId!,
          context.event!
        ) as T;
        
      default:
        throw new Error(`Unsupported operation for memory fallback: ${context.operationType}`);
    }
  }
  
  async syncMemoryToRedis(): Promise<void> {
    if (this.circuitBreaker.getState() === 'OPEN') {
      console.warn('Cannot sync memory to Redis, circuit breaker is OPEN');
      return;
    }
    
    try {
      const pendingOperations = this.memoryStore.getPendingOperations();
      
      for (const op of pendingOperations) {
        await this.executeWithFallback(
          async (redis) => {
            // Execute the pending operation on Redis
            return await this.executeRedisOperation(redis, op);
          },
          { operationType: op.type, ...op.context }
        );
        
        // Mark operation as synced
        this.memoryStore.markOperationSynced(op.id);
      }
    } catch (error) {
      console.error('Failed to sync memory to Redis:', error);
    }
  }
}
```

## Testing Strategies

### Unit Testing Redis Operations

```typescript
describe('RedisSessionStore', () => {
  let redis: Redis;
  let store: RedisSessionStore;
  let mockRedis: jest.Mocked<Redis>;
  
  beforeEach(async () => {
    // Create mock Redis instance
    mockRedis = {
      lpush: jest.fn(),
      ltrim: jest.fn(),
      lrange: jest.fn(),
      hincrby: jest.fn(),
      hset: jest.fn(),
      expire: jest.fn(),
      pipeline: jest.fn(() => ({
        exec: jest.fn(() => Promise.resolve([]))
      }))
    } as any;
    
    store = new RedisSessionStore(mockRedis);
  });
  
  describe('saveSession', () => {
    it('should push session to list and trim it', async () => {
      const session: AnonymousSession = {
        shopId: 1,
        sessionId: 's-abc123',
        landingPage: '/test',
        pagesViewed: [],
        exitIntent: false,
        createdAt: new Date().toISOString()
      };
      
      await store.saveSession(1, session);
      
      expect(mockRedis.lpush).toHaveBeenCalledWith(
        'specter:shop:1:sessions',
        expect.any(String)
      );
      
      expect(mockRedis.ltrim).toHaveBeenCalledWith(
        'specter:shop:1:sessions',
        0,
        999
      );
    });
  });
  
  describe('getRecentSessions', () => {
    it('should return deserialized sessions', async () => {
      const mockSession: AnonymousSession = {
        shopId: 1,
        sessionId: 's-abc123',
        landingPage: '/test',
        pagesViewed: [],
        exitIntent: false,
        createdAt: new Date().toISOString()
      };
      
      mockRedis.lrange.mockResolvedValue([
        JSON.stringify(mockSession)
      ]);
      
      const sessions = await store.getRecentSessions(1, 10);
      
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toEqual(mockSession);
      expect(mockRedis.lrange).toHaveBeenCalledWith(
        'specter:shop:1:sessions',
        0,
        9
      );
    });
  });
});
```

### Integration Testing with Testcontainers

```typescript
describe('RedisSessionStore Integration', () => {
  let redisContainer: GenericContainer;
  let redisClient: Redis;
  let store: RedisSessionStore;
  
  beforeAll(async () => {
    // Start Redis container
    redisContainer = new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379);
    
    await redisContainer.start();
    
    const host = redisContainer.getHost();
    const port = redisContainer.getMappedPort(6379);
    
    // Create Redis client
    redisClient = new Redis({
      host,
      port,
      maxRetriesPerRequest: 1
    });
    
    store = new RedisSessionStore(redisClient);
  });
  
  afterAll(async () => {
    await redisClient.quit();
    await redisContainer.stop();
  });
  
  beforeEach(async () => {
    await redisClient.flushall();
  });
  
  it('should save and retrieve sessions', async () => {
    const session: AnonymousSession = {
      shopId: 1,
      sessionId: 's-test123',
      landingPage: '/products',
      pagesViewed: ['/products', '/cart'],
      exitIntent: true,
      createdAt: new Date().toISOString()
    };
    
    // Save session
    await store.saveSession(1, session);
    
    // Retrieve sessions
    const sessions = await store.getRecentSessions(1);
    
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(session.sessionId);
    expect(sessions[0].exitIntent).toBe(true);
  });
  
  it('should respect session limit', async () => {
    // Create more sessions than the limit
    const sessions = Array.from({ length: 15 }, (_, i) => ({
      shopId: 1,
      sessionId: `s-${i}`,
      landingPage: '/test',
      pagesViewed: [],
      exitIntent: false,
      createdAt: new Date().toISOString()
    }));
    
    // Save all sessions
    for (const session of sessions) {
      await store.saveSession(1, session);
    }
    
    // Retrieve with limit
    const recentSessions = await store.getRecentSessions(1, 10);
    
    expect(recentSessions).toHaveLength(10);
    expect(recentSessions[0].sessionId).toBe('s-14'); // Most recent first
  });
});
```

### Performance Testing

```typescript
describe('Redis Performance Tests', () => {
  let redis: Redis;
  let store: RedisSessionStore;
  
  beforeAll(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379')
    });
    
    store = new RedisSessionStore(redis);
  });
  
  afterAll(async () => {
    await redis.quit();
  });
  
  describe('concurrent operations', () => {
    it('should handle concurrent session saves', async () => {
      const shopCount = 10;
      const sessionsPerShop = 100;
      
      const operations = [];
      
      for (let shopId = 1; shopId <= shopCount; shopId++) {
        for (let i = 0; i < sessionsPerShop; i++) {
          const session: AnonymousSession = {
            shopId,
            sessionId: `s-${shopId}-${i}`,
            landingPage: '/test',
            pagesViewed: [],
            exitIntent: Math.random() > 0.5,
            createdAt: new Date().toISOString()
          };
          
          operations.push(store.saveSession(shopId, session));
        }
      }
      
      const startTime = Date.now();
      await Promise.all(operations);
      const duration = Date.now() - startTime;
      
      console.log(`Saved ${shopCount * sessionsPerShop} sessions in ${duration}ms`);
      console.log(`Rate: ${(shopCount * sessionsPerShop) / (duration / 1000)} ops/sec`);
      
      // Assert performance SLAs
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
    
    it('should maintain low latency under load', async () => {
      const latencies: number[] = [];
      const iterations = 1000;
      
      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await store.appendEvent(1, {
          type: 'test.event',
          timestamp: Date.now(),
          payload: { iteration: i }
        });
        latencies.push(Date.now() - startTime);
      }
      
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[
        Math.floor(latencies.length * 0.95)
      ];
      const p99Latency = latencies.sort((a, b) => a - b)[
        Math.floor(latencies.length * 0.99)
      ];
      
      console.log(`Average latency: ${avgLatency}ms`);
      console.log(`P95 latency: ${p95Latency}ms`);
      console.log(`P99 latency: ${p99Latency}ms`);
      
      // Assert latency SLAs
      expect(p95Latency).toBeLessThan(100); // 95% of operations under 100ms
      expect(p99Latency).toBeLessThan(500); // 99% of operations under 500ms
    });
  });
});
```

## Production Deployment Checklist

### Pre-Deployment Verification

```typescript
interface DeploymentChecklist {
  infrastructure: {
    redisVersion: string; // >= 7.0
    memoryAllocation: number; // Adequate for expected load
    persistenceEnabled: boolean;
    backupConfigured: boolean;
    monitoringEnabled: boolean;
  };
  configuration: {
    connectionPooling: boolean;
    circuitBreaker: boolean;
    fallbackStrategy: boolean;
    ttlSettings: boolean;
    shardingConfigured: boolean;
  };
  performance: {
    latencyBaseline: number;
    throughputBaseline: number;
    memoryBaseline: number;
    connectionBaseline: number;
  };
  disasterRecovery: {
    backupTested: boolean;
    failoverTested: boolean;
    recoveryProcedureDocumented: boolean;
    teamTrained: boolean;
  };
}

async function verifyDeploymentReadiness(): Promise<VerificationResult> {
  const checklist: DeploymentChecklist = {
    infrastructure: {
      redisVersion: await getRedisVersion(),
      memoryAllocation: await getMemoryAllocation(),
      persistenceEnabled: await isPersistenceEnabled(),
      backupConfigured: await isBackupConfigured(),
      monitoringEnabled: await isMonitoringEnabled()
    },
    // ... additional checks
  };
  
  const allPassed = Object.values(checklist)
    .flatMap(category => Object.values(category))
    .every(value => value === true || (typeof value === 'number' && value > 0));
  
  return {
    ready: allPassed,
    checklist,
    timestamp: new Date().toISOString()
  };
}
```

### Capacity Planning

```typescript
class RedisCapacityPlanner {
  async estimateRequirements(
    expectedShops: number,
    sessionsPerDay: number,
    eventsPerDay: number,
    retentionDays: number
  ): Promise<CapacityEstimate> {
    // Calculate memory requirements
    const avgSessionSize = 500; // bytes
    const avgEventSize = 200; // bytes
    
    const dailySessionMemory = sessionsPerDay * avgSessionSize;
    const dailyEventMemory = eventsPerDay * avgEventSize;
    
    const totalMemory = (dailySessionMemory + dailyEventMemory) * retentionDays;
    
    // Calculate connection requirements
    const concurrentUsers = Math.ceil(sessionsPerDay / 86400 * 100); // Peak factor
    const connectionsPerShop = 5; // Conservative estimate
    const totalConnections = expectedShops * connectionsPerShop;
    
    // Calculate CPU requirements
    const opsPerSecond = (sessionsPerDay + eventsPerDay) / 86400;
    const cpuCores = Math.ceil(opsPerSecond / 10000); // 10k ops/sec per core
    
    return {
      memoryGB: Math.ceil(totalMemory / (1024 * 1024 * 1024)),
      connections: totalConnections,
      cpuCores,
      redisNodes: Math.ceil(expectedShops / 10000), // 10k shops per node
      shards: Math.ceil(expectedShops / 5000), // 5k shops per shard
      recommendations: this.generateRecommendations({
        memoryGB: Math.ceil(totalMemory / (1024 * 1024 * 1024)),
        connections: totalConnections,
        cpuCores
      })
    };
  }
}
```

## Troubleshooting Guide

### Common Issues and Solutions

#### 1. High Memory Usage

**Symptoms**: Redis memory usage > 80%, OOM errors
**Solutions**:

```bash
# Identify large keys
redis-cli --bigkeys

# Monitor memory fragmentation
redis-cli info memory | grep -E "(mem_fragmentation_ratio|used_memory_peak)"

# Enable memory optimization
redis-cli config set activedefrag yes
redis-cli config set maxmemory-policy allkeys-lru
```

#### 2. Slow Command Execution

**Symptoms**: High latency, slowlog entries
**Solutions**:

```bash
# Check slowlog
redis-cli slowlog get 10

# Monitor command statistics
redis-cli info commandstats

# Optimize problematic commands
# Example: Replace KEYS with SCAN
```

#### 3. Connection Issues

**Symptoms**: Connection timeouts, "max number of clients reached"
**Solutions**:

```bash
# Check connection statistics
redis-cli info clients

# Increase max connections
redis-cli config set maxclients 10000

# Check connection pooling configuration
```

#### 4. Replication Lag

**Symptoms**: Read-after-write inconsistency, slave delay
**Solutions**:

```bash
# Check replication status
redis-cli info replication

# Monitor replication lag
redis-cli role

# Optimize network between master and replicas
```

## Conclusion

This Redis implementation guide provides a comprehensive overview of Specter's Redis architecture and operations. Key takeaways:

1. **Design for Scale**: Use sharding, connection pooling, and efficient data structures
2. **Plan for Failure**: Implement circuit breakers, fallback strategies, and monitoring
3. **Optimize Performance**: Use pipelines, compression, and memory optimization
4. **Monitor Everything**: Collect metrics, set up alerts, and maintain health checks
5. **Test Thoroughly**: Unit tests, integration tests, and performance tests

By following these patterns and practices, Specter's Redis implementation can handle production-scale workloads while maintaining reliability, performance, and developer productivity.

---

*For Redis-specific operational questions, consult the Redis operations team. For Specter implementation issues, contact the Specter development team.*
