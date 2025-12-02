"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    if (token == null) {
        return res.status(401).json({ error: 'Unauthorized: No token provided.' }); // No token
    }
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        console.error('JWT_SECRET is not set!');
        return res.status(500).json({ error: 'Internal server error: JWT secret missing.' });
    }
    jsonwebtoken_1.default.verify(token, jwtSecret, (err, user) => {
        if (err) {
            console.error('JWT Verification Error:', err.message);
            return res.status(403).json({ error: 'Forbidden: Invalid token.' }); // Token is invalid or expired
        }
        // Attach the decoded payload (which contains userId) to the request object
        req.user = user;
        next(); // Proceed to the next middleware or route handler
    });
};
exports.authenticateToken = authenticateToken;
//# sourceMappingURL=auth.middleware.js.map