// app/privacy/page.tsx
// Privacy policy — required for Shopify app store listing submission.
// Also serves as a trust signal for US merchants evaluating LaSyncro.
// IMPORTANT: No font: shorthand in inline styles.

import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'

export const metadata: Metadata = {
  title: 'Privacy Policy — LaSyncro',
  description: 'LaSyncro privacy policy. How we collect, use, and protect your data.',
  alternates: { canonical: 'https://www.lasyncro.com/privacy' },
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

const privacyPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://www.lasyncro.com/privacy',
  url: 'https://www.lasyncro.com/privacy',
  name: 'Privacy Policy — LaSyncro',
  publisher: { '@id': 'https://www.lasyncro.com/#organization', },
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ fontFamily: 'var(--sans)', fontSize: 24, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '0 0 16px' }}>
        {title}
      </h2>
      <div style={{ fontFamily: 'var(--sans)', fontSize: 16, fontWeight: 300, lineHeight: 1.8, color: 'var(--ink-2)' }}>
        {children}
      </div>
    </section>
  )
}

export default function PrivacyPage() {
  const updated = 'November 5, 2026'

  return (
    <>
      <Schema data={privacyPageSchema} />

      {/* ── Page header ───────────────────────────────────────────── */}
      <header style={{ ...W, padding: '96px 5vw 56px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--accent)', marginBottom: 22, fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
          Legal
        </div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 'clamp(38px, 5vw, 64px)', fontWeight: 650, lineHeight: 1.05, letterSpacing: '-0.045em', color: 'var(--ink)', margin: '0 0 24px', maxWidth: 720 }}>
          Privacy Policy
        </h1>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 15, fontWeight: 300, lineHeight: 1.6, color: 'var(--ink-3)', margin: 0 }}>
          Last updated: {updated}
        </p>
      </header>

      {/* ── Rule ─────────────────────────────────────────────────── */}
      <div style={{ ...W, padding: '0 5vw' }}>
        <div style={{ borderTop: '1px solid var(--rule)' }} />
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div style={{ ...W, padding: '56px 5vw 80px', maxWidth: '780px', margin: '0 auto' }}>

        <Section title="Who we are">
          <p>LaSyncro is an operational intelligence platform for Shopify merchants running their own warehouse. We are operated by LaSyncro (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). Our website is <a href="https://www.lasyncro.com" style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid var(--accent-border)' }}>lasyncro.com</a> and we can be reached at <a href="mailto:contact@lasyncro.com" style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid var(--accent-border)' }}>contact@lasyncro.com</a>.</p>
        </Section>

        <Section title="What data we collect">
          <p style={{ marginBottom: 16 }}>We collect the following types of information:</p>
          <p style={{ marginBottom: 8 }}><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Account and contact information.</strong> When you sign up for early access or contact us, we collect your email address and, optionally, your Shopify store URL. This information is used solely to communicate with you about LaSyncro.</p>
          <p style={{ marginBottom: 8 }}><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Shopify store data.</strong> When you connect LaSyncro to Shopify, requested OAuth permissions include reading products, orders, customers, inventory and locations, and writing inventory and fulfillment data for supported workflows. We use your store information to provide and operate the service. We do not sell, share, or use your Shopify store data for any purpose other than operating the service on your behalf.</p>
          <p style={{ marginBottom: 8 }}><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Usage and analytics data.</strong> With analytics consent, we use PostHog and Google Analytics to measure page views, feature interactions and similar usage. These tools may use cookie-based or pseudonymous identifiers. Signed-in product usage may be associated with account or merchant-workspace identifiers. Email and store URLs submitted through public waitlist forms are not included in marketing analytics event properties.</p>
          <p><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Communications.</strong> If you contact us by email, we retain those communications to respond to your enquiry and improve our support.</p>
        </Section>

        <Section title="How we use your data">
          <p style={{ marginBottom: 8 }}>We use the data we collect to:</p>
          <ul style={{ paddingLeft: '1.4rem', margin: '0 0 16px' }}>
            <li style={{ marginBottom: 6 }}>Provide and operate the LaSyncro service</li>
            <li style={{ marginBottom: 6 }}>Communicate with you about your account, product updates, and the early access programme</li>
            <li style={{ marginBottom: 6 }}>Understand how the product is used and improve it</li>
            <li style={{ marginBottom: 6 }}>Respond to support requests and enquiries</li>
            <li style={{ marginBottom: 6 }}>Comply with legal obligations</li>
          </ul>
          <p>We do not use your data for advertising, and we do not sell your data to third parties under any circumstances.</p>
        </Section>

        <Section title="Data sharing and third parties">
          <p style={{ marginBottom: 8 }}>We share data with third-party service providers only where necessary to operate the service:</p>
          <ul style={{ paddingLeft: '1.4rem', margin: '0 0 16px' }}>
            <li style={{ marginBottom: 6 }}><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Shopify.</strong> We connect to Shopify via their official OAuth API. Shopify&apos;s privacy policy governs their handling of data.</li>
            <li style={{ marginBottom: 6 }}><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Vercel.</strong> Our web infrastructure is hosted on Vercel. Vercel may process request data (IP addresses, request logs) as part of normal web hosting operations.</li>
            <li style={{ marginBottom: 6 }}><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>PostHog.</strong> With analytics consent, PostHog processes pseudonymous browser analytics and may associate authenticated product events with account or merchant-workspace identifiers.</li>
            <li style={{ marginBottom: 6 }}><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Google Analytics.</strong> With analytics consent, Google Analytics measures visits and usage and may place analytics identifier cookies on supported website and app surfaces.</li>
            <li style={{ marginBottom: 6 }}><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Resend.</strong> We use Resend to send transactional email notifications. Email addresses used for notifications are processed by Resend in accordance with their privacy policy.</li>
          </ul>
          <p>We do not share your Shopify store data, order data, inventory data, or customer data with any third party for any purpose other than operating the LaSyncro service.</p>
        </Section>

        <Section title="Data retention">
          <p>We retain account and operational information as needed to provide the service, respond to requests and meet applicable legal, security and recordkeeping obligations. You may request deletion by contacting us; some records may need to be retained where required by law or legitimate operational obligations. Analytics data retention is governed by the applicable service settings and legal requirements.</p>
        </Section>

        <Section title="Your rights">
          <p style={{ marginBottom: 8 }}>Depending on your location, you may have the following rights regarding your personal data:</p>
          <ul style={{ paddingLeft: '1.4rem', margin: '0 0 16px' }}>
            <li style={{ marginBottom: 6 }}>The right to access the personal data we hold about you</li>
            <li style={{ marginBottom: 6 }}>The right to correct inaccurate personal data</li>
            <li style={{ marginBottom: 6 }}>The right to request deletion of your personal data</li>
            <li style={{ marginBottom: 6 }}>The right to object to or restrict processing of your personal data</li>
            <li style={{ marginBottom: 6 }}>The right to data portability</li>
          </ul>
          <p>To exercise any of these rights, contact us at <a href="mailto:contact@lasyncro.com" style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid var(--accent-border)' }}>contact@lasyncro.com</a>. We will respond within 30 days.</p>
        </Section>

        <Section title="Cookies">
          <p>LaSyncro uses essential cookies for service functions such as authentication. Optional analytics cookies and identifiers from PostHog and Google Analytics are used after you grant analytics consent. You can change your choice using Cookie preferences. Withdrawing consent stops new analytics event capture and removes accessible GA4 identifier cookies. PostHog events recorded while consent was granted may still complete transmission afterward; a pseudonymous PostHog identifier may remain on your device while capture is disabled.</p>
        </Section>

        <Section title="Security">
          <p>We implement industry-standard security measures to protect your data, including encrypted data transmission (HTTPS), access controls limiting who can access your data within our organisation, and regular security reviews. No method of transmission over the internet is 100% secure — if you have concerns about the security of your data, contact us at <a href="mailto:contact@lasyncro.com" style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid var(--accent-border)' }}>contact@lasyncro.com</a>.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>We may update this privacy policy from time to time. We will notify you of material changes by email if you have provided your email address, and by updating the &ldquo;Last updated&rdquo; date at the top of this page. Continued use of LaSyncro after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="Contact">
          <p>Questions about this privacy policy or your data? Contact us at <a href="mailto:contact@lasyncro.com" style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid var(--accent-border)' }}>contact@lasyncro.com</a>.</p>
        </Section>

      </div>
    </>
  )
}