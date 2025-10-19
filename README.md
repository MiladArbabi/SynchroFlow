# SynchroFlow: The Autonomous Commerce Operations Platform (v5.4)

SynchroFlow is a B2B SaaS platform engineered to be the central nervous system for mid-market ($1M - $50M+ ARR) e-commerce brands. We solve the two most expensive operational challenges: data fragmentation and communication silos.

Our platform is built on a high-performance C++ core that serves as a single source of truth, evolving from a unified platform into a complete commerce ecosystem.

## 1. Core Product Modules & Offerings (v5.4)

### Core Platform
* **FinOps Command Center:** Unified dashboard for finance and operations.
* **Echo Communications Hub:** Unified inbox for customer support.
* **Ops-Intel Engine:** A cross-platform module to track and quantify labor cost savings.

### Core Operations Module
* **"SynchroFlow Warehouse Ops" (WMS-Lite):** A new module for brands running their own small warehouses, providing MDE/mobile-based pick/pack/ship and bin-level inventory control.

### Advanced Platform Modules (Expansion)
* **"SynchroFlow Clarity":** AI-driven industry benchmarking.
* **Supplier & Procurement Portal:** Manages the complete PO lifecycle.
* **B2B Wholesale Portal:** A revenue-generating, real-time B2B ordering portal.

### Ecosystem Services (Dominance)
* **"SynchroFlow Concierge":** A premium BPO service, allowing customers to outsource their ops and CX to our certified experts.

## 2. Technical Architecture (v5.4)

SynchroFlow uses a decoupled, five-service microservices architecture. The new "Warehouse Ops" module is a mobile application that communicates directly with our core API.

```mermaid
graph TD
    subgraph "External Platforms"
        ThirdParty[Shopify, NetSuite, Zendesk, etc.]
    end

    subgraph "User Interface Layer"
        UI[React UI (Web)]
        WMS_App[WMS Mobile App (MDE/Phone)]
        B2B[B2B Wholesale Portal]
        SUP[Supplier Portal]
    end

    subgraph "SynchroFlow Platform"
        subgraph "Integration Layer"
            IS[Integration Service<br>(Node.js)]
            MQ[(RabbitMQ<br>Message Queue)]
        end

        subgraph "Web Layer & Core API"
            API[Express.js API Server<br>(Handles FinOps, Echo, B2B, POs, WMS)]
        end

        subgraph "High-Performance Core"
            CPP[C++ Engine<br>(Atomic Inventory Truth)]
        end

        subgraph "AI Engine"
            AI[Python Microservice<br>(Forecasting, NLP, Benchmarking)]
        end

        subgraph "Data Layer"
            DB[(PostgreSQL)]
            CACHE[(Redis)]
            DW[Data Warehouse]
            S3[S3 Data Lake]
        end
    end

    %% Connections
    ThirdParty -- Webhooks --> IS
    IS -- Raw Data --> S3
    IS -- Publishes Job --> MQ
    
    API -- Consumes Job --> MQ
    UI & B2B & SUP & WMS_App -- HTTPS --> API
    
    API -- N-API Call --> CPP
    API -- REST --> AI
    API -- CRUD --> DB
    API -- Cache --> CACHE
    API -- Analytics --> DW
    CPP -- libpqxx --> DB
```

### Key Architectural Principles
- Multi-Region Deployment: Infrastructure will be deployed in distinct EU, US, APAC, and LATAM regions.
- Data Lakehouse Approach: Raw data is staged in Object Storage (S3), live data is in PostgreSQL, and historical data is in a Data Warehouse.

### Technology Stack
- Frontend: React (Vite), TypeScript, Material-UI, Emotion, TanStack Table, Chart.js.
- API/Backend: Node.js, Express.js, TypeScript, Knex.js, amqplib.
- Data Layer: PostgreSQL (Docker), RabbitMQ (Docker), Redis.
- High-Performance Core: C++, N-API, libpqxx.
- AI Engine: Python, FastAPI, PyTorch, LangChain.
- DevOps: Docker, NPM Workspaces, Jest, Supertest, React Testing Library.

## 3. Local Development Setup

### Prerequisites
Node.js (v20+), Docker, Homebrew, C++ Compiler, Python 3 & venv.

### First-Time Installation
```bash
# Clone the repository
git clone [YOUR_REPO_URL]
cd SynchroFlow

# Install C++ dependencies (macOS with Homebrew)
brew install libpq libpqxx

# Set up Python virtual environment
cd packages/ai-engine && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && deactivate && cd ../..

# Install all Node.js dependencies from the root
npm install
```

### Running the Application
```bash
# This command starts Docker, resets the DB, runs migrations, and starts all services.
# It is the single command needed for daily development.
npm run dev:full
```

The services will be available at:
- React UI: http://localhost:5173/
- Node.js API: http://localhost:3000
- Python AI Engine: http://localhost:8000

## 4. GTM & Pricing Strategy (v5.4)

Our GTM is a Product-Led Growth (PLG) motion that funnels into a high-value, sales-led conversion, based on a Margin-Protected Penetration strategy.

- Acquisition: The "Ignition" plan is our primary acquisition tool.
- Cash Flow: We will aggressively drive Annual Upfront Contracts by offering a "2 Months Free" discount.
- Expansion: Our sales and customer success teams will be heavily incentivized to "land and expand" by upselling our new suite of high-margin modules.

### The Pricing Ladder (Annual-First)

| Plan       | Target ICP (ARR) | Monthly Price | Annual Price (Upfront) | Core Value Proposition                  |
|------------|------------------|---------------|-------------------------|-----------------------------------------|
| Ignition  | $1M - $10M      | $349 / mo    | **$3,490 / year**      | Unified Analytics. Replaces BI tools.   |
| Clarity   | $10M - $20M     | $799 / mo    | **$7,990 / year**      | Core Operations Sync. Replaces OMS.     |
| Optimize  | $20M - $50M     | $1,999 / mo  | **$19,990 / year**     | The "Franken-Stack Killer." Unified Ops + CX. |
| Autonomous| $50M+           | $4,500+ / mo | Custom Annual Contract | Strategic Headcount Reduction.          |

(See Feature Matrix for detailed plan gating)

## 5. Development Roadmap (High-Level)
- Phase 1: Core Architecture: (✅ Complete)
- Phase 2: FinOps MVP: (✅ Complete)
- Phase 3: Polish & Tech Debt: (In Progress) -> Fixing the core UI is the current priority.
- Phase 4: Launch "Ignition" & "Ops-Intel" (v1): Launch the $349/mo plan and the "Ops Efficiency" dashboard.
- Phase 5: Launch "Warehouse Ops" Module: Develop the WMS-Lite mobile app.
- Phase 6: Launch "Echo Hub" & "Optimize" Plan: Build the full CX suite.
- Phase 7: Launch "Expand" Modules (B2B, Supplier, Clarity): Develop the high-margin add-ons.
- Phase 8: Launch "Dominate" Services (Concierge): Pilot the BPO service.
- Phase 9: The "Autonomous" Engine: Develop true agentic AI for workflow automation.