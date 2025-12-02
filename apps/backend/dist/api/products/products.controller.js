"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchProducts = void 0;
const products_service_1 = require("./products.service");
const fetchProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search;
        const result = await (0, products_service_1.getProducts)(page, limit, search);
        res.json(result);
    }
    catch (error) {
        console.error('Failed to fetch products:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
};
exports.fetchProducts = fetchProducts;
//# sourceMappingURL=products.controller.js.map