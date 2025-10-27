# SynchroFlow: The Autonomous Commerce Operations Platform (v5.6)

SynchroFlow is a B2B SaaS platform engineered to be the central nervous system for mid-market ($1M - $50M+ ARR) e-commerce brands. We solve the two most expensive operational challenges: data fragmentation and communication silos.

Our platform is built on a high-performance C++ core that serves as a single source of truth, evolving from a unified platform into a complete commerce ecosystem.

## 1. Current Project Status & Key Achievements

**Phase 3 (UI Foundation & Core Features)** is complete. We have successfully replaced our custom UI foundation with a professional, robust, and scalable UI kit based on the **Berry Material React Admin Template**. This provides a consistent, theme-aware, and feature-rich user experience.

**Key Achievements Since v5.5 (Berry Integration):**

* **Full Theme Engine Integration:** Transplanted Berry's theme engine, including custom palettes, preset colors, typography, and dark/light mode logic, all wired to a central `ConfigContext`.
* **Component Overrides Converted:** Ported and converted Berry's entire `themes/overrides` directory to TypeScript, ensuring all MUI components (Buttons, Cards, Inputs, Tables, etc.) match the theme's design.
* **Sidenav & Navigation Functional:** Replaced the placeholder Sidenav with Berry's `MenuList`, `NavGroup`, `NavCollapse`, and `NavItem` components. The navigation is now data-driven from our `menu-items` config and fully supports collapsed/expanded states.
* **Dynamic Header Integrated:** Replaced the placeholder top navbar with Berry's header components, including a functional `ProfileSection`, `NotificationSection`, `SearchSection`, `MegaMenuSection`, `LocalizationSection`, and `MobileSection`.
* **Live Customization Drawer:** Integrated Berry's full "Live Customize" drawer. All child components (`ThemeMode`, `PresetColor`, `BorderRadius`, `FontFamily`, etc.) are converted and correctly wired to the `ConfigContext`, allowing real-time theme changes.
* **Dashboard Widget Refactor:**
    * **`KpiCard`:** Rebuilt to be fully theme-aware, with colors that automatically update based on the selected theme preset.
    * **`InventoryHealthWidget`:** Replaced the custom table with a theme-aware `MainCard` and `MuiTable` implementation.
    * **`CashFlowWidget`:** Replaced the old chart with a professional, theme-aware `ReactApexChart` component.

* **Recent Progress (Connecting Core Features & Testing):**

**API Structure Refactored:** Migrated API logic for Customers, Orders, and Ops-Intel endpoints from routes files into a scalable Service/Controller pattern.

**Core Pages Connected:** Integrated Customer360Page, OrdersPage, Order360Page, and DashboardPage with their respective API endpoints using useQuery, replacing static mock data in the UI.

**C++ Integration (Order Status):** Successfully integrated the C++ Core Engine (sf_core.node) with the API service layer. The /api/v1/orders/:id/status endpoint now retrieves live status directly from the PostgreSQL database via the C++ addon.

* **Robust E2E Testing Implemented:**

Configured Playwright for End-to-End testing of the UI package.

Established API mocking within tests using page.route for speed and isolation.

Implemented data-testid attributes in key UI components for stable test selectors.

Created passing test suites for Customer360Page, OrdersPage, Order360Page, and DashboardPage.

Integrated React Query retry disabling (retry: false) specifically for the E2E test environment.

**Automated Database Seeding:** Added a Knex seed file (dev_seed.ts) and integrated it into the npm run dev:full startup script. The development database is now automatically reset, migrated, and seeded with consistent test data on every start.

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

## 3. Technical Architecture (v5.6)

SynchroFlow uses a decoupled, five-service microservices architecture. The API layer now follows a standard Service/Controller pattern. The core UI is powered by a dynamic layout system and the Berry MUI theme engine. The C++ Core Engine provides direct, high-performance database access for critical operations like Order Status retrieval.

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

  * **Frontend:** React (Vite), TypeScript, **Material UI (MUI Core)**, Emotion, `react-resizable-panels`, `react-grid-layout`, `lucide-react`, **`react-apexcharts`**, **`react-intl`**, `framer-motion`, `lodash-es`, Axios, @tanstack/react-query.
  * **API/Backend:** Node.js, Express.js, TypeScript, Knex.js, `pg`, `amqplib`.
  * **Data Layer:** PostgreSQL (Docker), RabbitMQ (Docker), Redis (Planned).
  * **High-Performance Core:** C++, N-API, `libpqxx`.
  * **AI Engine:** Python, FastAPI, PyTorch (Planned), LangChain (Planned).
  * **DevOps & Testing: Docker, NPM Workspaces, Storybook, Jest, Supertest, React Testing Library, Playwright (E2E), Knex Migrations & Seeding, GitHub Actions (Planned CI/CD).

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
# Clean start: Resets DB, runs migrations, seeds DB, starts all services with hot-reloading.
npm run dev:full
```

The services will typically be available at:

  * React UI: `http://localhost:5173/` (or next available port)
  * Node.js API: `http://localhost:3000`
  * Integration Service: `http://localhost:3001`
  * Python AI Engine: `http://localhost:8000`
  * Storybook: `http://localhost:6006` (Run separately: `npm run storybook -w ui`)

Running Tests
Unit & Integration Tests (API/UI)
Bash

# Run API unit/integration tests (if configured)
npm test -w api

# Run UI unit/integration tests (using Vitest/RTL)
npm test -w ui
End-to-End Tests (UI - Playwright)
Ensure no servers are running manually first. Playwright will start its own server instance.

Bash

# From the root SynchroFlow directory:
npx playwright test --config=packages/ui/playwright.config.ts

# To view the latest HTML report after a run:
npx playwright show-report packages/ui/playwright-report


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

## 6\. Development Roadmap (High-Level - Updated v5.6)

  * **Phase 1: Core Architecture:** (✅ Complete)
  * **Phase 2: FinOps MVP:** (✅ Complete)
  * **Phase 3: UI Foundation & Core Features:** (✅ Complete) - *Includes IDE Layout, Workspace Customization, and full Berry Theme Engine Integration.*
  * **Phase 4: Launch "Ignition" & "Ops-Intel" (v1):** (In Progress) - *Core dashboard widgets (`KpiCard`, `CashFlow`, `InventoryHealth`) are now theme-aware and built on `MainCard`.*
  * **Phase 5: Launch "Warehouse Ops" Module:** (Upcoming) Develop the WMS-Lite mobile app.
  * **Phase 6: Launch "Echo Hub" & "Optimize" Plan:** (Upcoming) Build the full CX suite.
  * **Phase 7: Launch "Expand" Modules (B2B, Supplier, Clarity):** (Upcoming) Develop high-margin add-ons.
  * **Phase 8: Launch "Dominate" Services (Concierge):** (Upcoming) Pilot the BPO service.
  * **Phase 9: The "Autonomous" Engine:** (Upcoming) Develop true agentic AI for workflow automation.