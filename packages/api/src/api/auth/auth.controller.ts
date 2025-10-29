// packages/api/src/api/auth/auth.controller.ts
import { Request, Response } from 'express';
import db from 'api-db';
import bcrypt from 'bcrypt';
import { User } from 'api-types'; 
import jwt from 'jsonwebtoken';

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

    // --- Create a new shop for this user ---
    const [newShop] = await db('shops')
      .insert({
        name: `${firstName || email}'s Shop`, // Placeholder name
        // Add other shop defaults if needed
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
      .returning(['id', 'email', 'first_name', 'last_name', 'created_at', 'updated_at']); // Return safe fields

    // --- Respond with success ---
    res.status(201).json(newUser); // 201 Created

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
      return res.status(401).json({ error: 'Invalid email or password.' }); // 401 Unauthorized
    }

    // --- Verify password ---
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' }); // 401 Unauthorized
    }

    // --- Issue JWT ---
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET is not set.');

    const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '1d' }); // Token valid for 1 day

    res.status(200).json({ token });

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
};