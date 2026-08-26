// tests/setup/jest.node.js
//
// TEST-INFRA-FOUNDATION Slice 1B.
//
// Node-environment Jest setup for backend-legacy, backend-integration, and
// contract. Loaded via `setupFiles` (runs before the test framework installs
// expect/jest globals into the sandbox), matching how the single combined
// root jest.setup.js was already loaded for the node-environment project
// prior to this slice.
//
// Slice 1B's dependency preflight (grep across all 141 backend-legacy /
// backend-integration / contract test files, plus their full transitive
// import graph through api-src/*, @lasyncro/backend-core, @lasyncro/shared,
// and modules-specter/*) found zero references to ResizeObserver,
// EventSource, recharts, virtual:lasyncro-modules, @testing-library/jest-dom,
// document/window/HTMLElement, React Testing Library, or any apps/frontend
// import. This file therefore contains ONLY the one concern proven
// Node-specific by source (apps/backend/src/queue.ts self-enforces the same
// value under NODE_ENV=test) — no UI-only global/mock is included.

require('./jest.shared.js');

// Ensure queue code is disabled in tests to avoid background connections /
// logs / open handles. apps/backend/src/queue.ts:29-31 also self-enforces
// this under NODE_ENV=test; set explicitly here too, matching current
// (pre-Slice-1B) behavior exactly.
process.env.DISABLE_QUEUE = '1';
