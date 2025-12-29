# Specter Module: Introduction

## Executive Summary

Specter is the **stateful subsystem** that tracks shop sessions, an event ledger, and shop configuration to make ingestion/sync flows observable and eventually intelligent. 

Simultaneously, Specter serves as the **customer intelligence and conversion module** in the LaSyncro Central Nervous System (CNS), providing privacy-preserving, low-latency customer signals and nudge recommendations.

### Dual Role in LaSyncro

| **Aspect** | **Stateful Subsystem Role** | **Customer Intelligence Role** |
|------------|---------------------------|-----------------------------|
| **Primary Focus** | Observability of sync/ingestion flows | Privacy-safe customer behavior intelligence |
| **FT0 Implementation** | Redis-backed session/event store | Exit-intent detection with safe reminders |
| **Core Function** | Track and expose shop state | Generate margin-safe nudge recommendations |
| **Data Handling** | Anonymous session events | PCD-compliant customer signals |
| **Output** | Real-time operational metrics | Actionable behavioral insights |

## Mission Statement

> Provide **privacy-preserving**, **low-latency**, and **margin-safe** customer signals and nudge recommendations that make conversion opportunities actionable — while **never** persisting raw Personally Identifiable Customer Data (PCD) or executing channel actions.

## Evolution Phases

### Phase 1 (FT0 → FT1 - Current)
**Stateful Observability Foundation**
- **FT0**: Production-ready Redis-backed store, ingestion worker, metrics surface
- **FT1**: State machine, insights engine, config enforcement, command/control

### Phase 2 (v2 - Future)
**CNS-Aware Intelligence**
- Integrated signals from OrderNexus, SKU OS, and other modules
- Enhanced customer tiering and behavioral predictions
- Privacy-preserving personalization

### Phase 3 (v3 - Future)
**Orchestrated Behavioral Intelligence**
- Customer path simulation and forecasting
- Behavioral churn risk detection
- Orchestrated experiments via channel modules

## Core Principles

### 1. Privacy by Design
- Never persist raw customer identifiers (email, phone, etc.)
- URL normalization to strip PII from query parameters
- All intelligence derived from aggregated or anonymous data

### 2. Safety First
- **v1**: No discounts - only REMINDER nudges (no margin erosion)
- Hard latency budget (100 ms) with safe fallbacks
- Non-blocking writes to avoid impacting core flows

### 3. Observability Focus
- Real-time session and event tracking
- Configurable data retention policies
- Comprehensive metrics and logging

### 4. Modular Intelligence
- Single source of behavioral truth for CNS
- Clear contracts with other modules
- Gradual intelligence enhancement through phases

## Key Value Propositions

### For Engineering (Stateful Subsystem)
- **Visibility**: Track shop sessions and sync events in real-time
- **Reliability**: Redis-backed with in-memory fallback
- **Testability**: Deterministic tests with queue isolation
- **Scalability**: Bounded Redis lists and configurable limits

### For Business (Customer Intelligence)
- **Insights**: Understand customer behavior without PII exposure
- **Safety**: Margin-safe nudges with predictable outcomes
- **Actionability**: Clear recommendations for conversion optimization
- **Evolution**: Phased approach from basic to sophisticated intelligence

## Module Boundaries

### Specter OWNS
- Anonymous session tracking and intent signals (PCD-safe)
- PCD-compliant customer signals (`SpecterCustomerSignal`)
- Nudge **recommendations** (what to show, not how to send)
- Basic conversion-safe heuristics (exit-intent reminder in v1)
- Latency-bounded decision logic (100 ms internal budget)
- Behavioral primitives (session counts, exit intent rates, etc.)

### Specter DOES NOT OWN
- Order-level profitability → **OrderNexus**
- SKU-level risk, replenishment, inventory → **SKU OS**
- True cost models, P&L, cash flow → **Financial Intelligence**
- Fulfillment execution, routing, warehouse ops → **WMS Lite**
- Workflow/task execution → **Echo Hub**
- Global dashboards & cross-module charts → **Analytics Core**
- Channel execution (email/SMS/push, etc.) → dedicated channel modules

## Success Criteria

### FT0 (Launch-Ready)
- [x] Redis-backed session/event/config store
- [x] `GET /api/v1/specter/:shopId/state` endpoint
- [x] Canonical ingestion and sync worker hooks
- [x] Specter ingestion worker with best-effort writes
- [x] Full unit & integration test coverage
- [x] Minimal verification UI

### FT1 (Enhanced Intelligence)
- [ ] State machine per shop (idle → ingesting → syncing → healthy → warning → error)
- [ ] Insight/alerting engine
- [ ] Config enforcement
- [ ] Command/control capabilities
- [ ] Enhanced UI with health timelines

## Quick Start

For immediate implementation guidance, see:
- [Getting Started Guide](../01-overview/04-getting-started.md) - Setup and basic usage
- [Current State](../04-implementation/01-current-state.md) - What's already implemented
- [Data Models](../02-core-concepts/03-data-models.md) - Core data structures

## Document Structure

This documentation is organized to serve different audiences:

- **Overview & Vision** (01-overview/) - For stakeholders and new team members
- **Core Concepts** (02-core-concepts/) - For architects and developers understanding the system
- **API Documentation** (03-apis/) - For integrators and frontend developers
- **Implementation Details** (04-implementation/) - For engineers building and maintaining Specter
- **Operations** (05-operations/) - For DevOps and production support
- **Reference** (06-reference/) - For quick lookups and troubleshooting

---

*Note: This introduction merges perspectives from both the technical blueprint and module contract to provide a unified view of Specter's purpose and evolution.*