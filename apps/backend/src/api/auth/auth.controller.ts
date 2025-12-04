// apps/backend/src/api/auth/auth.controller.ts
import { Request, Response } from 'express';
import db from '../../db';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { User } from 'api-types'; 
import jwt, { JwtPayload } from 'jsonwebtoken';

const SALT_ROUNDS = 10; // Standard for bcrypt

export const registerUser = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body;

  // --- Basic Validation ---
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // --- Check if user already exists ---
    const existingUser = await db<User>('users')
      .where({ email: email.toLowerCase() })
      .first();
    if (existingUser) {
      return res.status(409).json({ error: 'Email already in use.' }); // 409 Conflict
    }

    // --- Hash the password ---
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const authSecret = crypto.randomBytes(32).toString('hex'); // <-- ADD THIS LINE
    
    // --- Create a new shop for this user ---
    const [newShop] = await db('shops')
      .insert({
        name: `${firstName || email}'s Shop`,
        contact_email: email.toLowerCase(),
        auth_secret: authSecret,
        primary_erp_type: 'none', 
  	  	primary_ecomm_type: 'none'
      })
      .returning('id');

    // --- Save the new user ---
    const [newUser] = await db<User>('users')
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
    if (!jwtSecret || !jwtRefreshSecret) throw new Error('JWT secrets are not set.');

    // 1. Short-lived Access Token
    const accessToken = jwt.sign({ userId: newUser.id }, jwtSecret, { expiresIn: '15m' });

    // 2. Long-lived Refresh Token
    const refreshToken = jwt.sign({ userId: newUser.id }, jwtRefreshSecret, { expiresIn: '7d' });

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

  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
};

export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // --- Basic Validation ---
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // --- Find user by email (case-insensitive) ---
    const user = await db<User>('users')
      .where({ email: email.toLowerCase() })
      .first(); // Select password_hash too

    if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // --- Issue JWT ---
    const jwtSecret = process.env.JWT_SECRET;
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret; // Use separate secret if defined
    if (!jwtSecret || !jwtRefreshSecret) throw new Error('JWT secrets are not set.');

    // 1. Short-lived Access Token (sent in body)
    const accessToken = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '15m' }); // e.g., 15 minutes

    // 2. Long-lived Refresh Token (sent as HttpOnly cookie)
    const refreshToken = jwt.sign({ userId: user.id }, jwtRefreshSecret, { expiresIn: '7d' }); // e.g., 7 days

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

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
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
    const decoded = jwt.verify(incomingRefreshToken, jwtRefreshSecret) as JwtPayload; // Verify & get payload
    const userId = decoded.userId;

    // TODO Optional: Add extra validation here if needed
    // (e.g., check if user still exists, check against a token denylist for logout)

    // 3. Issue a new *short-lived* access token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET is not set.');

    const newAccessToken = jwt.sign({ userId: userId }, jwtSecret, { expiresIn: '15m' }); // New 15 min token

    // 4. Send the new access token in the response body
    res.status(200).json({ accessToken: newAccessToken });

  } catch (err) {
    console.error('Refresh Token Error:', err instanceof Error ? err.message : err);
    return res.status(403).json({ error: 'Forbidden: Invalid or expired refresh token.' }); // Token failed verification
  }
};

export const logoutUser = (req: Request, res: Response) => {
  // Clear the refresh token cookie
  res.cookie('refreshToken', '', { // Set value to empty string
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0), // Set expiry date to the past
    maxAge: 0 // Explicitly set maxAge to 0
  });
  res.status(204).send(); // Send 204 No Content
};

export const getDevToken = async (req: Request, res: Response) => {
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
    const token = jwt.sign({ userId: 1 }, jwtSecret, { expiresIn: '24h' });
    
    res.json({ 
      token,
      message: 'Dev token generated for user ID 1. Use in Authorization header as: Bearer <token>'
    });
  } catch (error) {
    console.error('[AuthController] Error generating dev token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
};