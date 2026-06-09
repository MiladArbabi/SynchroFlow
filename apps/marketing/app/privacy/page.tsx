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
      <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, fontWeight: 400, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 16px' }}>
        {title}
      </h2>
      <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 16, fontWeight: 300, lineHeight: 1.8, color: '#3A3835' }}>
        {children}
      </div>
    </section>
  )
}

export default function PrivacyPage() {
  const updated = 'May 17, 2026'

  return (
    <>
      <Schema data={privacyPageSchema} />

      {/* ── Page header ───────────────────────────────────────────── */}
      <header style={{ ...W, padding: '96px 5vw 56px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', marginBottom: 22, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6B2B', display: 'inline-block' }} />
          Legal
        </div>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 48, fontWeight: 400, lineHeight: 1.18, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 24px', maxWidth: 720 }}>
          Privacy Policy
        </h1>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.6, color: '#6B7280', margin: 0 }}>
          Last updated: {updated}
        </p>
      </header>

      {/* ── Rule ─────────────────────────────────────────────────── */}
      <div style={{ ...W, padding: '0 5vw' }}>
        <div style={{ borderTop: '1px solid #E8E6E0' }} />
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div style={{ ...W, padding: '56px 5vw 80px', maxWidth: '780px', margin: '0 auto' }}>

        <Section title="Who we are">
          <p>LaSyncro is an operational intelligence platform for Shopify merchants running their own warehouse. We are operated by LaSyncro (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). Our website is <a href="https://www.lasyncro.com" style={{ color: '#FF6B2B', textDecoration: 'none', borderBottom: '1px solid #FFDCCA' }}>lasyncro.com</a> and we can be reached at <a href="mailto:contact@lasyncro.com" style={{ color: '#FF6B2B', textDecoration: 'none', borderBottom: '1px solid #FFDCCA' }}>contact@lasyncro.com</a>.</p>
        </Section>

        <Section title="What data we collect">
          <p style={{ marginBottom: 16 }}>We collect the following types of information:</p>
          <p style={{ marginBottom: 8 }}><strong style={{ fontWeight: 500, color: '#0F0E0D' }}>Account and contact information.</strong> When you sign up for early access or contact us, we collect your email address and, optionally, your Shopify store URL. This information is used solely to communicate with you about LaSyncro.</p>
          <p style={{ marginBottom: 8 }}><strong style={{ fontWeight: 500, color: '#0F0E0D' }}>Shopify store data.</strong> When you connect LaSyncro to your Shopify store via OAuth, we access the data scopes you authorise — typically orders, products, inventory levels, and locations. We use this data exclusively to provide the LaSyncro service. We do not sell, share, or use your Shopify store data for any purpose other than operating the service on your behalf.</p>
          <p style={{ marginBottom: 8 }}><strong style={{ fontWeight: 500, color: '#0F0E0D' }}>Usage and analytics data.</strong> We collect anonymised usage data (page views, feature usage, session duration) via PostHog to understand how the product is used and improve it. This data is not linked to personally identifiable information.</p>
          <p><strong style={{ fontWeight: 500, color: '#0F0E0D' }}>Communications.</strong> If you contact us by email, we retain those communications to respond to your enquiry and improve our support.</p>
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
            <li style={{ marginBottom: 6 }}><strong style={{ fontWeight: 500, color: '#0F0E0D' }}>Shopify.</strong> We connect to Shopify via their official OAuth API. Shopify&apos;s privacy policy governs their handling of data.</li>
            <li style={{ marginBottom: 6 }}><strong style={{ fontWeight: 500, color: '#0F0E0D' }}>Vercel.</strong> Our web infrastructure is hosted on Vercel. Vercel may process request data (IP addresses, request logs) as part of normal web hosting operations.</li>
            <li style={{ marginBottom: 6 }}><strong style={{ fontWeight: 500, color: '#0F0E0D' }}>PostHog.</strong> We use PostHog for anonymised product analytics. No personally identifiable information is sent to PostHog.</li>
            <li style={{ marginBottom: 6 }}><strong style={{ fontWeight: 500, color: '#0F0E0D' }}>Resend.</strong> We use Resend to send transactional email notifications. Email addresses used for notifications are processed by Resend in accordance with their privacy policy.</li>
          </ul>
          <p>We do not share your Shopify store data, order data, inventory data, or customer data with any third party for any purpose other than operating the LaSyncro service.</p>
        </Section>

        <Section title="Data retention">
          <p>We retain your account data for as long as your account is active. If you request deletion of your account and data, we will remove your personal information within 30 days, except where we are required to retain it by law. Anonymised usage analytics data may be retained indefinitely as it cannot be linked to you personally.</p>
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
          <p>To exercise any of these rights, contact us at <a href="mailto:contact@lasyncro.com" style={{ color: '#FF6B2B', textDecoration: 'none', borderBottom: '1px solid #FFDCCA' }}>contact@lasyncro.com</a>. We will respond within 30 days.</p>
        </Section>

        <Section title="Cookies">
          <p>LaSyncro uses minimal cookies required for the service to function (session authentication). We do not use advertising cookies or tracking cookies. Our anonymised analytics (PostHog) uses a first-party cookie that does not track you across other websites.</p>
        </Section>

        <Section title="Security">
          <p>We implement industry-standard security measures to protect your data, including encrypted data transmission (HTTPS), access controls limiting who can access your data within our organisation, and regular security reviews. No method of transmission over the internet is 100% secure — if you have concerns about the security of your data, contact us at <a href="mailto:contact@lasyncro.com" style={{ color: '#FF6B2B', textDecoration: 'none', borderBottom: '1px solid #FFDCCA' }}>contact@lasyncro.com</a>.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>We may update this privacy policy from time to time. We will notify you of material changes by email if you have provided your email address, and by updating the &ldquo;Last updated&rdquo; date at the top of this page. Continued use of LaSyncro after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="Contact">
          <p>Questions about this privacy policy or your data? Contact us at <a href="mailto:contact@lasyncro.com" style={{ color: '#FF6B2B', textDecoration: 'none', borderBottom: '1px solid #FFDCCA' }}>contact@lasyncro.com</a>.</p>
        </Section>

      </div>
    </>
  )
}