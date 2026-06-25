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

// Shared branded email wrapper — LaSyncro light-mode template
// Logo: logo-light.png (light background compatible)
const emailHtml = (content: string) => `
  <div style="background:#FAFAF8;padding:40px 0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E8E6E0;">
      <div style="padding:24px 32px;border-bottom:1px solid #E8E6E0;">
        <img src="https://www.lasyncro.com/logo-light.png" alt="LaSyncro" style="height:32px;width:auto;" />
      </div>
      <div style="padding:32px;">
        ${content}
      </div>
      <div style="padding:16px 32px;background:#F3F2EF;border-top:1px solid #E8E6E0;">
        <p style="margin:0;font-size:12px;color:#9CA3AF;">LaSyncro · Operational intelligence for growing merchants</p>
      </div>
    </div>
  </div>
`;

export interface SendOperatorInviteParams {
  toEmail: string;
  firstName: string;
  temporaryPassword: string;
  invitedByName: string;
  shopName: string;
  role: string;
}

export interface SendPasswordResetEmailParams {
  toEmail: string;
  firstName: string;
  resetToken: string;
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

export interface SendSyncAcknowledgementParams {
  toEmail: string;
  firstName: string;
}

/**
 * sendSyncAcknowledgementEmail
 * ----------------------------
 * Sent immediately when merchant enters a custom email in SyncAnimationPage.
 * Sets expectation + explains Morning Brief while they wait.
 * Only sent when merchant specifies a custom email (not their registered one).
 */
export async function sendSyncAcknowledgementEmail(params: SendSyncAcknowledgementParams): Promise<void> {
  const { toEmail, firstName } = params;

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'LaSyncro is reading your store — we\'ll email you when it\'s ready',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin-bottom: 8px;">We're on it.</h2>
        <p style="color: #555;">Hi ${firstName || 'there'},</p>
        <p style="color: #555;">
          LaSyncro is reading your orders, products, and fulfilment history right now.
          We'll send you another email the moment your Morning Brief is ready.
        </p>
        <h3 style="margin-top: 24px; margin-bottom: 8px; color: #111;">What to expect when you return</h3>
        <p style="color: #555;">
          Your Morning Brief is a ranked list of what needs your attention today —
          stock risks, late orders, and revenue signals — prioritised by commercial impact.
          It's built from your actual data, not generic advice.
        </p>
        <p style="color: #555;">
          Most stores are ready within a few minutes. You can close this tab — your data will be waiting.
        </p>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
          LaSyncro · Operational intelligence for growing merchants
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('[EMAIL] sendSyncAcknowledgementEmail failed:', error);
    throw new Error(`EMAIL_DELIVERY_FAILED: ${error.message}`);
  }

  console.info('[EMAIL] Sync acknowledgement email sent', { toEmail });
}

export interface SendSyncCompletedParams {
  toEmail: string;
  firstName: string;
}

/**
 * sendSyncCompletedEmail
 * ----------------------
 * Sent from FT0 completion handler when sync actually finishes.
 * Sent to sync_notify_email if set, otherwise registered user email.
 * Non-fatal — never blocks lifecycle transition.
 */
export async function sendSyncCompletedEmail(params: SendSyncCompletedParams): Promise<void> {
  const { toEmail, firstName } = params;
  const appUrl = process.env.FRONTEND_URL ?? 'https://app.lasyncro.com';

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Your operation is ready — here\'s what we found',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin-bottom: 8px;">Your Morning Brief is ready.</h2>
        <p style="color: #555;">Hi ${firstName || 'there'},</p>
        <p style="color: #555;">
          LaSyncro has finished reading your store. We've ranked what needs
          your attention today by commercial impact — stock risks, delivery issues,
          and revenue signals specific to your operation.
        </p>
        <a href="${appUrl}"
           style="display:inline-block;margin-top:16px;padding:12px 24px;background:#FF6B2B;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">
          View your Morning Brief
        </a>
        <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
          LaSyncro · Operational intelligence for growing merchants
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('[EMAIL] sendSyncCompletedEmail failed:', error);
    throw new Error(`EMAIL_DELIVERY_FAILED: ${error.message}`);
  }

  console.info('[EMAIL] Sync completed email sent', { toEmail });
}

export interface SendVerificationEmailParams {
  toEmail: string;
  firstName: string;
  verificationToken: string;
}

/**
 * sendVerificationEmail
 * ---------------------
 * AUTH-007: Sent immediately after email/password registration.
 * Link expires in 30 minutes — matches target design A5 copy.
 * Non-fatal: caller logs failure but does not abort registration.
 */
export async function sendVerificationEmail(params: SendVerificationEmailParams): Promise<void> {
  const { toEmail, firstName, verificationToken } = params;
  const appUrl = process.env.FRONTEND_URL ?? 'https://app.lasyncro.com';
  const verifyUrl = `${appUrl}/verify-email?token=${verificationToken}`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Verify your LaSyncro email address',
    html: emailHtml(`
      <h2 style="margin:0 0 8px;color:#0F0E0D;font-size:22px;font-weight:700;">Verify your email address</h2>
      <p style="color:#6B7280;margin:0 0 8px;">Hi ${firstName || 'there'},</p>
      <p style="color:#6B7280;margin:0 0 24px;">Click the button below to verify your email. This link expires in 30 minutes.</p>
      <a href="${verifyUrl}"
         style="display:inline-block;padding:12px 24px;background:#FF6B2B;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Verify email address
      </a>
      <p style="margin:24px 0 0;color:#9CA3AF;font-size:13px;">
        Or copy this link:<br/>
        <a href="${verifyUrl}" style="color:#FF6B2B;word-break:break-all;">${verifyUrl}</a>
      </p>
      <p style="color:#9CA3AF;font-size:12px;margin:16px 0 0;">If you didn't create a LaSyncro account, you can safely ignore this email.</p>
    `),
  });

  if (error) {
    console.error('[EMAIL] sendVerificationEmail failed:', error);
    throw new Error(`EMAIL_DELIVERY_FAILED: ${error.message}`);
  }

  console.info('[EMAIL] Verification email sent', { toEmail });
}

/**
 * sendPasswordResetEmail
 * ----------------------
 * Sent when user requests password reset via /forgot-password.
 * Link expires in 30 minutes — matches UI copy in ForgotPasswordPage.
 * Non-fatal: caller logs failure but does not expose user existence.
 */
export async function sendPasswordResetEmail(params: SendPasswordResetEmailParams): Promise<void> {
  const { toEmail, firstName, resetToken } = params;
  const appUrl = process.env.FRONTEND_URL ?? 'https://app.lasyncro.com';
  const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Reset your LaSyncro password',
    html: emailHtml(`
      <h2 style="margin:0 0 8px;color:#0F0E0D;font-size:22px;font-weight:700;">Reset your password</h2>
      <p style="color:#6B7280;margin:0 0 8px;">Hi ${firstName || 'there'},</p>
      <p style="color:#6B7280;margin:0 0 24px;">Click the button below to reset your password. This link expires in 30 minutes.</p>
      <a href="${resetUrl}"
         style="display:inline-block;padding:12px 24px;background:#FF6B2B;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Reset password
      </a>
      <p style="margin:24px 0 0;color:#9CA3AF;font-size:13px;">
        Or copy this link:<br/>
        <a href="${resetUrl}" style="color:#FF6B2B;word-break:break-all;">${resetUrl}</a>
      </p>
      <p style="color:#9CA3AF;font-size:12px;margin:16px 0 0;">If you didn't request a password reset, you can safely ignore this email.</p>
    `),
  });

  if (error) {
    console.error('[EMAIL] sendPasswordResetEmail failed:', error);
    throw new Error(`EMAIL_DELIVERY_FAILED: ${error.message}`);
  }

  console.info('[EMAIL] Password reset email sent', { toEmail });
}

export interface SendPilotApplicationNotificationParams {
  name: string;
  email: string;
  company: string;
  storeUrl: string;
  country: string;
  ordersPerDay: string;
  skuCount: string;
  fulfillment: string;
  biggestIssue: string;
  usesStocky: string;
  currentTools: string;
  openToPaidPilot: string;
  contactMethod: string;
}

/**
 * sendPilotApplicationNotification
 * ---------------------------------
 * AUD-1023: Notifies the team when a new 5-Merchant Warehouse Accuracy Pilot
 * application is submitted via /pilot. Mirrors the waitlist notification pattern —
 * application is already persisted to pilot_applications before this is called.
 * Non-fatal: caller logs failure but does not block the application response.
 */
export async function sendPilotApplicationNotification(params: SendPilotApplicationNotificationParams): Promise<void> {
  const {
    name, email, company, storeUrl, country, ordersPerDay, skuCount,
    fulfillment, biggestIssue, usesStocky, currentTools, openToPaidPilot, contactMethod,
  } = params;

  const { error } = await resend.emails.send({
    from: FROM,
    to: ['contact@lasyncro.com'],
    subject: `New pilot application — ${company}`,
    html: emailHtml(`
      <h2 style="margin:0 0 16px;color:#0F0E0D;font-size:20px;font-weight:700;">New 5-Merchant Pilot application</h2>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Name:</strong> ${name}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Email:</strong> ${email}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Company:</strong> ${company}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Store URL:</strong> ${storeUrl}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Country:</strong> ${country}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Orders/day:</strong> ${ordersPerDay}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>SKUs/variants:</strong> ${skuCount}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Fulfillment:</strong> ${fulfillment}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Biggest issue:</strong> ${biggestIssue}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Uses Stocky:</strong> ${usesStocky}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Current tools:</strong> ${currentTools}</p>
      <p style="margin:0 0 4px;color:#3A3835;"><strong>Open to paid pilot:</strong> ${openToPaidPilot}</p>
      <p style="margin:0 0 0;color:#3A3835;"><strong>Preferred contact:</strong> ${contactMethod}</p>
    `),
  });

  if (error) {
    console.error('[EMAIL] sendPilotApplicationNotification failed:', error);
    throw new Error(`EMAIL_DELIVERY_FAILED: ${error.message}`);
  }

  console.info('[EMAIL] Pilot application notification sent', { email, company });
}