SynchroFlow: Real-Time E-commerce Orchestration Platform
SynchroFlow is a B2B SaaS platform designed to solve inventory synchronization and compliance issues for mid-market e-tailers. Our unique value proposition is a high-performance C++ core that guarantees sub-100ms data consistency between disparate systems (ERP, E-commerce, WMS), eliminating overselling and automating compliance risk.

Current Project Status
Phase 1: Core Performance Proof (MVP) is complete. The foundational technical architecture has been built and validated. We have successfully established:

A PERN stack API with a full CRUD interface for managing data.

A high-performance C++ core connected to Node.js via N-API.

A live, high-speed connection between the C++ core and the PostgreSQL database.

A professional monorepo development environment with automated builds and restarts.

A robust, automated API integration testing framework.

We are now beginning Phase 2, which will focus on building the partner-ready features, starting with the FinOps Command Center.

Technical Architecture
SynchroFlow uses a hybrid architecture to combine the rapid development of a modern web stack with the raw performance of C++. Our future roadmap includes a decoupled Python microservice for AI-powered forecasting.

graph TD
    subgraph "Web Layer (Node.js)"
        B[Express.js API Server]
    end
    subgraph "High-Performance Core (C++)"
        A[C++ Engine & In-Memory Cache]
    end
    subgraph "AI Engine (Python - Planned)"
        C[ML Microservice<br>(Forecasting, Anomaly Detection)]
    end
    subgraph "Data Layer"
        E[PostgreSQL Database]
    end

    Client -- HTTPS --> B
    B -- N-API Call --> A
    A -- Load/Persist --> E
    B -- Knex.js --> E
    B -- Data for Prediction --> C
    C -- Prediction Results --> B

Technology Stack
API/Backend (PERN Stack): PostgreSQL, Express.js, React (planned), Node.js (TypeScript).

High-Performance Core: C++17, N-API, libpqxx, node-gyp.

Development & Testing: NPM Workspaces, concurrently, nodemon, Jest, Supertest.

AI Engine (Planned): A decoupled Python microservice using FastAPI.

Local Development Setup
Prerequisites
Node.js (v18 or later)

Docker and Docker Compose

Homebrew (for macOS dependencies)

A C++ compiler (Xcode Command Line Tools on macOS)

1. Initial Setup
This one-time setup clones the repository, installs all dependencies for all packages, and prepares the C++ libraries.

# Clone the repository
git clone [https://github.com/MiladArbabi/SynchroFlow.git](https://github.com/MiladArbabi/SynchroFlow.git)
cd SynchroFlow

# Install C++ dependencies using Homebrew
brew install libpq libpqxx

# Install all Node.js dependencies for all packages from the root
npm install

2. Running the Development Environment
This is the only command you need for day-to-day development.

# 1. Start the Docker container for the database
docker-compose up -d

# 2. Run the database migrations (only needs to be done once)
npm run migrate -w api

# 3. Start the entire application with one command
npm run dev

The npm run dev command will:

Start the API server on http://localhost:3000.

Watch for changes to TypeScript files in the /api package and restart the server.

Watch for changes to C++ files in the /cpp-core package, automatically rebuild the native addon, and then restart the server.

Testing
The project uses Jest and Supertest for automated API integration testing.

# Run the entire test suite from the project root
npm test

Test files are located in the __tests__ directory within each package (e.g., packages/api/__tests__).

Project Structure
This is a monorepo managed by NPM Workspaces.

/packages/api: The Node.js/Express.js API server, database migrations, and web logic.

/packages/cpp-core: The high-performance C++ addon.

/packages/ai-engine: (Planned) The Python AI/ML microservice.

Roadmap
For a detailed view of upcoming features and phases, please see the Project Milestones.