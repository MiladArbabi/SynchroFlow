"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProductCostHandler = exports.upsertProductCostHandler = exports.getProductCostHandler = void 0;
const product_costs_service_1 = require("./product-costs.service");
const getProductCostHandler = async (req, res) => {
    try {
        const { platformProductId } = req.params;
        if (!platformProductId) {
            res.status(400).json({ error: 'platformProductId is required' });
            return;
        }
        const cost = await (0, product_costs_service_1.getProductCost)(platformProductId);
        if (!cost) {
            res.status(404).json({ error: 'Product cost not found' });
            return;
        }
        res.json(cost);
    }
    catch (error) {
        console.error('Error fetching product cost:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getProductCostHandler = getProductCostHandler;
const upsertProductCostHandler = async (req, res) => {
    try {
        const { platformProductId } = req.params;
        const { purchase_price, landed_cost_per_unit } = req.body;
        if (!platformProductId) {
            res.status(400).json({ error: 'platformProductId is required' });
            return;
        }
        if (typeof purchase_price !== 'number' || purchase_price < 0) {
            res.status(400).json({ error: 'Valid purchase_price is required' });
            return;
        }
        if (typeof landed_cost_per_unit !== 'number' || landed_cost_per_unit < 0) {
            res.status(400).json({ error: 'Valid landed_cost_per_unit is required' });
            return;
        }
        const cost = await (0, product_costs_service_1.upsertProductCost)(platformProductId, purchase_price, landed_cost_per_unit);
        res.json(cost);
    }
    catch (error) {
        console.error('Error upserting product cost:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.upsertProductCostHandler = upsertProductCostHandler;
const deleteProductCostHandler = async (req, res) => {
    try {
        const { platformProductId } = req.params;
        if (!platformProductId) {
            res.status(400).json({ error: 'platformProductId is required' });
            return;
        }
        const deleted = await (0, product_costs_service_1.deleteProductCost)(platformProductId);
        if (!deleted) {
            res.status(404).json({ error: 'Product cost not found' });
            return;
        }
        res.status(204).send();
    }
    catch (error) {
        console.error('Error deleting product cost:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.deleteProductCostHandler = deleteProductCostHandler;
