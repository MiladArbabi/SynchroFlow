'use client'

import { captureMarketingEvent, useMarketingAnalyticsReady } from '../PostHogProvider'
import { useEffect, useRef } from 'react'

interface Props {
  slug: string
  category: string
  estimatedReadMin: number
}

export default function BlogArticleTracker({ slug, category, estimatedReadMin }: Props) {
  const firedCompletion = useRef(false)

  const analyticsReady = useMarketingAnalyticsReady()

  useEffect(() => {
    if (!analyticsReady) return
    captureMarketingEvent('blog_article_viewed', { article_slug: slug, category, estimated_read_min: estimatedReadMin })
  }, [analyticsReady, slug, category, estimatedReadMin])

  useEffect(() => {
    if (!analyticsReady) return
    const sentinel = document.getElementById('article-completion-sentinel')
    if (!sentinel) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !firedCompletion.current) {
        firedCompletion.current = true
        captureMarketingEvent('blog_article_completed', { article_slug: slug, scroll_depth_pct: 80 })
        observer.disconnect()
      }
    }, { threshold: 0 })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [analyticsReady, slug])

  return <div id="article-completion-sentinel" style={{ height: 1 }} />
}