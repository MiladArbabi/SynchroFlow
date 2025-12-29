# Specter: Deployment and Operations Guide

## Overview

This guide provides comprehensive instructions for deploying and operating Specter in various environments, from local development to production.

## Environment Requirements

### Infrastructure Prerequisites
```bash
# Core dependencies
Redis 7.x+
PostgreSQL 16+
RabbitMQ 3.13+
Node.js 18+

# Optional but recommended
Docker & Docker Compose
Prometheus + Grafana (for monitoring)
```

### Local Development Setup

#### Option 1: Docker Compose (Recommended)
```yaml
# docker-compose.yml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: synchroflow
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: changeme
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  rabbitmq:
    image: rabbitmq:3.13-management
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: changeme

volumes:
  redis_data:
  postgres_data:
```

Start infrastructure:
```bash
docker-compose up -d
```

#### Option 2: Manual Setup
```bash
# Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# PostgreSQL
docker run -d --name postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=changeme \
  -e POSTGRES_USER=admin \
  -e POSTGRES_DB=synchroflow \
  postgres:16

# RabbitMQ
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 \
  rabbitmq:3.13-management
```

## Configuration

### Environment Variables

#### Required Variables
```bash
# Database
DATABASE_URL=postgresql://admin:changeme@localhost:5432/synchroflow

# Redis (Specter)
SPECTER_SESSION_STORE=redis  # or 'memory' for development
REDIS_URL=redis://localhost:6379

# RabbitMQ
RABBITMQ_URL=amqp://admin:changeme@localhost:5672

# Application
NODE_ENV=development
PORT=3000
```

#### Optional Specter-Specific Variables
```bash
# Data limits
SPECTER_EVENT_LIST_MAX=50           # Max events per shop (default: 50)
SPECTER_SESSION_STORE_LIST_MAX=1000 # Max sessions per shop (default: 1000)

# Testing
DISABLE_QUEUE=1                     # Disable real queue in tests

# Advanced
SPECTER_REDIS_KEY_PREFIX=specter:   # Redis key prefix
SPECTER_WORKER_BATCH_SIZE=10        # Worker batch processing size
SPECTER_WORKER_CONCURRENCY=5        # Worker concurrency
```

### Database Setup

1. **Create schema**:
```bash
cd apps/backend
npm run db:migrate
```

2. **Verify tables**:
```sql
-- Check Specter-specific tables
SELECT * FROM specter_shop_configs LIMIT 1;
```

### Redis Configuration Verification

Verify Redis connectivity and configuration:
```bash
# Test Redis connection
redis-cli -p 6379 ping
# Should return: PONG

# Check Redis info
redis-cli -p 6379 INFO memory
```

## Deployment Workflows

### Local Development

1. **Set up environment**:
```bash
export SPECTER_SESSION_STORE=redis
export REDIS_URL=redis://localhost:6379
export DATABASE_URL=postgresql://admin:changeme@localhost:5432/synchroflow
```

2. **Start the backend**:
```bash
cd apps/backend
npm run dev
```

3. **Verify startup logs**:
```
✓ Specter Redis store initialized
✓ Specter ingestion worker started
✓ API server listening on port 3000
```

### Staging Deployment

#### Docker Deployment
```Dockerfile
# Dockerfile for Specter-enabled backend
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/backend/package.json ./apps/backend/

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build
RUN npm run build --workspace=api

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node apps/backend/scripts/healthcheck.js

EXPOSE 3000
CMD ["node", "./apps/backend/scripts/node-start.js"]
```

#### Kubernetes Deployment
```yaml
# specter-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: specter-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: specter-backend
  template:
    metadata:
      labels:
        app: specter-backend
    spec:
      containers:
      - name: backend
        image: synchroflow/backend:latest
        ports:
        - containerPort: 3000
        env:
        - name: SPECTER_SESSION_STORE
          value: "redis"
        - name: REDIS_URL
          valueFrom:
            configMapKeyRef:
              name: specter-config
              key: redis-url
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
            path: /health/readiness
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

### Production Deployment Checklist

#### Pre-Deployment
- [ ] Database migrations tested and ready
- [ ] Redis cluster configured and tested
- [ ] Environment variables validated
- [ ] Backup procedures verified
- [ ] Monitoring alerts configured
- [ ] Rollback plan documented

#### Deployment
- [ ] Deploy to canary environment (10% traffic)
- [ ] Monitor error rates and latency
- [ ] Run smoke tests
- [ ] Gradually increase traffic to 100%
- [ ] Verify Specter metrics are flowing

#### Post-Deployment
- [ ] Validate Redis keys are being created
- [ ] Verify worker is processing messages
- [ ] Check API endpoints respond correctly
- [ ] Monitor system resources

## Health Checks and Monitoring

### Built-in Health Endpoints
```
GET /health              # Basic liveness
GET /health/readiness    # Dependencies (Redis, DB, RabbitMQ)
GET /health/specter      # Specter-specific health
GET /metrics            # Prometheus metrics
```

### Monitoring Dashboard (Grafana)

**Key Metrics to Monitor**:
1. **Redis Health**
   - Memory usage
   - Connection count
   - Command latency
   - Key count by pattern

2. **Worker Performance**
   - Messages processed per second
   - Queue length
   - Processing latency
   - Error rate

3. **API Performance**
   - Request rate
   - Response times (P50, P95, P99)
   - Error rates by endpoint

4. **Business Metrics**
   - Sessions tracked
   - Events processed
   - Nudge recommendations generated

### Alerting Rules

```yaml
# Example Prometheus alerts
groups:
- name: specter
  rules:
  - alert: HighRedisLatency
    expr: histogram_quantile(0.95, rate(redis_command_duration_seconds_bucket[5m])) > 0.1
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Redis latency above threshold"
      
  - alert: WorkerQueueBacklog
    expr: rabbitmq_queue_messages{queue="specter_events"} > 1000
    for: 10m
    labels:
      severity: critical
    annotations:
      summary: "Specter worker queue backlog"
      
  - alert: APILatencyHigh
    expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{handler="/api/v1/specter"}[5m])) > 0.5
    for: 5m
    labels:
      severity: warning
```

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: Redis Connection Failures
**Symptoms**: `Redis connection refused` errors, Specter falls back to memory store
**Solution**:
```bash
# Check Redis is running
docker ps | grep redis

# Test connection
redis-cli -p 6379 ping

# Check logs
docker logs redis

# Common fixes
# 1. Restart Redis
docker restart redis

# 2. Check memory limits
redis-cli info memory
```

#### Issue 2: Worker Not Processing Messages
**Symptoms**: Queue builds up, no events in Redis
**Solution**:
1. Check worker logs:
```bash
# Look for worker startup
grep "Specter ingestion worker" backend.logs

# Check for errors
grep -i error backend.logs | grep specter
```

2. Verify RabbitMQ connection:
```bash
# Check queue status
rabbitmqctl list_queues name messages_ready messages_unacknowledged

# Purge and restart if needed
rabbitmqctl purge_queue specter_events
```

#### Issue 3: API Endpoints Returning Empty Data
**Symptoms**: `GET /api/v1/specter/:shopId/state` returns null or empty arrays
**Solution**:
1. Verify Redis keys exist:
```bash
redis-cli keys "specter:shop:*"
```

2. Check if events are being recorded:
```bash
# Monitor Redis for new keys
redis-cli monitor | grep "LPUSH.*specter"
```

3. Verify shop ID exists in the system.

#### Issue 4: High Memory Usage
**Symptoms**: Redis memory growing rapidly
**Solution**:
1. Check list lengths:
```bash
# Check event list lengths
redis-cli --scan --pattern "specter:shop:*:events" | while read key; do
  echo "$key: $(redis-cli llen "$key")"
done
```

2. Adjust limits:
```bash
# Reduce list limits
export SPECTER_EVENT_LIST_MAX=25
export SPECTER_SESSION_STORE_LIST_MAX=500
```

3. Implement TTLs if needed.

### Debugging Commands

#### Redis Inspection
```bash
# List all Specter keys
redis-cli --scan --pattern "specter:*"

# Check specific shop
SHOP_ID=42
redis-cli lrange "specter:shop:${SHOP_ID}:events" 0 -1 | jq '.'
redis-cli lrange "specter:shop:${SHOP_ID}:sessions" 0 -1 | jq '.'

# Get key information
redis-cli memory usage "specter:shop:${SHOP_ID}:events"
```

#### Queue Inspection
```bash
# RabbitMQ queue status
rabbitmqctl list_queues | grep specter

# Check messages (requires rabbitmqadmin)
rabbitmqadmin get queue=specter_events count=5
```

#### Application Logs
```bash
# Enable debug logging for Specter
export DEBUG=specter*

# Tail logs
tail -f backend.logs | grep -E "(specter|Specter)"

# Check specific components
grep "specter-ingestion.worker" backend.logs
grep "specter.controller" backend.logs
```

## Performance Tuning

### Redis Optimization

#### Memory Optimization
```bash
# Enable memory optimization in redis.conf
maxmemory 1gb
maxmemory-policy allkeys-lru
activerehashing yes

# Use smaller data types
# Consider using Redis Streams instead of Lists for FT1+
```

#### Connection Pooling
```javascript
// Configure Redis client pooling
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  autoResendUnfulfilledCommands: true,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});
```

### Worker Tuning

#### Batch Processing
```typescript
// Configure worker batch size
const workerConfig = {
  batchSize: parseInt(process.env.SPECTER_WORKER_BATCH_SIZE || '10'),
  concurrency: parseInt(process.env.SPECTER_WORKER_CONCURRENCY || '5'),
  prefetch: 10
};
```

#### Rate Limiting
```typescript
// Implement rate limiting per shop
const rateLimiter = new RateLimiter({
  points: 100, // 100 events per shop per minute
  duration: 60
});
```

## Backup and Recovery

### Redis Backup Strategy

#### Automated Backups
```bash
#!/bin/bash
# backup-specter-redis.sh
BACKUP_DIR="/backups/specter/redis"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
redis-cli --rdb /tmp/dump.rdb

# Compress and move
gzip /tmp/dump.rdb
mv /tmp/dump.rdb.gz "${BACKUP_DIR}/specter_redis_${DATE}.rdb.gz"

# Keep last 7 days
find "${BACKUP_DIR}" -name "*.rdb.gz" -mtime +7 -delete
```

#### Point-in-Time Recovery
```bash
# Restore from backup
gunzip -c specter_redis_20240115_120000.rdb.gz > /tmp/dump.rdb
redis-cli --pipe < /tmp/dump.rdb
```

### Data Retention Policies

Configure based on business requirements:
```typescript
const retentionPolicies = {
  events: {
    hot: '7days',    // In Redis
    warm: '30days',  // Archived to PostgreSQL
    cold: '365days'  // Archived to S3
  },
  sessions: {
    hot: '3days',
    warm: '30days',
    cold: '90days'
  }
};
```

## Security Considerations

### Network Security
1. **Redis Security**:
   ```bash
   # Enable Redis password
   requirepass strongpassword
   
   # Bind to local interface only
   bind 127.0.0.1
   
   # Enable TLS
   tls-port 6379
   tls-cert-file /path/to/redis.crt
   tls-key-file /path/to/redis.key
   ```

2. **API Security**:
   - Use HTTPS in production
   - Implement rate limiting
   - Validate Bearer tokens
   - Audit log all admin actions

### Data Security
1. **PII Handling**: Never log raw customer data
2. **Encryption**: Encrypt sensitive config values
3. **Access Control**: Limit Redis and DB access to Specter service only

## Scaling Considerations

### Vertical Scaling
- Increase Redis memory as event volume grows
- Add CPU resources for worker processing
- Scale PostgreSQL with read replicas

### Horizontal Scaling
1. **Redis Cluster**: Shard by shop ID
2. **Worker Scaling**: Multiple worker instances with competing consumers
3. **API Scaling**: Stateless API servers behind load balancer

### Performance Targets
- **Event ingestion**: 1,000 events/second per worker
- **API response**: < 100ms P95 for state queries
- **Redis latency**: < 10ms P95 for reads

## Disaster Recovery

### Recovery Procedures

#### Complete Outage Recovery
1. **Restore Redis** from latest backup
2. **Restore PostgreSQL** configs
3. **Clear RabbitMQ queues** to prevent replay of old messages
4. **Gradually restart** services, monitoring health

#### Partial Data Loss
1. **Identify missing data range**
2. **Trigger re-sync** from source systems if possible
3. **Replay events** from archived logs if available

### Business Continuity
1. **Fallback Mode**: Specter automatically falls back to in-memory store
2. **Degraded Functionality**: Nudge recommendations use safe defaults
3. **Manual Overrides**: Admin interface for critical operations

## Maintenance Tasks

### Regular Maintenance
- **Daily**: Check disk space, monitor alert trends
- **Weekly**: Review logs for anomalies, backup verification
- **Monthly**: Performance review, capacity planning

### Housekeeping Jobs
```sql
-- Clean up old configs
DELETE FROM specter_shop_configs 
WHERE updated_at < NOW() - INTERVAL '90 days';

-- Archive old events
-- (Implement based on retention policy)
```

---

## Quick Reference

### Start Commands
```bash
# Local development
npm run dev

# Production start
node ./apps/backend/scripts/node-start.js

# With specific environment
NODE_ENV=production SPECTER_SESSION_STORE=redis npm start
```

### Verification Commands
```bash
# Health check
curl http://localhost:3000/health/specter

# Test API
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/specter/42/state

# Check Redis
redis-cli keys "specter:*" | wc -l
```

### Log Locations
- **Application logs**: `logs/backend.log`
- **Access logs**: `logs/access.log`
- **Error logs**: `logs/error.log`

---

*For additional help, refer to the troubleshooting section or contact the infrastructure team. Always test deployment procedures in staging before applying to production.*
```