// components/article/WaitlistCTA.tsx
// Conversion block — renders mid-article and end-of-article.
// Links directly to the waitlist on lasyncro.com.
// variant="inline" = compact mid-article placement
// variant="full"   = prominent end-of-article placement

interface WaitlistCTAProps {
  variant?: 'inline' | 'full'
  text?: string
}

export default function WaitlistCTA({
  variant = 'full',
  text,
}: WaitlistCTAProps) {
  const href = 'https://lasyncro.com/#waitlist'

  if (variant === 'inline') {
    return (
      <div className="my-8 flex items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-700 dark:bg-gray-800/50">
        <p className="flex-1 text-sm text-gray-700 dark:text-gray-300">
          {text ?? 'LaSyncro handles this automatically \u2014 real-time, no manual work.'}
        </p>
        <a href={href} className="shrink-0 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
          {'Start free \u2192'}
        </a>
      </div>
    )
  }

  return (
    <div className="my-10 rounded-xl border border-orange-200 bg-orange-50 px-8 py-8 text-center dark:border-orange-900 dark:bg-orange-950/30">
      <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {text ?? 'See your operation clearly for the first time.'}
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        41 store owners already waiting. Connect Shopify in 60 seconds. No credit card required.
      </p>
      <a 
        href={href}
        className="inline-block rounded-md bg-orange-500 px-6 py-3 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
      >
        Reserve my spot — it&apos;s free
      </a>
    </div>
  )
}