# SynchroFlow: Real-Time E-commerce Orchestration Platform

SynchroFlow is a B2B SaaS platform designed to solve inventory synchronization and compliance issues for mid-market e-tailers. Our unique value proposition is a high-performance C++ core that guarantees sub-100ms data consistency between disparate systems (ERP, E-commerce, WMS), eliminating overselling and automating compliance risk.

## Current Project Status
**Phase 1: Core Performance Proof (MVP)** is complete. The foundational technical architecture has been built and validated. We have successfully established:

* A PERN stack API with a full CRUD interface for managing data.
* A high-performance C++ core connected to Node.js via N-API.
* A decoupled Python AI engine for forecasting.
* A React-based UI for the main application shell.
* A professional, unified development environment (`npm run dev`).
* A robust, automated, full-stack testing framework (`npm test`).

We are now beginning the feature implementation for **Phase 2**, starting with the FinOps Command Center.

## Technical Architecture
SynchroFlow uses a hybrid architecture to combine the rapid development of a modern web stack with the raw performance of C++.

graph TD
    subgraph "Browser"
        UI[React UI - Vite]
    end
    subgraph "Web Layer (Node.js)"
        API[Express.js API Server]
    end
    subgraph "High-Performance Core (C++)"
        CPP[C++ Engine & In-Memory Cache]
    end
    subgraph "AI Engine (Python)"
        AI[ML Microservice<br>(Forecasting)]
    end
    subgraph "Data Layer"
        DB[PostgreSQL Database]
    end

    UI -- HTTPS --> API
    API -- N-API Call --> CPP
    CPP -- Load/Persist --> DB
    API -- Knex.js --> DB
    API -- API Call --> AI

### Technology Stack

  * **Frontend:** React (Vite), TypeScript, Tailwind CSS (planned).
  * **API/Backend:** Node.js, Express.js, TypeScript, Knex.js.
  * **Database:** PostgreSQL (Docker).
  * **High-Performance Core:** C++, N-API, `libpqxx`, `node-gyp`.
  * **AI Engine:** Python, FastAPI, Pandas, Statsmodels.
  * **Development & Testing:** NPM Workspaces, `concurrently`, `nodemon`, Jest, Supertest, React Testing Library.

## Local Development Setup

### Prerequisites

  * **Node.js** (v20 or later - Use `nvm` to manage versions).
  * **Docker** and **Docker Compose**.
  * **Homebrew** (for macOS dependencies).
  * A C++ compiler (**Xcode Command Line Tools** on macOS).
  * **Python 3** & `venv`.

### 1\. First-Time Installation

This one-time setup clones the repository and prepares all dependencies.

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

### 2\. Running the Application

The entire application stack (API, C++ Watcher, AI Engine, UI) can be started with a single command from the project root.

# 1. Start the database container (if not already running)
docker-compose up -d

# 2. Run database migrations (only needs to be done once after a reset)
npm run migrate -w api

# 3. Start the entire application stack
npm run dev

The services will be available at:

  * **React UI**: `http://localhost:5173`
  * **Node.js API**: `http://localhost:3000`
  * **Python AI Engine**: `http://localhost:8000`

### 3\. Running Tests

The unified test suite can be run from the project root. It will automatically reset the test database, run all migrations, and then execute the full-stack test suite for both backend and frontend projects.

npm test

## Project Structure

This is a monorepo managed with NPM Workspaces.

  * `/packages/api`: The Node.js/Express.js API server, database migrations, and web logic.
  * `/packages/cpp-core`: The high-performance C++ addon.
  * `/packages/ai-engine`: The Python/FastAPI microservice for all machine learning models.
  * `/packages/ui`: The React/Vite application for the user-facing dashboard.

## Roadmap

For a detailed view of upcoming features and phases, please see the Project Milestones.