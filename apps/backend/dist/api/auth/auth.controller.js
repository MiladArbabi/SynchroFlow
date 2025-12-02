"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDevToken = exports.logoutUser = exports.refreshToken = exports.loginUser = exports.registerUser = void 0;
const db_1 = __importDefault(require("../../db"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const SALT_ROUNDS = 10; // Standard for bcrypt
const registerUser = async (req, res) => {
    const { email, password, firstName, lastName } = req.body;
    // --- Basic Validation ---
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    try {
        // --- Check if user already exists ---
        const existingUser = await (0, db_1.default)('users')
            .where({ email: email.toLowerCase() })
            .first();
        if (existingUser) {
            return res.status(409).json({ error: 'Email already in use.' }); // 409 Conflict
        }
        // --- Hash the password ---
        const passwordHash = await bcrypt_1.default.hash(password, SALT_ROUNDS);
        const authSecret = crypto_1.default.randomBytes(32).toString('hex'); // <-- ADD THIS LINE
        // --- Create a new shop for this user ---
        const [newShop] = await (0, db_1.default)('shops')
            .insert({
            name: `${firstName || email}'s Shop`,
            contact_email: email.toLowerCase(),
            auth_secret: authSecret,
            primary_erp_type: 'none',
            primary_ecomm_type: 'none'
        })
            .returning('id');
        // --- Save the new user ---
        const [newUser] = await (0, db_1.default)('users')
            .insert({
            email: email.toLowerCase(),
            password_hash: passwordHash,
            first_name: firstName,
            last_name: lastName,
            shop_id: newShop.id,
        })
            .returning('*');
        // --- Issue JWT (Copied from loginUser) ---
        const jwtSecret = process.env.JWT_SECRET;
        const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret;
        if (!jwtSecret || !jwtRefreshSecret)
            throw new Error('JWT secrets are not set.');
        // 1. Short-lived Access Token
        const accessToken = jsonwebtoken_1.default.sign({ userId: newUser.id }, jwtSecret, { expiresIn: '15m' });
        // 2. Long-lived Refresh Token
        const refreshToken = jsonwebtoken_1.default.sign({ userId: newUser.id }, jwtRefreshSecret, { expiresIn: '7d' });
        // Set cookie options
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        // 1. Omit the password hash for security
        const { password_hash, ...publicUser } = newUser;
        // 2. Respond with success (201) and the same payload as login
        res.status(201).json({
            accessToken: accessToken,
            user: publicUser
        });
        // --- [END NEW LOGIN LOGIC] ---
    }
    catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ error: 'Internal server error during registration.' });
    }
};
exports.registerUser = registerUser;
const loginUser = async (req, res) => {
    const { email, password } = req.body;
    // --- Basic Validation ---
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    try {
        // --- Find user by email (case-insensitive) ---
        const user = await (0, db_1.default)('users')
            .where({ email: email.toLowerCase() })
            .first(); // Select password_hash too
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }
        const isPasswordValid = await bcrypt_1.default.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }
        // --- Issue JWT ---
        const jwtSecret = process.env.JWT_SECRET;
        const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret; // Use separate secret if defined
        if (!jwtSecret || !jwtRefreshSecret)
            throw new Error('JWT secrets are not set.');
        // 1. Short-lived Access Token (sent in body)
        const accessToken = jsonwebtoken_1.default.sign({ userId: user.id }, jwtSecret, { expiresIn: '15m' }); // e.g., 15 minutes
        // 2. Long-lived Refresh Token (sent as HttpOnly cookie)
        const refreshToken = jsonwebtoken_1.default.sign({ userId: user.id }, jwtRefreshSecret, { expiresIn: '7d' }); // e.g., 7 days
        // Set cookie options
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true, // Crucial for security! JS can't access.
            secure: process.env.NODE_ENV === 'production', // Send only over HTTPS in production
            sameSite: 'strict', // Helps prevent CSRF
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds (must match token expiry)
        });
        // 1. Omit the password hash from the user object for security
        // (Assuming your User type from api-types doesn't have password_hash,
        // but the 'user' variable from the DB does)
        const { password_hash, ...publicUser } = user;
        // 2. Send both the token AND the user object in the response
        res.status(200).json({
            accessToken: accessToken,
            user: publicUser
        });
    }
    catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Internal server error during login.' });
    }
};
exports.loginUser = loginUser;
const refreshToken = async (req, res) => {
    // 1. Get refresh token from HttpOnly cookie
    const incomingRefreshToken = req.cookies.refreshToken;
    if (!incomingRefreshToken) {
        return res.status(401).json({ error: 'Unauthorized: No refresh token provided.' });
    }
    // 2. Verify the refresh token
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    if (!jwtRefreshSecret) {
        console.error('JWT Refresh Secret is not set!');
        return res.status(500).json({ error: 'Internal server error: JWT secret missing.' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(incomingRefreshToken, jwtRefreshSecret); // Verify & get payload
        const userId = decoded.userId;
        // TODO Optional: Add extra validation here if needed
        // (e.g., check if user still exists, check against a token denylist for logout)
        // 3. Issue a new *short-lived* access token
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret)
            throw new Error('JWT_SECRET is not set.');
        const newAccessToken = jsonwebtoken_1.default.sign({ userId: userId }, jwtSecret, { expiresIn: '15m' }); // New 15 min token
        // 4. Send the new access token in the response body
        res.status(200).json({ accessToken: newAccessToken });
    }
    catch (err) {
        console.error('Refresh Token Error:', err instanceof Error ? err.message : err);
        return res.status(403).json({ error: 'Forbidden: Invalid or expired refresh token.' }); // Token failed verification
    }
};
exports.refreshToken = refreshToken;
const logoutUser = (req, res) => {
    // Clear the refresh token cookie
    res.cookie('refreshToken', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        expires: new Date(0), // Set expiry date to the past
        maxAge: 0 // Explicitly set maxAge to 0
    });
    res.status(204).send(); // Send 204 No Content
};
exports.logoutUser = logoutUser;
const getDevToken = async (req, res) => {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Not available in production' });
    }
    try {
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            return res.status(500).json({ error: 'JWT_SECRET not configured' });
        }
        // Create a token for a default user (user ID 1)
        const token = jsonwebtoken_1.default.sign({ userId: 1 }, jwtSecret, { expiresIn: '24h' });
        res.json({
            token,
            message: 'Dev token generated for user ID 1. Use in Authorization header as: Bearer <token>'
        });
    }
    catch (error) {
        console.error('[AuthController] Error generating dev token:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
};
exports.getDevToken = getDevToken;
//# sourceMappingURL=auth.controller.js.map