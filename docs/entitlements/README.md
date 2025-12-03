# LaSyncro Entitlements System – Overview (v1, FT0)

Welcome to the LaSyncro **Entitlements System** — the permission, capability, and feature-gating framework powering Free Tier (FT0), Paid Tiers, and Module-Based Access across the entire platform.

This directory contains all documentation related to:

- How entitlements work  
- How they are stored  
- How they flow from backend → frontend → UI  
- How widgets and dashboard features are gated  
- How new modules/flags are added

---

## 📦 What Entitlements Do

1. **Define what a shop is allowed to access.**  
   Modules unlock “capabilities” (e.g., dashboard access, analytics, inventory intelligence).  
   Flags unlock smaller feature capabilities inside modules.

2. **Power Free Tier (FT0) gating.**  
   The FT0 bundle is automatically granted upon Shopify OAuth install.

3. **Drive dashboard behavior.**  
   Widgets, UI elements, and future L4 intelligence features check entitlements before rendering.

4. **Provide a single source of truth.**  
   No component decides eligibility on its own.  
   All gating flows through `EntitlementsService` and `EntitlementsProvider`.

---

## 🗂️ Directory Index

| File | Purpose |
|------|---------|
| **frontend.md** | How FE loads and uses entitlements |
| **backend.md** | How BE stores, grants, and exposes entitlements |
| **widget-gating.md** | How entitlements drive widget visibility & gating |
| **onboarding.md** | Step-by-step onboarding for developers |
| **diagram.md** | Visual architecture diagram of the full entitlement flow |

---

## 🧠 Mental Model

Think of entitlements as:

- **Toggles** for which modules a shop has unlocked  
- **Keys** that UI components check before rendering  
- **Contracts** ensuring consistent behavior across all parts of LaSyncro  

This system is the backbone of:

- Free Tier
- Paid upgrades
- Module onboarding
- Feature launches
- Experimentation flags

---

## 🔒 Versioning

This is **Entitlements v1**, used for FT0 rollout.  
Future versions (v2+) will include:

- Plan management
- Cross-module capability graphs
- Time-limited trials
- Experimentation / A/B flags
- Admin overrides

All changes must go through a versioned document + migration plan, consistent with LaSyncro’s CNS architecture.

---
