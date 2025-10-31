# LaSyncro Development Workflow (v5.8)

This document outlines the complete 7-step development workflow for LaSyncro. Following this process ensures that every feature we ship is high-quality, fully-tested, and integrated correctly, preventing regressions and maintaining a green test suite.

## Guiding Philosophy: The Testing Pyramid

We use a blended testing strategy to get fast feedback and high confidence. We catch 99% of bugs *before* an E2E test is written.



1.  **Level 1: Unit & Component Tests (TDD/CDD)**
    * **Purpose:** Verify a *single piece* works in isolation.
    * **Method:** We use **Storybook** (for React components) and **Jest** (for backend logic) to build and test individual units. This is where we apply the "red, green" TDD cycle.

2.  **Level 2: Integration Tests (TDD)**
    * **Purpose:** Verify *multiple pieces* work together as a group.
    * **Method:** We use **Supertest** (for API routes) and **React Testing Library (RTL)** (for full pages) to test the "wiring" between our units.

3.  **Level 3: End-to-End Tests (E2E)**
    * **Purpose:** Verify a *complete user flow* works in a real browser. This is our final "smoke test" and quality gate before merging.
    * **Method:** We use **Playwright** with full API mocking (`page.route()`) for fast, deterministic, and reliable tests.

---

## The 7-Step Feature Workflow

Follow these 7 steps for *every* issue in the backlog.

### 1. `[#ISSUE] Start Work`
Start by creating a new branch from `main`, which should always be stable.

**Example:**
```bash
# Pull the latest main to ensure you're up-to-date
git switch main
git pull

# Create your new feature branch (e.g., for issue #445)
git checkout -b feature/445-revenue-widget