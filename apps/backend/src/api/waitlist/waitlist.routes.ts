// apps/backend/src/api/waitlist/waitlist.routes.ts
// Public endpoint — no auth required (pre-registration signups).
// Source of truth: waitlist_signups table. Resend email is secondary/non-blocking.
import { Router } from 'express';
import { z } from 'zod';
import db from '@lasyncro/backend-core/db.js';

const router = Router();

const schema = z.object({
  email: z.string().email(),
  store: z.string().optional(),
  source: z.string().optional(),
});

// POST /api/v1/waitlist — called by landing page and checklist forms via marketing Next.js proxy
router.post('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const { email, store, source } = parsed.data;

  try {
    await db('waitlist_signups')
      .insert({
        email,
        store_url: store ?? null,
        source: source ?? 'landing_page',
      })
      .onConflict('email')
      .ignore(); // Duplicate email — silently ignore, user may retry
  } catch (err) {
    console.error('[waitlist] DB insert error:', err);
    return res.status(500).json({ error: 'Server error' });
  }

  // Non-blocking Resend notification — signup already persisted above
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'LaSyncro Waitlist <waitlist@lasyncro.com>',
        to: ['contact@lasyncro.com'],
        subject: `New waitlist signup — ${store ?? 'no store'}`,
        html: `<p><b>Email:</b> ${email}</p><p><b>Store:</b> ${store ?? '—'}</p><p><b>Source:</b> ${source ?? 'landing_page'}</p>`,
      }),
    }).catch(err => console.error('[waitlist] Resend error (signup already saved):', err));
  }

  return res.status(200).json({ success: true });
});

export default router;