// apps/backend/src/api/auth/auth.controller.ts
import { Request, Response } from 'express';
import db from '../../db';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { User } from 'api-types'; 
import jwt, { JwtPayload } from 'jsonwebtoken';
import { issueAuthTokens } from './token.service';

const SALT_ROUNDS = 10; // Standard for bcrypt

const hashRefreshToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

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

    // SINGLE AUTHORITY FOR TOKEN ISSUANCE — DO NOT DUPLICATE  
    const authUserId = newUser.id;
    const { accessToken, refreshToken } =
      await issueAuthTokens(authUserId);

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

    // SINGLE AUTHORITY FOR TOKEN ISSUANCE — DO NOT DUPLICATE
    const authUserId = user.id;
    const { accessToken, refreshToken } =
      await issueAuthTokens(authUserId);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
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
    return res.status(401).json({
      error: 'SESSION_EXPIRED',
      action: 'LOGOUT_REQUIRED',
    });
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

    const incomingHash = hashRefreshToken(incomingRefreshToken);
 
     const existingToken = await db('refresh_tokens')
       .where({ token_hash: incomingHash, revoked_at: null })
       .first();
 
     if (!existingToken) {
       return res.status(403).json({ error: 'Forbidden: Refresh token revoked or reused.' });
    }

    // Revoke old token
    await db('refresh_tokens')
      .where({ id: existingToken.id })
      .update({ revoked_at: new Date() });

    // 🔒 Invariant: user must still exist
    const userExists = await db('users')
      .where({ id: userId })
      .first();

    if (!userExists) {
      return res.status(401).json({
        error: 'Unauthorized: User no longer exists.'
      });
    }

    // SINGLE AUTHORITY FOR TOKEN ISSUANCE — DO NOT DUPLICATE
    const authUserId = userId;
    const { accessToken, refreshToken } =
      await issueAuthTokens(authUserId);

    // 4. Set rotated refresh token cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // 5. Return new access token
    res.status(200).json({ accessToken });

  } catch (err) {
    console.error('Refresh Token Error:', err instanceof Error ? err.message : err);

    // 🔒 Hard logout: clear refresh token cookie
    res.cookie('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: new Date(0),
      maxAge: 0,
    });

    return res.status(401).json({
      error: 'SESSION_EXPIRED',
      action: 'LOGOUT_REQUIRED',
    });
  }
};

export const logoutUser = (req: Request, res: Response) => {

  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    const hash = hashRefreshToken(refreshToken);
    db('refresh_tokens')
      .where({ token_hash: hash, revoked_at: null })
      .update({ revoked_at: new Date() })
      .catch(() => {});
  }

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