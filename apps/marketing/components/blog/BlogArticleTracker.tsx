'use client'

import { usePostHog } from 'posthog-js/react'
import { useEffect, useRef } from 'react'

interface Props {
  slug: string
  category: string
  estimatedReadMin: number
}

export default function BlogArticleTracker({ slug, category, estimatedReadMin }: Props) {
  const ph = usePostHog()
  const firedCompletion = useRef(false)

  useEffect(() => {
    ph?.capture('blog_article_viewed', { article_slug: slug, category, estimated_read_min: estimatedReadMin })
  }, [ph, slug, category, estimatedReadMin])

  useEffect(() => {
    const sentinel = document.getElementById('article-completion-sentinel')
    if (!sentinel) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !firedCompletion.current) {
        firedCompletion.current = true
        ph?.capture('blog_article_completed', { article_slug: slug, scroll_depth_pct: 80 })
        observer.disconnect()
      }
    }, { threshold: 0 })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [ph, slug])

  return <div id="article-completion-sentinel" style={{ height: 1 }} />
}