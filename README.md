# SynchroFlow: The Autonomous Commerce Operations Platform (v5.5)

SynchroFlow is a B2B SaaS platform engineered to be the central nervous system for mid-market ($1M - $50M+ ARR) e-commerce brands. We solve the two most expensive operational challenges: data fragmentation and communication silos.

Our platform is built on a high-performance C++ core that serves as a single source of truth, evolving from a unified platform into a complete commerce ecosystem.

## 1. Current Project Status & Key Achievements

**Phase 3 (UI Foundation & Core Features)** is now substantially complete. We have successfully implemented a robust, scalable foundation for the application's user interface and core functionalities.

**Key Achievements Since v5.4:**

* **IDE-Style Resizable Layout:** Implemented a dynamic 4-panel application shell (`AppLayout`) using `react-resizable-panels`, replacing the previous static layout.
* **Customizable Widget Workspace:** Integrated `react-grid-layout` into the main workspace panel, allowing users to drag, resize, add, and remove widgets.
* **Layout Persistence:** Full-stack implementation enabling users to save their customized dashboard layouts to the database (`user_layouts` table) and have them restored on page load.
* **Widget Library & Marketplace Foundation:** Built the UI shell for the Widget Library, including dynamic rendering, add/remove logic, and the visual implementation of feature gating ("locked" widgets based on user plan).
* **Modern Icon System:** Replaced the legacy icon font system with a custom `<IconComponent>` wrapper using the performant `lucide-react` SVG library.
* **Major Component Cleanup:** Removed significant technical debt by deleting unused and problematic Material Dashboard (`MD*`) template components. Refactored core components (`MDBox`, `MDTypography`, `MDButton`) to use standard MUI primitives (`Box`, `Typography`, `Button`), improving predictability.
* **Streamlined Workflow:**
    * Established a Component-Driven Development (CDD) workflow using Storybook.
    * Created the `ship.sh` script to automate the local Git add, commit, push, and PR creation process.

## 2. Core Product Modules & Offerings (v5.4 - Unchanged)

### Core Platform
* **FinOps Command Center:** Unified dashboard for finance and operations. (Foundation Implemented)
* **Echo Communications Hub:** Unified inbox for customer support. (Planned)
* **Ops-Intel Engine:** A cross-platform module to track and quantify labor cost savings. (Planned)

### Core Operations Module
* **"SynchroFlow Warehouse Ops" (WMS-Lite):** Mobile-based pick/pack/ship module. (Planned)

### Advanced Platform Modules (Expansion)
* **"SynchroFlow Clarity":** AI-driven industry benchmarking. (Planned)
* **Supplier & Procurement Portal:** Manages the complete PO lifecycle. (Planned)
* **B2B Wholesale Portal:** Revenue-generating B2B ordering portal. (Planned)

### Ecosystem Services (Dominance)
* **"SynchroFlow Concierge":** Premium BPO service. (Planned)

## 3. Technical Architecture (v5.5)

SynchroFlow uses a decoupled, five-service microservices architecture. The core UI now utilizes a modern, resizable panel system.

```mermaid
graph TD
    subgraph "External Platforms"
        ThirdParty[Shopify, NetSuite, Zendesk, etc.]
    end

    subgraph "User Interface Layer"
        UI[React UI (Web - Vite, MUI, Resizable Panels)]
        WMS_App[WMS Mobile App (Planned)]
        B2B[B2B Wholesale Portal (Planned)]
        SUP[Supplier Portal (Planned)]
    end

    subgraph "SynchroFlow Platform"
        subgraph "Integration Layer"
            IS[Integration Service<br>(Node.js)]
            MQ[(RabbitMQ<br>Message Queue)]
        end

        subgraph "Web Layer & Core API"
            API[Express.js API Server<br>(Handles FinOps, Layouts, Echo, B2B, POs, WMS)]
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
            DW[Data Warehouse (Planned)]
            S3[S3 Data Lake (Planned)]
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
````

### Key Architectural Principles

  * Multi-Region Deployment: (Planned) Infrastructure deployment in distinct EU, US, APAC, LATAM regions.
  * Data Lakehouse Approach: (Planned) Raw data in Object Storage (S3), live data in PostgreSQL, historical data in a Data Warehouse.

### Technology Stack

  * **Frontend:** React (Vite), TypeScript, Material UI (MUI Core: `Box`, `Typography`, `Button`, etc.), Emotion, `react-resizable-panels`, `react-grid-layout`, `lucide-react`, TanStack Table, Chart.js, Axios.
  * **API/Backend:** Node.js, Express.js, TypeScript, Knex.js, `pg`, `amqplib`.
  * **Data Layer:** PostgreSQL (Docker), RabbitMQ (Docker), Redis (Planned).
  * **High-Performance Core:** C++, N-API, `libpqxx`.
  * **AI Engine:** Python, FastAPI, PyTorch (Planned), LangChain (Planned).
  * **DevOps & Testing:** Docker, NPM Workspaces, Storybook, Jest, Supertest, React Testing Library, GitHub Actions (Planned CI/CD).

## 4\. Local Development Setup

### Prerequisites

Node.js (v20+), Docker, Homebrew (macOS), C++ Compiler, Python 3 & `venv`.

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
# Clean start: Resets DB, runs migrations, starts all services with hot-reloading.
npm run dev:full
```

The services will typically be available at:

  * React UI: `http://localhost:5173/` (or next available port)
  * Node.js API: `http://localhost:3000`
  * Integration Service: `http://localhost:3001`
  * Python AI Engine: `http://localhost:8000`
  * Storybook: `http://localhost:6006` (Run separately: `npm run storybook -w ui`)

### Local Workflow Automation

```bash
# Use ship.sh for add, commit, push, and PR creation
./ship.sh "type(scope): Your commit message"
```

*(Merge PR manually via `gh pr merge <PR_NUM> --squash --delete-branch`)*

## 5\. GTM & Pricing Strategy (v5.4 - Unchanged)

Our GTM is a Product-Led Growth (PLG) motion funneling into sales-led conversion, based on a **Margin-Protected Penetration** strategy.

  * **Acquisition:** "Ignition" plan.
  * **Cash Flow:** Drive Annual Upfront Contracts ("2 Months Free" discount).
  * **Expansion:** Upsell via Widget Marketplace and dedicated modules.

### The Pricing Ladder (Annual-First)

| Plan       | Target ICP (ARR) | Monthly Price | Annual Price (Upfront) | Core Value Proposition                  |
|------------|------------------|---------------|-------------------------|-----------------------------------------|
| Ignition  | $1M - $10M      | $349 / mo    | **$3,490 / year\*\* | Unified Analytics. Replaces BI tools.   |
| Clarity   | $10M - $20M     | $799 / mo    | **$7,990 / year\*\* | Core Operations Sync. Replaces OMS.     |
| Optimize  | $20M - $50M     | $1,999 / mo  | **$19,990 / year\*\* | The "Franken-Stack Killer." Unified Ops + CX. |
| Autonomous| $50M+           | $4,500+ / mo | Custom Annual Contract | Strategic Headcount Reduction.          |

*(See Feature Matrix for detailed plan gating)*

## 6\. Development Roadmap (High-Level - Updated v5.5)

  * **Phase 1: Core Architecture:** (✅ Complete)
  * **Phase 2: FinOps MVP:** (✅ Complete)
  * **Phase 3: UI Foundation & Core Features:** (✅ Complete) - *Includes IDE Layout, Workspace Customization, Icon System, Component Cleanup.*
  * **Phase 4: Launch "Ignition" & "Ops-Intel" (v1):** (Next Up) - Launch the $349/mo plan, implement the Ops Efficiency dashboard.
  * **Phase 5: Launch "Warehouse Ops" Module:** Develop the WMS-Lite mobile app.
  * **Phase 6: Launch "Echo Hub" & "Optimize" Plan:** Build the full CX suite.
  * **Phase 7: Launch "Expand" Modules (B2B, Supplier, Clarity):** Develop high-margin add-ons.
  * **Phase 8: Launch "Dominate" Services (Concierge):** Pilot the BPO service.
  * **Phase 9: The "Autonomous" Engine:** Develop true agentic AI for workflow automation.