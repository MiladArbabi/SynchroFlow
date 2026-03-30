/**
 * CENTRAL ENCRYPTION SERVICE
 *
 * Purpose:
 * - Single entry point for all encryption/decryption
 * - Prevents unsafe CryptoJS usage across codebase
 *
 * CURRENT: wraps existing CryptoJS (legacy-compatible)
 * NEXT: replace internals with AES-256-GCM
 */

/**
 * MIGRATION STATUS
 *
 * - Supports BOTH:
 *   1. Legacy CryptoJS (string)
 *   2. New AES-256-GCM (JSON payload)
 *
 * - Safe rollout enabled
 *
 * NEXT:
 * - Re-encrypt legacy records progressively
 * - Remove fallback after migration complete
 */

import crypto from 'crypto';

/**
 * ENCRYPTED PAYLOAD STRUCTURE (FORWARD COMPATIBILITY)
 *
 * Current: returns raw string (legacy)
 * Future: JSON string with metadata:
 * {
 *   ciphertext: string,
 *   iv: string,
 *   auth_tag: string,
 *   key_version: string
 * }
 *
 * This enables safe migration to AES-GCM without breaking storage schema.
 */
type EncryptedPayload = string;

function getKey(): string {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error('[ENCRYPTION_SERVICE] ENCRYPTION_KEY missing');
  }

  // SECURITY: Enforce minimum key length (prevents weak secrets)
  if (key.length < 32) {
    throw new Error(
      '[ENCRYPTION_SERVICE] ENCRYPTION_KEY too short (min 32 chars required)'
    );
  }

  return key;
}

export function encrypt(data: string): EncryptedPayload {
  const key = crypto.createHash('sha256').update(getKey()).digest(); // derive 32-byte key
  const iv = crypto.randomBytes(12); // GCM standard IV size

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // STRUCTURED PAYLOAD
  const payload = {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    auth_tag: authTag.toString('base64'),
    key_version: 'v1', // future rotation support
  };

  return JSON.stringify(payload);
}

export function decrypt(encrypted: EncryptedPayload, context: string): string {

// SECURITY: restrict who can decrypt sensitive tokens
const ALLOWED_CONTEXTS = [
  'sync.worker',
  'order-identity-guard',
  'shopify.dev', // dev-only (already guarded by NODE_ENV)
];

if (!ALLOWED_CONTEXTS.includes(context)) {
  throw new Error(`[ENCRYPTION_SERVICE] Unauthorized decrypt context: ${context}`);
}

// STEP 1: Try new AES-256-GCM format
try {
  let parsed: any;

  try {
    parsed = JSON.parse(encrypted);
  } catch {
    throw new Error('NOT_JSON');
  }

  const { ciphertext, iv, auth_tag } = parsed;

  if (!ciphertext || !iv || !auth_tag) {
    throw new Error('INVALID_STRUCTURE');
  }

  const key = crypto.createHash('sha256').update(getKey()).digest();

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  );

  decipher.setAuthTag(Buffer.from(auth_tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);

        return decrypted.toString('utf8');
    } catch (err: any) {
        // FALLBACK: legacy CryptoJS format
    }

    // STEP 2: Legacy fallback (CryptoJS-compatible)
    try {
        const key = getKey();

        // Lazy require to avoid reintroducing global usage
        const CryptoJS = require('crypto-js');

        const result = CryptoJS.AES.decrypt(encrypted, key).toString(CryptoJS.enc.Utf8);

    if (!result || result.trim().length === 0) {
        throw new Error('EMPTY_RESULT');
    }

        return result;
    } catch {
        throw new Error('[ENCRYPTION_SERVICE] Decryption failed (unknown format, tampering, or wrong key)');
    }
}