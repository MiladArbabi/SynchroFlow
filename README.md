# SynchroFlow: The Autonomous Commerce Operations Platform (v5.1)

SynchroFlow is the Autonomous Commerce Operations Platform for D2C and emerging B2B e-commerce brands. It unifies data from platforms like Shopify, Amazon, Zendesk, and Faire into a single operational truth. Our **Product-Led Growth (PLG)** model offers a frictionless self-service experience with an instant sandbox and scoped trials, evolving from data visualization to AI-driven recommendations and ultimately to agentic automation.

## Current Project Status

**Phase 2** (PLG-Powered FinOps MVP) is substantially complete. The foundational UI/UX has been implemented using a professional design system, and the core dashboard widgets are functional. Our current priority is addressing technical debt to ensure a stable and scalable platform before moving to the next feature phase.

## Key Achievements:

* A full-stack, **five-service architecture** (Node.js API, C++ Core, Python AI, React UI, and a dedicated Node.js Integration Service).
* A professional, unified development environment (`npm run dev`) and a robust, stable testing framework (`npm test`).
* A complete, end-to-end **data ingestion and transformation pipeline** (Webhook -> Staging -> Message Queue -> API Worker -> Transformer).
* A **professional UI foundation** built on Material-UI, providing a consistent and modern user experience.
* The core **FinOps Command Center** with live-data widgets for Gross Revenue, Gross Margin, Inventory Value, Inventory Health, and Fulfillment status.

## Technical Architecture

SynchroFlow uses a decoupled, event-driven microservices architecture designed for global scale and data residency. It follows a **Data Lakehouse** approach to combine the speed of an operational database with the analytical power of a data warehouse.

```mermaid
graph TD
    subgraph "Third-Party Platforms"
        SP[Shopify] AM[Amazon] FR[Faire] SL[Shopee/Lazada] ML[Mercado Libre] ZD[Zendesk] WS[Webshipper/WMS] PP[PayPal/PYUSD]
    end

    subgraph "SynchroFlow Platform"
        subgraph "Client Layer"
            UI[React UI (Vite, Material-UI)]
        end
        
        subgraph "Web Layer (Node.js)"
            API[Express.js API Server]
        end

        subgraph "Integration Layer (Node.js)"
            IS[Integration Service] MQ[(RabbitMQ/SQS)]
        end

        subgraph "Core Services"
            CPP[C++ Engine] AI[Python AI Engine (PyTorch/LangChain)]
        end

        subgraph "Data Layer"
            S3[S3/GCS] DW[BigQuery/Redshift] DB[(PostgreSQL)] CACHE[(Redis)]
        end
    end

    %% Connections
    SP & AM & FR & SL & ML & ZD & WS & PP -- Webhooks/Polling --> IS
    IS -- Raw Events --> S3
    IS -- Job Tickets --> MQ
    API -- Consumes Jobs From --> MQ
    
    UI -- HTTPS --> API
    API -- N-API Call --> CPP
    API -- REST --> AI
    API -- Knex.js CRUD --> DB
    API -- Caching --> CACHE
    CPP -- libpqxx Bulk Ops --> DB
    AI --> DW & DB
```

### Key Architectural Principles
* **Multi-Region Deployment:** Infrastructure will be deployed in distinct EU, US, APAC, and LATAM regions.
* **Data Lakehouse Approach:** Raw data is staged in Object Storage (S3/GCS), live data is in PostgreSQL, and historical data is in a Data Warehouse (BigQuery/Redshift).

### Technology Stack
* **Frontend:** React (Vite), TypeScript, Material-UI, Emotion, TanStack Table, Chart.js.
* **API/Backend:** Node.js, Express.js, TypeScript, Knex.js, amqplib.
* **Data Layer:** PostgreSQL (Docker), RabbitMQ (Docker), Redis.
* **High-Performance Core:** C++, N-API, libpqxx.
* **AI Engine:** Python, FastAPI, PyTorch, LangChain.
* **DevOps:** Docker, NPM Workspaces, Jest, Supertest, React Testing Library.

## Local Development Setup

### Prerequisites
* Node.js (v20+), Docker, Homebrew, C++ Compiler, Python 3 & `venv`.

### 1. First-Time Installation
```bash
# Clone the repository
git clone [https://github.com/MiladArbabi/SynchroFlow.git](https://github.com/MiladArbabi/SynchroFlow.git)
cd SynchroFlow

# Install C++ dependencies
brew install libpq libpqxx

# Set up Python virtual environment
cd packages/ai-engine && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && deactivate && cd ../..

# Install all Node.js dependencies
npm install
```

### 2. Running the Application
```bash
# 1. Start Docker services
docker-compose up -d
# 2. Wait for DB to initialize
sleep 5
# 3. Run database migrations
npm run migrate -w api
# 4. Start all application services
npm run dev
```

## Roadmap
This is a high-level overview. For details, see the **Project Milestones on GitHub**.
* **Phase 1: Core Performance Proof (✅ Complete)**
* **Phase 2: PLG-Powered FinOps MVP (✅ Complete)**
* **Phase 3: Optimization Engine (In Progress)**: Introduce AI-driven recommendations and address technical debt.
* **Phase 4: The Autonomous Engine (Upcoming)**: Deliver true workflow automation with agentic AI.