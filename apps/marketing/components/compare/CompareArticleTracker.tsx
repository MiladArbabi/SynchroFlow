'use client'

import { captureMarketingEvent, useMarketingAnalyticsReady } from '../PostHogProvider'
import { useEffect } from 'react'

export default function CompareArticleTracker({ competitor }: { competitor: string }) {

  const analyticsReady = useMarketingAnalyticsReady()

  useEffect(() => {
    if (!analyticsReady) return
    captureMarketingEvent('compare_page_viewed', { competitor })
  }, [analyticsReady, competitor])

  return null
}