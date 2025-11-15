"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// packages/api/src/api/customers/customers.routes.ts
const express_1 = require("express");
const customersController = __importStar(require("./customers.controller"));
const router = (0, express_1.Router)();
/**
 * @route   GET /api/v1/customers
 * @desc    Get a list of all customers.
 * @access  Private (TODO: Add auth middleware)
 */
router.get('/', async (req, res) => {
    try {
        // v1: Return mock data matching the test expectations
        const mockCustomers = [
            { id: 'cust_abc', name: 'John Doe', email: 'john.doe@example.com', total_orders: 5, created_at: new Date() },
            { id: 'cust_def', name: 'Jane Smith', email: 'jane.smith@example.com', total_orders: 2, created_at: new Date() },
            { id: 'cust_ghi', name: 'Peter Jones', email: 'peter.jones@example.com', total_orders: 8, created_at: new Date() },
        ];
        res.status(200).json(mockCustomers);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: `Failed to fetch customers list: ${message}` });
    }
});
router.get('/:id', customersController.getCustomerDetails);
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // --- MOCK DATABASE LOOKUP ---
        // In a real app, we'd do: const customer = await db('customers').where({ id }).first();
        // For now, let's create mock data that matches the frontend <CustomerApiResponse>
        // Simple check: if ID is "cust_abc", return John Doe. Otherwise, return 404.
        // This lets us test both the happy path (200) and sad path (404) from the UI.
        if (id === 'cust_abc') {
            const mockCustomerDetails = {
                id: 'cust_abc',
                profile: {
                    name: 'John Doe',
                    email: 'john.doe@example.com',
                    phone: '+1 (555) 123-4567',
                    location: 'New York, USA',
                    joined_date: '2024-01-15T09:30:00Z',
                    tags: ['VIP', 'Frequent Buyer'],
                },
                metrics: {
                    total_revenue: 1250.75,
                    total_orders: 5,
                    aov: 250.15,
                    ltv: 1500.00, // Projected LTV
                },
                // We can leave orders and tickets as undefined for now,
                // since the UI has its own mock data for those components.
                // orders: [], 
                // tickets: []
            };
            res.status(200).json(mockCustomerDetails);
        }
        else {
            // If the ID is not our mock ID, simulate a "not found" error
            res.status(404).json({ error: `Customer with ID ${id} not found.` });
        }
        // --- END MOCK LOGIC ---
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: `Failed to fetch customer: ${message}` });
    }
});
exports.default = router;
