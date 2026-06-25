// apps/backend/src/api/pilot/pilot.routes.ts
// AUD-1023: Public endpoint — no auth required (pre-tenant pilot applications).
// Source of truth: pilot_applications table. Resend notification is secondary/non-blocking.
// Mirrors apps/backend/src/api/waitlist/waitlist.routes.ts pattern exactly.
import { Router } from 'express';
import { z } from 'zod';
import db from '@lasyncro/backend-core/db.js';
import { sendPilotApplicationNotification } from '../../services/email/email.service.js';

const router = Router();

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().min(1),
  storeUrl: z.string().min(1),
  country: z.string().min(1),
  ordersPerDay: z.string().min(1),
  skuCount: z.string().min(1),
  fulfillment: z.string().min(1),
  biggestIssue: z.string().min(1),
  usesStocky: z.string().min(1),
  currentTools: z.string().min(1),
  openToPaidPilot: z.string().min(1),
  contactMethod: z.string().min(1),
});

// POST /api/v1/pilot-applications — called by /pilot page via marketing Next.js proxy
router.post('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  const data = parsed.data;

  try {
    await db('pilot_applications')
      .insert({
        name: data.name,
        email: data.email,
        company: data.company,
        store_url: data.storeUrl,
        country: data.country,
        orders_per_day: data.ordersPerDay,
        sku_count: data.skuCount,
        fulfillment: data.fulfillment,
        biggest_issue: data.biggestIssue,
        uses_stocky: data.usesStocky,
        current_tools: data.currentTools,
        open_to_paid_pilot: data.openToPaidPilot,
        contact_method: data.contactMethod,
      })
      .onConflict('email')
      .ignore(); // Duplicate email — silently ignore, applicant may retry
  } catch (err) {
    console.error('[pilot] DB insert error:', err);
    return res.status(500).json({ error: 'Server error' });
  }

  // Non-blocking Resend notification — application already persisted above
  sendPilotApplicationNotification(data).catch((err) =>
    console.error('[pilot] Notification error (application already saved):', err)
  );

  return res.status(200).json({ success: true });
});

export default router;