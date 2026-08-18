import type { ElementType, ReactNode } from 'react'
import styles from './content.module.css'
import { cx } from './link'

export interface ContentHeroProps {
  eyebrow: ReactNode
  title: ReactNode
  accentText?: ReactNode
  description?: ReactNode
  trailing?: ReactNode
  headingAs?: ElementType
  className?: string
}

export function ContentHero({
  eyebrow,
  title,
  accentText,
  description,
  trailing,
  headingAs: Heading = 'h1',
  className,
}: ContentHeroProps) {
  return (
    <header className={cx(styles.hero, className)}>
      <div className={styles.heroEyebrow}>
        <span className={styles.heroEyebrowDot} aria-hidden="true" />
        <span>{eyebrow}</span>
      </div>
      <Heading className={styles.heroTitle}>
        {title}
        {accentText ? (
          <>
            {' '}
            <em className={styles.heroAccent}>{accentText}</em>
          </>
        ) : null}
      </Heading>
      {description ? <p className={styles.heroDescription}>{description}</p> : null}
      {trailing ? <div className={styles.heroTrailing}>{trailing}</div> : null}
    </header>
  )
}
