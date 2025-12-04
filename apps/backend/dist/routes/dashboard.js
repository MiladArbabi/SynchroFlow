"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// apps/backend/src/routes/dashboard.ts
const express_1 = require("express");
const router = (0, express_1.Router)();
// TODO: Implement dashboard routes in future issues
router.get('/', (req, res) => {
    res.json({ message: 'Dashboard route - to be implemented' });
});
exports.default = router;
//# sourceMappingURL=dashboard.js.map