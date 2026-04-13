// apps/backend/src/services/email/email.service.ts
import { Resend } from 'resend';

/**
 * EMAIL SERVICE (WM-31)
 * ---------------------
 * Thin wrapper around Resend for transactional email delivery.
 * All email templates live here — one place to update copy/styling.
 *
 * Requires env vars:
 *   RESEND_API_KEY     — Resend API key
 *   RESEND_FROM_EMAIL  — verified sender address
 */

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL ?? 'noreply@lasyncro.com';

export interface SendOperatorInviteParams {
  toEmail: string;
  firstName: string;
  temporaryPassword: string;
  invitedByName: string;
  shopName: string;
  role: string;
}

/**
 * sendOperatorInviteEmail
 * -----------------------
 * Sends credentials + onboarding instructions to a newly created operator.
 * Non-fatal: caller logs failure but does not abort user creation.
 */
export async function sendOperatorInviteEmail(params: SendOperatorInviteParams): Promise<void> {
  const { toEmail, firstName, temporaryPassword, invitedByName, shopName, role } = params;

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `You've been added to ${shopName} on LaSyncro`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin-bottom: 8px;">Welcome to LaSyncro</h2>
        <p style="color: #555;">Hi ${firstName},</p>
        <p style="color: #555;">
          <strong>${invitedByName}</strong> has added you to <strong>${shopName}</strong>
          as an <strong>${role}</strong>.
        </p>

        <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 8px; font-size: 13px; color: #888;">YOUR CREDENTIALS</p>
          <p style="margin: 0 0 4px;"><strong>Email:</strong> ${toEmail}</p>
          <p style="margin: 0;"><strong>Temporary password:</strong> ${temporaryPassword}</p>
        </div>

        <p style="color: #555;">
          Download the LaSyncro app and log in with the credentials above.
          You will be prompted to change your password on first login.
        </p>

        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
          If you were not expecting this invitation, please ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('[EMAIL] sendOperatorInviteEmail failed:', error);
    throw new Error(`EMAIL_DELIVERY_FAILED: ${error.message}`);
  }

  console.info('[EMAIL] Operator invite sent', { toEmail, shopName, role });
}

export interface SendTrialReminderParams {
  toEmail: string;
  firstName: string;
  daysLeft: number;
  trialEndsAt: Date;
}

/**
 * sendTrialReminderEmail
 * ----------------------
 * Sent at D-3 and D-1 before Growth trial expires.
 * Non-fatal: caller logs failure and continues.
 */
export async function sendTrialReminderEmail(params: SendTrialReminderParams): Promise<void> {
  const { toEmail, firstName, daysLeft, trialEndsAt } = params;
  const expiryDate = trialEndsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `Your LaSyncro Growth trial ends in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin-bottom: 8px;">Your trial ends soon</h2>
        <p style="color: #555;">Hi ${firstName},</p>
        <p style="color: #555;">
          Your free Growth trial expires on <strong>${expiryDate}</strong> — that's ${daysLeft} day${daysLeft > 1 ? 's' : ''} away.
        </p>
        <p style="color: #555;">
          After expiry your account will move to the Starter plan and you'll lose access to
          Cash Flow, LTV, Demand forecasting, and Specter intelligence.
        </p>
        <a href="https://app.lasyncro.com/settings/billing" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#000;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">
          Upgrade to Growth
        </a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
          LaSyncro · Operational intelligence for growing merchants
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('[EMAIL] sendTrialReminderEmail failed:', error);
    throw new Error(`EMAIL_DELIVERY_FAILED: ${error.message}`);
  }

  console.info('[EMAIL] Trial reminder sent', { toEmail, daysLeft });
}

export interface SendTrialExpiryParams {
  toEmail: string;
  firstName: string;
}

/**
 * sendTrialExpiryEmail
 * --------------------
 * Sent immediately after a shop is downgraded from Growth trial to Starter.
 * Non-fatal: caller logs failure and continues.
 */
export async function sendTrialExpiryEmail(params: SendTrialExpiryParams): Promise<void> {
  const { toEmail, firstName } = params;

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Your LaSyncro Growth trial has ended',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin-bottom: 8px;">Your Growth trial has ended</h2>
        <p style="color: #555;">Hi ${firstName},</p>
        <p style="color: #555;">
          Your 14-day Growth trial has expired. Your account is now on the Starter plan.
        </p>
        <p style="color: #555;">
          Upgrade to Growth to restore access to Cash Flow, LTV, Demand forecasting,
          and Specter — intelligence that pays for itself in a single prevented stockout.
        </p>
        <a href="https://app.lasyncro.com/settings/billing" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#000;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">
          Upgrade to Growth — $179/mo
        </a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
          LaSyncro · Operational intelligence for growing merchants
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('[EMAIL] sendTrialExpiryEmail failed:', error);
    throw new Error(`EMAIL_DELIVERY_FAILED: ${error.message}`);
  }

  console.info('[EMAIL] Trial expiry email sent', { toEmail });
}