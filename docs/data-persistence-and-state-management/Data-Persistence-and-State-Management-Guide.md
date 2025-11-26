# 🚀 Data Persistence & State Management Guide

## Cost Data Implementation Blueprint

**Last Updated:** 2025-11-26  
**Based on:** Cost Data Persistence Implementation (#866)  
**Status:** ✅ PRODUCTION READY

---

## 📋 Executive Summary

This guide documents the complete implementation pattern for data persistence across frontend and backend, using the Cost Data feature as a real-world example. Follow this blueprint to avoid common pitfalls and ensure consistent, reliable data flow.

---

## 🎯 Core Architecture Pattern

### **Dual-Write Strategy**

[UI Input] → [Frontend Validation] → [Dual Write]
                                      ↓
                    [Backend API] ← [LocalStorage] → [User-State API]
                                      ↓
                            [Multi-Device Sync Ready]

### **Data Flow Sequence**

```typescript
interface DataPersistenceFlow {
  1: 'User inputs cost data in UI',
  2: 'Frontend validates and formats data',
  3: 'Dual write: Save to localStorage (immediate) + Backend API (async)',
  4: 'Backend: Save to product_costs table (permanent)',
  5: 'Backend: Save to user_states table (user-specific)',
  6: 'Frontend: On load, check user-state → localStorage fallback',
  7: 'UI: Display with optimistic updates'
}
```

---

## 🛠️ Frontend Implementation Guide

### **1. API Layer Structure**

#### **File Organization**

packages/ui/src/api/
├── product-costs.ts          # Product-specific costs (backend)
├── user-state.ts             # User-specific state (backend)
└── axiosConfig.ts            # Shared authentication config

#### **Authentication Pattern**

```typescript
// ✅ CORRECT: Use authenticated axiosInstance
import { axiosInstance } from './axiosConfig';

export const fetchUserProductCosts = async (): Promise<UserProductCosts> => {
  const response = await axiosInstance.get('/api/v1/user-state/product-costs');
  return response.data;
};

// ❌ WRONG: Using plain axios (no auth)
import axios from 'axios';
const response = await axios.get('/api/v1/user-state/product-costs'); // 401 Error!
```

#### **Dual-Write Implementation**

```typescript
// packages/ui/src/api/user-state.ts
export const updateUserProductCosts = async (productCosts: UserProductCosts) => {
  // 1. Write to user-state API (multi-device sync)
  await axiosInstance.post('/api/v1/user-state/product-costs', { productCosts });
  
  // 2. Write to localStorage (immediate fallback)
  localStorage.setItem('userProductCosts', JSON.stringify(productCosts));
  
  return { success: true };
};
```

### **2. React Component Integration**

#### **Data Loading Strategy**

```typescript
// ProductsPage.tsx - Load data with fallbacks
const loadCostData = async () => {
  try {
    // 1. Try user-state API first (multi-device)
    const serverCosts = await fetchUserProductCosts();
    if (Object.keys(serverCosts).length > 0) {
      setCostData(serverCosts);
      return;
    }
  } catch (error) {
    console.warn('User-state API unavailable, falling back to localStorage');
  }
  
  // 2. Fallback to localStorage
  const localCosts = localStorage.getItem('userProductCosts');
  if (localCosts) {
    setCostData(JSON.parse(localCosts));
  }
};
```

#### **Optimistic UI Updates**

```typescript
// CostEntryModal.tsx - Immediate feedback
const handleSave = async (costData: ProductCost) => {
  // 1. Immediate UI update
  setCostData(prev => ({ ...prev, [costData.platform_product_id]: costData }));
  
  // 2. Async persistence
  try {
    await updateUserProductCosts(costData);
    await updateProductCost(costData); // Backend API
  } catch (error) {
    // 3. Error handling with rollback
    setCostData(prev => {
      const newState = { ...prev };
      delete newState[costData.platform_product_id];
      return newState;
    });
    showError('Failed to save cost data');
  }
};
```

### **3. Error Handling & Resilience**

```typescript
// Robust API hooks with error boundaries
export const useUserProductCosts = () => {
  return useQuery({
    queryKey: ['user-state', 'product-costs'],
    queryFn: fetchUserProductCosts,
    retry: 2,
    staleTime: 5 * 60 * 1000, // 5 minutes
    onError: (error) => {
      console.warn('User-state API failed, using localStorage fallback');
      // Automatically falls back to localStorage in component
    }
  });
};
```

---

## 🗄️ Backend Implementation Guide

### **1. Database Schema Design**

#### **Migration Creation Pattern**

```typescript
// packages/api/migrations/YYYYMMDDHHMMSS_create_feature_table.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Always check if table exists first
  const hasTable = await knex.schema.hasTable('user_states');
  if (!hasTable) {
    await knex.schema.createTable('user_states', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('key').notNullable();
      table.jsonb('value').notNullable(); // Use JSONB for flexibility
      table.timestamps(true, true);
      
      // Unique constraint for user/key combinations
      table.unique(['user_id', 'key']);
    });
    
    // Index for performance
    await knex.schema.raw('CREATE INDEX idx_user_states_user_id_key ON user_states(user_id, key)');
  }
}
```

#### **Service Layer Pattern**

```typescript
// packages/api/src/services/user-state.service.ts
export class UserStateService {
  static async getUserState(userId: number, key: string): Promise<any> {
    const state = await db('user_states')
      .where({ user_id: userId, key })
      .first();

    if (!state) return null;

    // ✅ CRITICAL: Handle both JSON strings and JSONB objects
    if (typeof state.value === 'string') {
      try {
        return JSON.parse(state.value);
      } catch (error) {
        console.error('JSON parsing error:', error);
        return null;
      }
    }
    
    // Already an object (JSONB)
    return state.value;
  }

  static async setUserState(userId: number, key: string, value: any): Promise<void> {
    await db('user_states')
      .insert({
        user_id: userId,
        key,
        value, // PostgreSQL JSONB handles object storage
        updated_at: db.fn.now()
      })
      .onConflict(['user_id', 'key'])
      .merge({
        value, // Direct object storage - no JSON.stringify!
        updated_at: db.fn.now()
      });
  }
}
```

### **2. API Route Implementation**

#### **Authentication & Validation**

```typescript
// packages/api/src/routes/user-state.ts
router.get('/product-costs', async (req, res) => {
  try {
    // ✅ Always validate authentication first
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const productCosts = await UserStateService.getUserProductCosts(userId);
    res.json(productCosts || {}); // Always return object, never null
  } catch (error) {
    console.error('Error getting user product costs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/product-costs', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ✅ Validate request data
    const { productCosts } = req.body;
    if (!productCosts || typeof productCosts !== 'object') {
      return res.status(400).json({ error: 'Invalid product costs data' });
    }

    await UserStateService.setUserProductCosts(userId, productCosts);
    res.json({ success: true });
  } catch (error) {
    console.error('Error setting user product costs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

---

## 🧪 Testing Strategy

### **1. Frontend Unit Tests**

```typescript
// tests/unit/ui/api/user-state.api.test.ts
jest.mock('../../../../packages/ui/src/api/axiosConfig', () => {
  const mockAxiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
  };
  
  return {
    __esModule: true,
    axiosInstance: mockAxiosInstance,
  };
});

describe('UserState API - Authentication', () => {
  const mockAxiosInstance = (require('../../../../packages/ui/src/api/axiosConfig').axiosInstance as any);
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should use authenticated axiosInstance for GET requests', async () => {
    // Arrange
    const mockResponseData = { 'product-1': { purchase_price: 10 } };
    mockAxiosInstance.get.mockResolvedValue({ data: mockResponseData });

    // Act
    const result = await fetchUserProductCosts();

    // Assert
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/user-state/product-costs');
    expect(result).toEqual(mockResponseData);
  });
});
```

### **2. Backend Service Tests**

```typescript
// tests/unit/api/services/user-state.service.test.ts
jest.mock('api-src/db', () => {
  const mockDbInstance = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
  };
  
  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };
  
  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn
  };
});

describe('UserStateService', () => {
  const mockDbInstance = (require('api-src/db').default() as any);
  
  test('should handle JSON parsing errors gracefully', async () => {
    // Arrange
    mockDbInstance.first.mockResolvedValue({ 
      value: 'invalid-json-string' 
    });

    // Act
    const result = await UserStateService.getUserProductCosts(1);

    // Assert
    expect(result).toEqual({});
  });
});
```

### **3. Integration Testing Checklist**

```typescript
const integrationTestChecklist = [
  '✅ User can save cost data',
  '✅ Data persists on page refresh', 
  '✅ Data survives database restart',
  '✅ Multiple devices show same data',
  '✅ Offline mode uses localStorage',
  '✅ Online mode syncs to server',
  '✅ Error states handled gracefully',
  '✅ Performance: < 2s load time',
  '✅ Security: Authentication required',
  '✅ Data validation: Invalid inputs rejected'
];
```

---

## 🚨 Common Pitfalls & Solutions

### **Pitfall 1: Authentication 401 Errors**

**Problem:** API calls return 401 Unauthorized  
**Solution:** Always use `axiosInstance` from `axiosConfig.ts` not plain `axios`

### **Pitfall 2: JSON Parsing Errors**  

**Problem:** `"[object Object]" is not valid JSON`  
**Solution:** Check if value is string before parsing:

```typescript
// ✅ CORRECT
if (typeof value === 'string') {
  return JSON.parse(value);
}
return value; // Already object
```

### **Pitfall 3: Missing Database Tables**

**Problem:** `relation "user_states" does not exist`  
**Solution:**

1. Create migration: `npm run migrate:make create_user_states_table`
2. Run migration: `npm run migrate`
3. Verify: Check table exists in database

### **Pitfall 4: Data Not Persisting**

**Problem:** Data disappears on refresh  
**Solution:** Implement proper fallback strategy:

```typescript
// Load order: user-state API → localStorage → empty
```

### **Pitfall 5: Poor Performance**

**Problem:** Slow page loads with many API calls  
**Solution:**

- Use React Query for caching
- Implement optimistic updates
- Batch API calls when possible

---

## 🔧 Development Workflow

### **1. Feature Implementation Steps**

```bash
# 1. Create feature branch
git checkout -b feature/cost-data-persistence

# 2. Frontend implementation
#    - Create/update API files
#    - Implement React components
#    - Add unit tests

# 3. Backend implementation  
#    - Create database migration
#    - Implement service layer
#    - Add API routes
#    - Add unit tests

# 4. Run tests
npm test

# 5. Manual testing
#    - Test data persistence
#    - Test error scenarios
#    - Test performance

# 6. Create PR and deploy
./ship.sh "feat: cost data persistence" 866
```

### **2. Code Review Checklist**

```markdown
- [ ] Authentication implemented correctly
- [ ] Error handling for all API calls
- [ ] Proper data validation
- [ ] Unit tests cover edge cases
- [ ] Migration files included
- [ ] Performance considerations
- [ ] Security review completed
- [ ] Documentation updated
```

---

## 📈 Performance Optimization

### **Frontend Optimizations**

```typescript
// Use React Query for automatic caching
const { data: productCosts } = useUserProductCosts();

// Implement debouncing for rapid inputs
const debouncedSave = useDebounce(saveCostData, 500);

// Lazy loading for large datasets
const loadCosts = useCallback(async () => {
  // Implementation
}, []);
```

### **Backend Optimizations**

```sql
-- Ensure proper indexes
CREATE INDEX idx_user_states_user_id_key ON user_states(user_id, key);

-- Use JSONB for flexible schema
ALTER TABLE user_states ALTER COLUMN value TYPE JSONB USING value::JSONB;
```

---

## 🔒 Security Considerations

### **Authentication**

- All user-state endpoints require valid JWT token
- Use `axiosInstance` with built-in auth interceptors
- Implement proper CORS policies

### **Data Validation**

```typescript
// Validate all inputs
const validateCostData = (data: any) => {
  if (typeof data.purchase_price !== 'number' || data.purchase_price < 0) {
    throw new Error('Invalid purchase price');
  }
  // Additional validation...
};
```

### **Database Security**

- Use parameterized queries to prevent SQL injection
- Implement row-level security where appropriate
- Regular security audits of database access

---

## 🚀 Deployment Checklist

### **Pre-Deployment**

```bash
# 1. Run all tests
npm test

# 2. Build all packages
npm run build

# 3. Run migrations
npm run migrate

# 4. Verify database structure
docker-compose exec postgres psql -U sf_user -d synchroflow_db -c "\dt user_states"
```

### **Post-Deployment**

```bash
# 1. Monitor for errors
# 2. Verify data persistence
# 3. Check performance metrics
# 4. Validate multi-device sync
```

---

## 📚 Additional Resources

### **Recommended Reading**

- [React Query Documentation](https://tanstack.com/query/latest)
- [PostgreSQL JSONB Documentation](https://www.postgresql.org/docs/current/datatype-json.html)
- [Axios Interceptors Guide](https://axios-http.com/docs/interceptors)

### **Internal References**

- `CostEntryModal.tsx` - Complete implementation example
- `user-state.service.ts` - Backend service pattern
- `user-state.api.test.ts` - Testing pattern

---

## 🎯 Success Metrics

### **Technical Metrics**

- API response time < 200ms
- Data persistence success rate > 99.9%
- Error rate < 0.1%
- Test coverage > 90%

### **User Experience Metrics**

- Time to first meaningful paint < 2s
- Data save confirmation < 1s
- Offline functionality working
- Cross-device sync operational

---

## 🔄 Maintenance & Updates

### **Regular Checks**

- Monitor API error rates
- Check database performance
- Update dependencies quarterly
- Review security patches monthly

### **Breaking Changes**

When making breaking changes to the data schema:

1. Maintain backward compatibility for 2 release cycles
2. Use database migrations for schema changes
3. Update both frontend and backend simultaneously
4. Communicate changes to all developers

---

**Document Maintainer:** Development Team  
**Review Cycle:** Quarterly  
**Next Review:** 2026-02-26
