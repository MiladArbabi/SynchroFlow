'use client'

import { usePostHog } from 'posthog-js/react'
import { useEffect } from 'react'

export default function CompareArticleTracker({ competitor }: { competitor: string }) {
  const ph = usePostHog()

  useEffect(() => {
    ph?.capture('compare_page_viewed', { competitor })
  }, [ph, competitor])

  return null
}