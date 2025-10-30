# LaSyncro: The Autonomous Commerce Operations Platform (v5.8)

LaSyncro (formerly SynchroFlow) is a B2B SaaS platform engineered to be the central nervous system for e-commerce brands, scaling from **solopreneurs ($100K ARR) to mid-market ($50M+ ARR)**. We solve the two most expensive operational challenges: data fragmentation and communication silos.

Our platform is built on a high-performance C++ core that serves as a single source of truth, evolving from a unified platform into a complete commerce ecosystem.

## 1\. Current Project Status & Key Achievements (v5.6)

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

**C++ Integration (Order Status):** Successfully integrated the C++ Core Engine (sf\_core.node) with the API service layer. The /api/v1/orders/:id/status endpoint now retrieves live status directly from the PostgreSQL database via the C++ addon.

  * **Robust E2E Testing Implemented (100% Green):**
      * Configured Playwright for End-to-End testing with a full authentication `setup` project.
      * Implemented `localStorage` re-hydration in `AuthContext` to allow tests to run as an authenticated user.
      * Established API mocking within tests using `page.route` for speed and isolation.
      * Created passing test suites (22/22) for the entire auth flow, Customer360Page, OrdersPage, Order360Page, and DashboardPage.
      * Integrated React Query retry disabling (e.g., on 404s) to ensure deterministic test runs.

**Automated Database Seeding:** Added a Knex seed file (dev\_seed.ts) and integrated it into the `npm run dev:full` startup script. The development database is now automatically reset, migrated, and seeded with consistent test data on every start.

## 2\. Core Product Modules & Offerings

### Core Platform

  * **FinOps Command Center:** Unified dashboard for finance and operations. (Foundation Implemented)
  * **Echo Communications Hub:** Unified inbox for customer support. (Planned)
  * **Ops-Intel Engine:** A cross-platform module to track and quantify labor cost savings. (Planned)

### Core Operations Module

  * **"LaSyncro Warehouse Ops" (WMS-Lite):** Mobile-based pick/pack/ship module. (Planned)

### Advanced Platform Modules (Expansion)

  * **"LaSyncro Clarity":** AI-driven industry benchmarking. (Planned)
  * **Supplier & Procurement Portal:** Manages the complete PO lifecycle. (Planned)
  * **B2B Wholesale Portal:** Revenue-generating B2B ordering portal. (Planned)

### Ecosystem Services (Dominance)

  * **"LaSyncro Concierge":** Premium BPO service. (Planned)

## 3\. Technical Architecture (v5.8)

LaSyncro uses a decoupled, five-service microservices architecture. The API layer now follows a standard Service/Controller pattern. The core UI is powered by a dynamic layout system and the Berry MUI theme engine. The C++ Core Engine provides direct, high-performance database access for critical operations like Order Status retrieval.

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

    subgraph "LaSyncro Platform"
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
```

### Key Architectural Principles

  * Multi-Region Deployment: (Planned) Infrastructure deployment in distinct EU, US, APAC, LATAM regions.
  * Data Lakehouse Approach: (Planned) Raw data in Object Storage (S3), live data in PostgreSQL, historical data in a Data Warehouse.

### Technology Stack

  * **Frontend:** React (Vite), TypeScript, **Material UI (MUI Core)**, Emotion, `react-resizable-panels`, `react-grid-layout`, `lucide-react`, **`react-apexcharts`**, **`react-intl`**, `framer-motion`, `lodash-es`, Axios, @tanstack/react-query.
  * **API/Backend:** Node.js, Express.js, TypeScript, Knex.js, `pg`, `amqplib`.
  * **Data Layer:** PostgreSQL (Docker), RabbitMQ (Docker), Redis (Planned).
  * **High-Performance Core:** C++, N-API, `libpqxx`.
  * **AI Engine:** Python, FastAPI, PyTorch (Planned), LangChain (Planned).
  * **DevOps & Testing:** Docker, NPM Workspaces, Storybook, Jest, Supertest, React Testing Library, **Playwright (E2E)**, **Knex Migrations & Seeding**, GitHub Actions (Planned CI/CD).

## 4\. Local Development Setup

### Prerequisites

Node.js (v20+), Docker, Homebrew (macOS), C++ Compiler, Python 3 & `venv`.

### First-Time Installation

```bash
# Clone the repository
git clone [YOUR_REPO_URL]
cd LaSyncro

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

### Running Tests

#### Unit & Integration Tests (API/UI)

```bash
# Run API unit/integration tests (if configured)
npm test -w api

# Run UI unit/integration tests (using Vitest/RTL)
npm test -w ui
```

#### End-to-End Tests (UI - Playwright)

Ensure no servers are running manually first. Playwright will start its own server instance.

```bash
# From the root LaSyncro directory:
npm run test:e2e

# To view the latest HTML report after a run:
npx playwright show-report packages/ui/playwright-report
```

### Local Workflow Automation

```bash
# Use ship.sh for add, commit, push, and PR creation
./ship.sh "type(scope): Your commit message"
```

*(Merge PR manually via `gh pr merge <PR_NUM> --squash --delete-branch`)*

## 5\. GTM & Pricing Strategy (Updated v5.8)

Our GTM is a Product-Led Growth (PLG) motion funneling into sales-led conversion. The introduction of the "Spark" tier creates a powerful entry point, capturing micro-businesses and solopreneurs before they are forced to build a "spreadsheet stack."

### The Pricing Ladder (Annual-First)

| Plan | Target ICP (ARR) | Monthly Price | Annual Price (Upfront) | Core Value Proposition (Positioning) |
| :--- | :--- | :--- | :--- | :--- |
| **Spark** | $100K - $1M | $149 / mo | **$1,490 / year\*\* | **Your First Operations Hire.** Saves time for solopreneurs wearing too many hats. |
| **Ignition** | $1M - $10M | $349 / mo | **$3,490 / year\*\* | **Spreadsheet Replacement.** Unified analytics & team coordination. |
| **Clarity** | $10M - $20M | $799 / mo | **$7,990 / year\*\* | **"Franken-Stack" Consolidation.** Core operations sync (replaces OMS). |
| **Optimize** | $20M - $50M | $1,999 / mo | **$19,990 / year\*\* | Unified Ops + CX. |
| **Autonomous**| $50M+ | $4,500+ / mo | Custom Annual Contract | Strategic Headcount Reduction. |

## 6\. Development Roadmap (High-Level - Updated v5.8)

  * **Phase 1: Core Architecture:** (✅ Complete)
  * **Phase 2: FinOps MVP:** (✅ Complete)
  * **Phase 3: UI Foundation & Core Features:** (✅ **Complete**)
      * *Includes full Berry Theme Engine integration, C++ API wiring, automated DB seeding, and a 100% green E2E test suite.*

-----

  * **Phase 4 (In Progress): Launch "Spark" Plan (12-Week Sprint)**

      * **Primary Goal:** To launch the **"Spark"** plan by focusing 100% on features that deliver **immediate, undeniable time or money savings** to our new ICP: the time-strapped **solopreneur**.
      * **Success Validation:** All features will be validated against: 1) **Time to Value**, 2) **Actionability**, 3) **Scalability**, and 4) **Integration Potential**.
      * **Guiding Principle (The "Magic Number"):** Every feature must be validated against its ability to move a single key metric for this ICP: **"weekly time saved"** or **"reduction in manual errors."**

    #### Implementation Strategy

      * **Weeks 1-4: Core Value Delivery**
          * **Focus:** Basic data visualization, alerting, and core integrations.
          * **Build:** `Revenue Operations Dashboard` & `Inventory Intelligence Center`.
          * **Build:** Basic `Operational Efficiency Tracker` ("Inefficiency Tax" widget).
          * **Integrate:** Shopify, core carriers (e.g., FedEx, UPS).
      * **Weeks 5-8: Intelligence Layer**
          * **Focus:** Trends, insights, and expanded integrations.
          * **Enhance:** Add trend analysis, basic forecasting, and performance benchmarking to existing widgets.
          * **Build:** `Customer Operations Hub` widget.
          * **Integrate:** Support tools (e.g., Zendesk), Email tools (e.g., Klaviyo).
      * **Weeks 9-12: Automation Foundation**
          * **Focus:** Proactive suggestions and workflow templates.
          * **Build:** Initial workflow automation templates (e.g., "Low Stock Alert").
          * **Enhance:** Add proactive recommendations (e.g., reorder points) to widgets.
          * **Integrate:** Basic accounting software (e.g., QuickBooks).

    #### Foundational Task: Customer Behavior Monitoring

    To support this, we must immediately begin implementing the product analytics foundation:

      * **Event Tracking:** Implement tracking for all critical user interactions (feature adoption, user flows).
      * **Metrics Framework:** Begin tracking key **Activation Metrics** (Time to First Value, Activation Rate) and **Engagement Metrics** (DAU/WAU, Stickiness). This is essential for validating the "Magic Number."

-----

  * **Phase 5 (Upcoming): Launch "Ignition" Plan & "Warehouse Ops"**
      * Develop the WMS-Lite mobile app.
      * Introduce team collaboration features to justify the upsell from "Spark" to "Ignition".
  * **Phase 6 (Upcoming): Launch "Echo Hub" & "Optimize" Plan**
      * Build the full CX suite.
  * **Phase 7 (Upcoming): Launch "Expand" Modules (B2B, Supplier, Clarity)**
      * Develop high-margin add-ons, including the AI-driven "Clarity" benchmarking.
  * **Phase 8 (Upcoming): Launch "Dominate" Services (Concierge)**
      * Pilot the BPO service.
  * **Phase 9 (Upcoming): The "Autonomous" Engine**
      * Develop true agentic AI for full workflow automation.