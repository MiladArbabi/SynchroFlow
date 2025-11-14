# MVP Dashboard UX Implementation Issues

## Epic: #749 Implement MVP User State System

### #749a: Extend User Database Schema
**Priority**: P0
**Estimate**: 2 hours
**Tasks**:
- [x] Add columns to users table: preferred_mode, detected_mode, shopify_connected, stripe_connected, first_insight_delivered
- [x] Create user_milestones table
- [x] Update User type in packages/api/src/types.ts
- [x] Create migration file

### #749b: Implement Basic Mode Detection
**Priority**: P0  
**Estimate**: 3 hours
**Tasks**:
- [x] Create UserStateService in packages/api/src/services/
- [x] Implement basic mode detection logic
- [x] Add API endpoint for user state
- [x] Write unit tests for mode detection

### #749c: Create DashboardStateManager
**Priority**: P0
**Estimate**: 4 hours
**Tasks**:
- [x] Create DashboardStateManager component in UI
- [x] Implement state-based rendering logic
- [x] Create empty states for each user scenario
- [x] Connect to user state API

### #749d: Implement Basic Widget Layout
**Priority**: P1
**Estimate**: 6 hours
**Tasks**:
- [ ] Create basic widget container components
- [ ] Implement survival mode layout
- [ ] Add responsive grid system
- [ ] Create loading states

## Success Criteria
- [ ] User can see appropriate dashboard based on their state
- [ ] Mode detection works for basic scenarios
- [ ] First-Week Journey milestones can be tracked
- [ ] #731 E2E test can be unblocked and completed
