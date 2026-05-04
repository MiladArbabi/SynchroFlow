// api/waitlist.js
// Vercel serverless function — receives waitlist form submissions and sends
// notification email via Resend. Triggered by POST /api/waitlist from the landing page.

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, store } = req.body

  // Basic validation
  if (!email || !store) {
    return res.status(400).json({ error: 'Missing fields' })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('RESEND_API_KEY not set')
    return res.status(500).json({ error: 'Server configuration error' })
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'LaSyncro Waitlist <waitlist@lasyncro.com>',
        to: ['contact@lasyncro.com'],
        subject: `New waitlist signup — ${store}`,
        html: `
          <h2>New LaSyncro waitlist signup</h2>
          <table cellpadding="8" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
            <tr>
              <td style="color:#6B7280;padding-right:24px;">Email</td>
              <td style="font-weight:500;color:#0F0E0D;">${email}</td>
            </tr>
            <tr>
              <td style="color:#6B7280;padding-right:24px;">Store URL</td>
              <td style="font-weight:500;color:#0F0E0D;">${store}</td>
            </tr>
            <tr>
              <td style="color:#6B7280;padding-right:24px;">Submitted</td>
              <td style="color:#0F0E0D;">${new Date().toUTCString()}</td>
            </tr>
          </table>
          <p style="margin-top:24px;font-size:13px;color:#9CA3AF;">
            Sent from lasyncro.com waitlist form
          </p>
        `,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Resend error:', error)
      return res.status(500).json({ error: 'Failed to send email' })
    }

    return res.status(200).json({ success: true })

  } catch (err) {
    console.error('Waitlist handler error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}