## **Specter Redis Session Store — Getting Started**

This document explains how to run the Specter session store in **production mode (Redis)** and **test mode (in-memory / no-op)**.

---

## 🚀 1. **Prerequisites**

You need the following running locally:

* **Redis 7.x**
* **Postgres 16**
* **RabbitMQ 3.13**
* Node 18+
* Environment variables set for the backend service

Redis is required only in production runtime, not in tests.

---

## ⚙️ 2. **Environment Variables**

### **Enable Redis-backed Specter Session Store**

```
SPECTER_SESSION_STORE=redis
REDIS_URL=redis://127.0.0.1:6379
```

### **Disable queue during tests (already set in jest.setup.js)**

```
DISABLE_QUEUE=1
```

If missing, Specter falls back to the in-memory store.

---

## 🧩 3. **How Bootstrapping Works**

The backend automatically selects a store implementation based on `SPECTER_SESSION_STORE`.

### **Production mode (Redis):**

* `apps/backend/src/bootstrap/specter-store.ts` loads:

  ```
  import { initRedisSessionStore } from 'modules-specter/store/session-store-redis'
  ```

* Initializes the Redis client
* Registers graceful shutdown hooks
* Makes Redis store available to the Specter ingestion flow

### **Test mode:**

* Jest sets:

  ```
  process.env.DISABLE_QUEUE = '1'
  ```

* Store factory detects `NODE_ENV=test` or missing Redis → uses the in-memory implementation.
* Ensures **zero external connections during tests**.

---

## 🧪 4. **Running Redis Locally**

Start Redis:

```
docker run -d \
  --name local-redis \
  -p 6379:6379 \
  redis:7-alpine
```

Verify connectivity:

```
redis-cli -p 6379 ping
# -> PONG
```

---

## 🧵 5. **Running the Backend with Redis Enabled**

Steps:

```
export REDIS_URL=redis://127.0.0.1:6379
export SPECTER_SESSION_STORE=redis
npm run build --workspace=api
node ./apps/backend/scripts/node-start.js
```

Health check:

```
curl http://127.0.0.1:3000/health
```

---

## 🔍 6. **Verifying Redis Keys**

Specter session keys follow:

```
specter:shop:{shopId}:sessions
```

Check:

```
redis-cli -p 6379 keys "specter:shop:*:sessions"
```

---

## ⚠️ 7. **Common Issues**

### **Port already in use (Redis or API server)**

Use:

```
lsof -iTCP:6379 -sTCP:LISTEN -n -P
lsof -iTCP:3000 -sTCP:LISTEN -n -P
```

### **Database connection refused**

Make sure Postgres is running:

```
docker start synchroflow_db
```

---
