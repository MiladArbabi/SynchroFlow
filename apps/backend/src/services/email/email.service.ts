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