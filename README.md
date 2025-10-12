# SynchroFlow: The Autonomous Commerce Operations Platform (v3.0)

SynchroFlow is the Autonomous Commerce Operations Platform for mid-market ($10M - $40M ARR) D2C brands, engineered to turn operations from a cost center into a core profit driver. We eliminate data fragmentation by creating a single source of operational truth, integrating platforms like Shopify, Amazon, Zendesk, and WMS. Our **Product-Led Growth (PLG)** model provides a frictionless, self-service experience, allowing brands to see tangible value with their own data in minutes.

## Current Project Status

**Phase 1** (Core Architecture) is complete. We are now in **Phase 2: PLG-Powered FinOps MVP**. The goal is to launch the self-service "FinOps Command Center" with a robust PLG funnel. Our current priority is building the worker process to consume and transform ingested data from our integration pipeline.

## Key Achievements:

* A full-stack, **five-service architecture** (Node.js API, C++ Core, Python AI, React UI, and a dedicated Node.js Integration Service).
* A professional, unified development environment with a single command (`npm run dev`).
* A robust, automated, full-stack testing framework (`npm test`).
* **Completed the full-stack Data Mapping feature**, including a backend CRUD API and a frontend UI.

## Technical Architecture

SynchroFlow uses a decoupled, event-driven microservices architecture designed for global scale and data residency. It follows a **Data Lakehouse** approach to combine the speed of an operational database with the analytical power of a data warehouse.

```mermaid
graph TD
    subgraph "Third-Party Platforms"
        direction LR
        SP[Shopify]
        ZD[Zendesk]
        WS[Webshipper]
    end

    subgraph "SynchroFlow Platform"
        direction LR
        subgraph "Browser"
            UI[React UI]
        end
        
        subgraph "Web Layer (Node.js)"
            API[Express.js API Server<br>Serves UI, Processes Jobs]
        end

        subgraph "Integration Layer (Node.js)"
            IS[Integration Service<br>Handles Webhooks & Polling]
            MQ[(Message Queue<br>RabbitMQ / SQS)]
        end

        subgraph "Core Services"
            CPP[C++ Engine<br>High-Performance Ops]
            AI[Python AI Engine<br>Forecasting & Simulation]
        end

        subgraph "Data Layer"
            S3[Object Storage (S3/GCS)<br>Raw JSON Staging Area]
            DW[Data Warehouse (BigQuery/Redshift)<br>Analytics & AI Training]
            DB[(PostgreSQL Database<br>Live Application Data)]
        end
    end

    %% Connections
    SP & ZD & WS -- Webhooks/API --> IS
    IS -- Raw Events --> S3
    IS -- Pushes Standardized Events --> MQ
    API -- Consumes Jobs From --> MQ
    
    UI -- HTTPS --> API
    API -- N-API Call --> CPP
    API -- REST --> AI
    API -- Knex.js CRUD --> DB
    CPP -- libpqxx Bulk Ops --> DB
```

### Key Architectural Principles
* **Multi-Region Deployment:** The infrastructure will be deployed in distinct EU and US regions to ensure data residency and compliance with GDPR.
* **Data Lakehouse Approach:** Raw, immutable data is staged in Object Storage (S3/GCS). The operational database (PostgreSQL) holds the live, canonical data, while the Data Warehouse (BigQuery/Redshift) stores the full historical dataset for analytics and AI.

### Technology Stack
* **Frontend:** React (Vite), TypeScript, React Router, Recharts.
* **API/Backend:** Node.js, Express.js, TypeScript, Knex.js, amqplib.
* **Data Layer:** PostgreSQL (Docker), RabbitMQ (Docker), S3/GCS, BigQuery/Redshift.
* **High-Performance Core:** C++, N-API, libpqxx.
* **AI Engine:** Python, FastAPI, Pandas, Statsmodels.
* **Development & Testing:** NPM Workspaces, Concurrently, Nodemon, Jest, Supertest, React Testing Library.

## Local Development Setup

### Prerequisites
* Node.js (v20 or later - Use `nvm` to manage versions).
* Docker and Docker Compose.
* Homebrew (for macOS dependencies).
* A C++ compiler (Xcode Command Line Tools on macOS).
* Python 3 & `venv`.

### 1. First-Time Installation
This one-time setup clones the repository and prepares all dependencies.
```bash
# Clone the repository
git clone [https://github.com/MiladArbabi/SynchroFlow.git](https://github.com/MiladArbabi/SynchroFlow.git)
cd SynchroFlow

# Install C++ dependencies
brew install libpq libpqxx

# Set up Python virtual environment for the AI engine
cd packages/ai-engine
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ../..

# Install all Node.js dependencies for all workspaces
npm install
```

### 2. Running the Application
The entire application stack can be started with a single command from the project root.
```bash
# 1. Start the database container (if not already running)
docker-compose up -d

# 2. Run database migrations (only needs to be done once after a reset)
npm run migrate -w api

# 3. Start the entire application stack with hot-reloading
npm run dev
```
The services will be available at:
* React UI: http://localhost:5173
* Node.js API: http://localhost:3000
* Integration Service: http://localhost:3001
* Python AI Engine: http://localhost:8000

### 3. Running Tests
The unified test suite can be run from the project root.
```bash
npm test
```
## Project Structure
This is a monorepo managed with NPM Workspaces.
* `/packages/api`: The Node.js/Express.js API server and database logic.
* `/packages/cpp-core`: The high-performance C++ addon.
* `/packages/ai-engine`: The Python/FastAPI microservice for machine learning.
* `/packages/integration-service`: The dedicated service for handling all third-party API communications and webhooks.
* `/packages/ui`: The React/Vite application for the user-facing dashboard.

## Roadmap
This is a high-level overview. For a detailed view of specific issues, see the **Project Milestones on GitHub**.
* **Phase 1: Core Performance Proof (✅ Complete)**
* **Phase 2: PLG-Powered FinOps MVP (In Progress)**: Launch the self-service "FinOps Command Center" with a robust Product-Led Growth funnel.
* **Phase 3: The Optimization Engine (Upcoming)**: Introduce AI-driven recommendations to move from visibility to proactive decision-making.
* **Phase 4: The Autonomous Engine (Upcoming)**: Deliver on the promise of Autonomous Commerce with true workflow automation.