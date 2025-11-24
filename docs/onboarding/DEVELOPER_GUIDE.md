# Developer Onboarding Guide

## 🚀 First 30 Minutes: Get Coding

### Prerequisites Checklist
- [ ] Node.js 18+ installed
- [ ] Docker & Docker Compose installed  
- [ ] Git configured with SSH keys
- [ ] IDE with TypeScript, ESLint, Prettier

### Quick Start
```bash
git clone <repository>
cd LaSyncro
npm install
npm run dev:full
```

Expected Result: UI at http://localhost:5173, API at http://localhost:8080

### Your First Task
- Explore the running application
- Navigate to Products tab - see real Shopify data
- Check Orders tab - view order intelligence
- Test dark/light theme toggle

Make a simple change:
- Edit packages/ui/src/pages/ProductsPage.tsx
- Add a new table column for "Last Updated"
- See hot-reload in action

## 🏗️ Architecture Understanding

### Key Directories
```
packages/
├── ui/                 # React frontend
│   ├── src/
│   │   ├── components/ # Reusable UI components
│   │   ├── pages/      # Route-level components
│   │   ├── api/        # React Query hooks
│   │   └── contexts/   # React state management
├── api/                # Node.js backend
│   ├── src/
│   │   ├── api/        # Feature modules (orders, products, customers)
│   │   ├── services/   # Business logic
│   │   └── middleware/ # Auth and validation
└── shared/             # Common types and utilities
```

### Data Flow Pattern
```typescript
// 1. Frontend calls hook
const { products } = useProducts();

// 2. Hook calls API with auth
const response = await axios.get('/api/v1/products', {
  headers: { Authorization: `Bearer ${token}` }
});

// 3. API validates and calls service
const products = await productsService.getProducts();

// 4. Service queries database
const products = await db('shopify_products').where('shop_id', shopId);
```

## 🔧 Development Workflow

### Branch Strategy
```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes with tests
# Run tests locally
npm run test:e2e
npm test -w ui
npm test -w api

# Ship changes
./ship.sh "feat(scope): description"
```

### Testing Strategy
- E2E Tests: Critical user flows (Playwright)
- Unit Tests: Business logic (Vitest/Jest)
- Integration Tests: API endpoints (Supertest)
- Run All: npm run test:all

### Code Standards
- TypeScript: Strict mode enabled, no any types
- Naming: Descriptive names, consistent patterns
- Components: Functional components with hooks
- API: Service/Controller pattern with proper error handling

## 🐛 Common Issues & Solutions

### Database Issues
```bash
# Reset database
npm run db:reset -w api

# Check migrations
npm run migrate:status -w api

# Seed test data
npm run seed -w api
```

### Authentication Issues
- Check JWT token in localStorage
- Verify API server is running on port 8080
- Confirm proxy configuration in vite.config.ts

### Shopify Sync Issues
- Check Shopify store connection in integrations
- Verify OAuth scopes include read_products, read_orders
- Review sync status in database

## 📚 Learning Resources

### Must-Read Documents
- Blueprint - Product vision and architecture
- Product-360 Architecture - Technical deep dive
- API Documentation - Endpoint specifications

### Technology Stack Docs
- React Query - Data fetching
- Material-UI - Component library
- Knex.js - Database queries
- Playwright - E2E testing

## 🎯 Next Steps

### Week 1 Goals
- Complete first small PR (documentation or UI tweak)
- Understand data flow from UI to database
- Run and understand all test suites
- Deploy a change to development environment

### Month 1 Goals
- Own a feature from specification to deployment
- Contribute to core architecture decisions
- Mentor other new team members
- Participate in on-call rotation

## ❓ Getting Help

### Internal Resources
- Engineering Slack: #engineering channel
- Code Reviews: PR discussions and comments
- Pair Programming: Schedule with senior engineers

### External Resources
- Stack Overflow: Tag with [LaSyncro]
- GitHub Issues: Bug reports and feature requests

Welcome to the team! We're excited to build the future of commerce intelligence together.

# API Documentation

## Base URL
- Development: http://localhost:8080/api/v1
- Production: https://api.LaSyncro.com/api/v1

## Authentication
All endpoints require JWT Bearer token authentication.

```bash
curl -H "Authorization: Bearer <token>" https://api.LaSyncro.com/api/v1/products
```

## Core Endpoints

### Products API
- GET /products  
  Returns all products for authenticated shop  
  Includes inventory status and vendor information  
  Response: Product[]

```typescript
interface Product {
  id: number;
  shop_id: number;
  platform_product_id: string;
  title: string;
  vendor: string;
  product_type: string;
  status: string;
  total_inventory: number;
  created_at: string;
  updated_at: string;
}
```

### Orders API
- GET /orders  
  Returns all orders with financial and fulfillment status  
  PCD compliant customer data handling  
  Response: Order[]

- GET /orders/:id  
  Complete order details for Order360 view  
  Profitability calculations and customer context  
  Response: OrderDetails

### Customers API
- GET /customers  
  Customer list with basic metrics (Foundation ready)  
  Response: Customer[]

## Error Handling

### Standard Error Response
```typescript
{
  "error": "Descriptive error message",
  "code": "ERROR_CODE",
  "details": {} // Additional context
}
```

### Common Status Codes
- 200 - Success
- 400 - Bad Request (validation errors)
- 401 - Unauthorized (missing/invalid token)
- 404 - Resource not found
- 500 - Internal server error

## Rate Limiting
- Free Tier: 100 requests/minute
- Paid Tiers: 1000 requests/minute
- Headers: X-RateLimit-Limit, X-RateLimit-Remaining

## Webhooks (Coming Soon)
- order.created - New order placement
- product.updated - Inventory changes
- customer.updated - Customer profile changes

# Production Deployment Guide

## Infrastructure Overview

### Current Stack
- **Frontend**: Vercel (auto-deploys from main)
- **Backend**: Fly.io (container-based deployment)
- **Database**: PostgreSQL (managed instance)
- **Cache**: Redis (managed instance)
- **CDN**: Cloudflare (DNS and caching)

### Environment Variables
```bash
# API Server
DATABASE_URL=postgresql://...
JWT_SECRET=...
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
REDIS_URL=...

# Frontend
VITE_API_BASE_URL=https://api.LaSyncro.com
VITE_APP_VERSION=6.0.0
```

## Deployment Process

### Frontend (Vercel)
```bash
# Automatic on main branch merge
git checkout main
git pull origin main
# Vercel automatically builds and deploys
```

### Backend (Fly.io)
```bash
# Deploy API
cd packages/api
fly deploy

# Check deployment status
fly status
fly logs
```

### Database Migrations
```bash
# Run migrations on deploy
cd packages/api
npm run migrate

# Rollback if needed  
npm run migrate:rollback
```

## Monitoring & Observability

### Key Metrics
- API Response Times: < 200ms p95
- Error Rate: < 1%
- Database Connections: < 80% utilization
- Memory Usage: < 70% of allocation

### Alerting Rules
- P1: API 5xx errors > 5%
- P2: Database connection pool > 90%
- P3: Response times > 500ms p95

### Logging
- Structured JSON logs for all API requests
- Error tracking with Sentry
- Performance monitoring with DataDog

## Disaster Recovery

### Database Backups
- Automated: Daily snapshots retained for 30 days
- Point-in-Time: Continuous WAL archiving
- Recovery: < 15 minutes RTO

### Rollback Procedures
```bash
# Frontend rollback
vercel --prod --rollback

# Backend rollback  
fly deploy --image <previous-hash>

# Database rollback
npm run migrate:rollback -w api
```

## Security Checklist

### Pre-Deployment
- Security scan on dependencies
- Environment variables validated
- Database migrations reviewed
- API endpoints tested with authentication

### Post-Deployment
- Health checks passing
- SSL certificates valid
- Rate limiting enabled
- Error tracking operational

## Scaling Considerations

### Current Limits
- API: 10 concurrent instances
- Database: 100 connections
- Redis: 256MB memory

### Scaling Triggers
- API: CPU > 70% for 5 minutes
- Database: Connection pool > 80%
- Cache: Memory usage > 85%

Maintained by: DevOps Team  
Last Updated: November 24, 2025

# LaSyncro Documentation

## 🎯 Start Here

### For New Team Members
1. [Developer Onboarding Guide](./onboarding/DEVELOPER_GUIDE.md) - Get coding in 30 minutes
2. [Architecture Overview](./blueprint/BLUEPRINT.md) - Understand our vision and stack
3. [Product-360 Deep Dive](./product-360/ARCHITECTURE.md) - Technical implementation details

### For Product Managers
1. [Product Roadmap](../ROADMAP.md) - Current priorities and future plans
2. [Feature Specification Template](./templates/FEATURE_SPEC.md) - Standard for new features
3. [User Journey Maps](./product/USER_JOURNEYS.md) - Customer experience flows

### For Stakeholders
1. [Business Overview](./business/OVERVIEW.md) - Market position and strategy
2. [Technical Architecture](./technical/ARCHITECTURE.md) - System design and capabilities
3. [Competitive Analysis](./market/COMPETITIVE_LANDSCAPE.md) - Market differentiation

## 📚 Core Documentation

### Technical
- [API Documentation](./api/OVERVIEW.md) - Endpoint specifications and examples
- [Database Schema](./technical/DATABASE_SCHEMA.md) - Data model and relationships
- [Deployment Guide](./deployment/PRODUCTION_SETUP.md) - Production infrastructure
- [Testing Strategy](./technical/TESTING_STRATEGY.md) - Quality assurance approach

### Product
- [User Personas](./product/USER_PERSONAS.md) - Target customer profiles
- [Feature Matrix](./product/FEATURE_MATRIX.md) - Capabilities by plan tier
- [UX Guidelines](./product/UX_GUIDELINES.md) - Design system and patterns

### Business
- [GTM Strategy](./business/GTM_STRATEGY.md) - Marketing and sales approach
- [Pricing Model](./business/PRICING_STRATEGY.md) - Revenue model and tiers
- [Success Metrics](./business/SUCCESS_METRICS.md) - KPIs and tracking

## 🔄 Living Documents

### Recently Updated
- **Product-360 Architecture** - Complete technical implementation (Today)
- **Developer Onboarding** - Streamlined setup process (Today)  
- **API Documentation** - Current endpoint specifications (Today)
- **Production Deployment** - Infrastructure and procedures (Today)

### Needs Review
- [ ] Database Performance Guidelines
- [ ] Security Policy Updates
- [ ] Customer Support Playbook

## 🤝 Contributing to Docs

### Documentation Standards
- Use Markdown with consistent headers
- Include code examples where relevant
- Link to related documents
- Keep information current and accurate

### Update Process
1. Create branch: `git checkout -b docs/update-topic`
2. Make changes with clear commit messages
3. Submit PR for review
4. Merge after approval

## ❓ Getting Help
- **Technical Questions**: #engineering Slack channel
- **Product Questions**: #product Slack channel  
- **Documentation Issues**: Create GitHub issue with label `documentation`
- **Urgent Matters**: @tech-leads in relevant channels

---

**Documentation Version: 6.0**  
**Last Comprehensive Review: November 24, 2025**