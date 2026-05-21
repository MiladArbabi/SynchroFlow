// app/terms/page.tsx
// Terms of Service — required for Shopify app store listing submission.
// IMPORTANT: No font: shorthand in inline styles.
import { Metadata } from 'next'
import Schema from '@/components/seo/Schema'

export const metadata: Metadata = {
  title: 'Terms of Service — LaSyncro',
  description: 'LaSyncro terms of service. The rules and conditions for using LaSyncro.',
  alternates: { canonical: 'https://www.lasyncro.com/terms' },
}

const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

const termsPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://lasyncro.com/terms',
  name: 'Terms of Service — LaSyncro',
  url: 'https://www.lasyncro.com/terms',
}

export default function TermsPage() {
  return (
    <>
      <Schema data={termsPageSchema} />
      <main>
        <section style={{ padding: '80px 0 40px' }}>
          <div style={W}>
            <h1 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Terms of Service
            </h1>
            <p style={{ color: '#6B7280', marginBottom: '2.5rem' }}>
              Last updated: May 2026
            </p>

            <div style={{ maxWidth: '720px', lineHeight: '1.8', color: '#374151' }}>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>1. Acceptance of terms</h2>
              <p>By accessing or using LaSyncro (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>2. Description of service</h2>
              <p>LaSyncro provides inventory management, order management, and warehouse management software for Shopify merchants. The Service connects to your Shopify store in read-only mode by default.</p>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>3. Account registration</h2>
              <p>You must provide accurate information when creating an account. You are responsible for maintaining the security of your credentials. You must be 18 or older to use the Service.</p>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>4. Data access and permissions</h2>
              <p>LaSyncro requests read-only access to your Shopify store data including products, inventory, orders, and customers. We never make changes to your store without explicit permission. You can revoke access at any time from your Shopify admin.</p>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>5. Acceptable use</h2>
              <p>You agree not to misuse the Service, attempt to gain unauthorised access, reverse engineer any part of the platform, or use it for any unlawful purpose.</p>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>6. Subscription and billing</h2>
              <p>LaSyncro offers a 14-day free trial. After the trial, continued use requires a paid subscription. Billing is handled securely through Stripe. You may cancel at any time.</p>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>7. Termination</h2>
              <p>We may suspend or terminate your account if you violate these terms. You may terminate your account at any time by contacting support.</p>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>8. Limitation of liability</h2>
              <p>To the maximum extent permitted by law, LaSyncro shall not be liable for any indirect, incidental, or consequential damages arising from use of the Service.</p>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>9. Changes to terms</h2>
              <p>We may update these terms from time to time. Continued use of the Service after changes constitutes acceptance of the new terms.</p>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2rem', marginBottom: '0.75rem' }}>10. Contact</h2>
              <p>Questions about these terms? Contact us at <a href="mailto:legal@lasyncro.com" style={{ color: '#FF6B2B' }}>legal@lasyncro.com</a>.</p>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}