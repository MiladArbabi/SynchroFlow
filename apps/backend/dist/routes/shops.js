"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// apps/backend/src/routes/shops.ts
const express_1 = require("express");
const router = (0, express_1.Router)();
// TODO: Implement shop routes in future issues
router.get('/', (req, res) => {
    res.json({ message: 'Shops route - to be implemented' });
});
exports.default = router;
//# sourceMappingURL=shops.js.map