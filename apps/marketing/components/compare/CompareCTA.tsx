'use client'

import { captureMarketingEvent } from '../PostHogProvider'
import { useShopifyAvailability } from '@/components/conversion/LaunchNotifyForm'

export default function CompareCTA() {
  const availability = useShopifyAvailability()
  const waitingForLaunch = !availability.available || !availability.installUrl

  return (
     <a
      href={waitingForLaunch ? '/pricing#launch-pricing' : availability.installUrl!}
      onClick={() => captureMarketingEvent('compare_cta_clicked', { location: 'bottom_cta', cta_label: waitingForLaunch ? 'get_early_access' : 'install_on_shopify' })}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '12px 24px', background: 'var(--accent)', color: 'var(--on-accent)',
        fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 500,
        borderRadius: 6, textDecoration: 'none',
      }}
    >
      {waitingForLaunch ? 'Get early access' : 'Install on Shopify'}
    </a> 
  )
}
