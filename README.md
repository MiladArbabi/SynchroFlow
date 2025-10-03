SynchroFlow: Real-Time E-commerce Orchestration Platform
SynchroFlow is a B2B SaaS platform designed to solve inventory synchronization and compliance issues for mid-market e-tailers operating across the US and EU. Our unique value proposition is a high-performance C++ core that guarantees sub-100ms data consistency between disparate systems (ERP, E-commerce, WMS), eliminating overselling and automating compliance risk.

Current Project Status
The project is currently in Phase 1: Core Performance Proof (MVP). The foundational technical architecture is complete and validated. This includes:

A PERN stack API for web-layer operations.

A C++ core for high-performance logic, connected to Node.js via N-API.

A live connection between the C++ core and a PostgreSQL database.

A fully functional CRUD API for managing shops and inventory.

Technical Architecture
SynchroFlow uses a hybrid architecture to combine the rapid development of a modern web stack with the raw performance of C++.

graph TD
    subgraph "Web Layer (Node.js)"
        A[Express.js API Server]
    end

    subgraph "High-Performance Core (C++)"
        B[N-API Bridge]
        C[In-Memory Cache]
        D[Business Logic Engine<br>(Compliance, Sync)]
    end

    subgraph "Data Layer"
        E[PostgreSQL Database]
    end

    Client -- HTTPS --> A
    A -- N-API Call --> B
    B <--> D
    D <--> C
    C -- Load/Persist --> E
    A -- Knex.js --> E

Technology Stack
API/Backend (PERN Stack):

PostgreSQL: Database for all "source of truth" data.

Express.js: Web server framework.

React: (Planned for Phase 2) Frontend for the Admin UI.

Node.js (TypeScript): Backend runtime environment.

High-Performance Core:

C++17/20: For all mission-critical, low-latency logic.

N-API / node-addon-api: Bridge for communication between Node.js and C++.

libpqxx: Official C++ client for PostgreSQL.

node-gyp: Build system for the C++ addon.

Local Development Setup
Prerequisites
Node.js (v18 or later)

Docker and Docker Compose

Homebrew (for macOS dependencies)

A C++ compiler (Xcode Command Line Tools on macOS)

1. Installation
# Clone the repository
git clone [https://github.com/MiladArbabi/SynchroFlow.git](https://github.com/MiladArbabi/SynchroFlow.git)
cd SynchroFlow

# Install root dependencies
npm install

2. Database Setup
This will start a PostgreSQL container and create the necessary tables.

# Start the Docker container in the background
docker-compose up -d

# Navigate to the API package to run migrations
cd packages/api

# Run the database migrations to create the tables
npm run migrate

# Navigate back to the project root
cd ../..

3. C++ Core Setup
This requires installing the PostgreSQL client libraries and then building the native addon.

# Install C++ dependencies using Homebrew
brew install libpq libpqxx

# Navigate to the C++ package
cd packages/cpp-core

# Build the C++ addon. The PKG_CONFIG_PATH is required.
PKG_CONFIG_PATH="$(brew --prefix libpq)/lib/pkgconfig" npm run build

# Navigate back to the project root
cd ../..

4. Running the Application
The API server can now be started.

# Navigate to the API package
cd packages/api

# Start the server
npm start

The server will be running on http://localhost:3000.

5. Testing the Setup
From a new terminal, you can use curl to interact with your running API.

# 1. Create a shop
curl -X POST http://localhost:3000/v1/shops \
-H "Content-Type: application/json" \
-d '{
  "name": "SynchroFlow EU Store",
  "contact_email": "contact@synchroflow.eu",
  "auth_secret": "a-very-secret-key-for-this-shop",
  "primary_erp_type": "NetSuite",
  "primary_ecomm_type": "Shopify"
}'

# 2. Add inventory to that shop
curl -X POST http://localhost:3000/v1/inventory \
-H "Content-Type: application/json" \
-d '{
  "sku": "SYN-MUG-WHT-LOGO",
  "description": "White SynchroFlow Coffee Mug",
  "quantity": 500,
  "price": 12.99,
  "warehouse_location": "Shelf C-2",
  "shop_id": 1
}'

# 3. Fetch all inventory
curl http://localhost:3000/v1/inventory

Project Structure
This is a monorepo containing two primary packages:

/packages/api: The Node.js/Express.js API server, database migrations, and all web-facing logic.

/packages/cpp-core: The high-performance C++ addon, including all low-level business logic and database interaction.

Roadmap
The project is organized into several key milestones. For a detailed view of upcoming features and phases, please see the Project Milestones.

Contributing
Contributions are welcome! Please feel free to open an issue or submit a pull request. For major changes, please open an issue first to discuss what you would like to change.