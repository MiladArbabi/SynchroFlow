// packages/api/src/api/auth/auth.controller.ts
import { Request, Response } from 'express';
import db from 'api-db';
import bcrypt from 'bcrypt';
import { User } from 'api-types'; // Assuming types.ts defines User

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

    // --- Save the new user ---
    const [newUser] = await db<User>('users')
      .insert({
        email: email.toLowerCase(),
        password_hash: passwordHash,
        first_name: firstName, // Will be null if not provided
        last_name: lastName,   // Will be null if not provided
      })
      .returning(['id', 'email', 'first_name', 'last_name', 'created_at', 'updated_at']); // Return safe fields

    // --- Respond with success ---
    res.status(201).json(newUser); // 201 Created

  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
};