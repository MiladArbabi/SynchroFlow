## SynchroFlow: The Autonomous Commerce Operations Platform
SynchroFlow is a B2B SaaS platform engineered to solve the most expensive operational challenges for mid-market, direct-to-consumer (D2C) brands: data fragmentation and communication silos. Our solution is a unified platform built on a high-performance C++ core that serves as the single source of operational truth, an AI engine for intelligent forecasting, and a React-based UI for command and control.

## Current Project Status
**Phase 1: Core Architecture & Integration Layer Foundation** is complete. The foundational technical architecture, including a new decoupled Integration Service, has been built, tested, and validated. We are now actively building the features for 

**Phase 2**, starting with the FinOps Command Center and its data ingestion pipeline.

## Key Achievements:

A full-stack, **five-service architecture** (Node.js API, C++ Core, Python AI, React UI, and a dedicated Node.js Integration Service).

A professional, unified development environment with a single command (npm run dev).

A robust, automated, full-stack testing framework (npm test) with guaranteed clean-slate database resets.

A complete UI application shell with routing, layout, and a tested login page.

The first live KPI widget and backend simulation engine for the FinOps dashboard.

## Technical Architecture
SynchroFlow uses a decoupled, event-driven microservices architecture. It combines the rapid development of TypeScript with the raw performance of a C++ core, all orchestrated by a message queue for scalability and resilience.

## Code snippet

```mermaid
graph TD
    subgraph "External Platforms"
        ThirdParty[Shopify, NetSuite, etc.]
    end

    subgraph "User Interface"
        UI[React UI - Vite]
    end

    subgraph "SynchroFlow Platform"
        subgraph "Integration Layer"
            IS[Integration Service<br>(Node.js)]
            MQ[(RabbitMQ<br>Message Queue)]
        end

        subgraph "Web Layer & Core API"
            API[Express.js API Server]
        end

        subgraph "High-Performance Core"
            CPP[C++ Engine]
        end

        subgraph "AI Engine"
            AI[Python Microservice]
        end

        subgraph "Data Layer"
            DB[(PostgreSQL)]
        end
    end

    ThirdParty -- Webhooks --> IS
    IS -- Publishes Events --> MQ
    API -- Consumes Events --> MQ
    UI -- HTTPS --> API
    API -- N-API Call --> CPP
    API -- Knex.js --> DB
    CPP -- libpqxx --> DB
    API -- REST --> AI
```


Technology Stack
Frontend: React (Vite), TypeScript, React Router, Recharts.

API/Backend: Node.js, Express.js, TypeScript, Knex.js, amqplib.

Database & Message Queue: PostgreSQL (Docker), RabbitMQ (Docker).

High-Performance Core: C++, N-API, libpqxx.

AI Engine: Python, FastAPI, Pandas, Statsmodels.

Development & Testing: NPM Workspaces, Concurrently, Nodemon, Jest, Supertest, React Testing Library.

Local Development Setup
Prerequisites
Node.js (v20 or later - Use nvm to manage versions).

Docker and Docker Compose.

Homebrew (for macOS dependencies).

A C++ compiler (Xcode Command Line Tools on macOS).

Python 3 & venv.

1. First-Time Installation
This one-time setup clones the repository and prepares all dependencies.

Bash

# Clone the repository
git clone https://github.com/MiladArbabi/SynchroFlow.git
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
2. Running the Application
The entire application stack (API, C++ Watcher, AI Engine, UI) can be started with a single command from the project root.

Bash

# 1. Start the database container (if not already running)
docker-compose up -d

# 2. Run database migrations (only needs to be done once after a reset)
npm run migrate -w api

# 3. Start the entire application stack with hot-reloading
npm run dev
The services will be available at:

React UI: http://localhost:5173

Node.js API: http://localhost:3000
Integration Service: http://localhost:3001

Python AI Engine: http://localhost:8000

3. Running Tests
The unified test suite can be run from the project root. It will automatically reset and migrate the test database before running all backend and frontend tests, ensuring a clean state for every run.

npm test
Project Structure
This is a monorepo managed with NPM Workspaces.

/packages/api: The Node.js/Express.js API server and database logic.

/packages/cpp-core: The high-performance C++ addon.

/packages/ai-engine: The Python/FastAPI microservice for machine learning.

/packages/integration-service: The dedicated service for handling all third-party API communications and webhooks.

/packages/ui: The React/Vite application for the user-facing dashboard.

## Roadmap
For a detailed view of upcoming features and phases, please see the Project Milestones on GitHub.