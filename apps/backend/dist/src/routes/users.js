"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// packages/api/src/routes/users.ts
const express_1 = require("express");
const router = (0, express_1.Router)();
// TODO: Implement user routes in future issues
router.get('/', (req, res) => {
    res.json({ message: 'Users route - to be implemented' });
});
exports.default = router;
