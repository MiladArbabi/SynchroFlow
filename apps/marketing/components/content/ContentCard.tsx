import type { ElementType, ReactNode } from 'react'
import styles from './content.module.css'
import { ContentLink, cx } from './link'

export interface ContentCardProps {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  href?: string
  metadata?: ReactNode
  action?: ReactNode
  headingAs?: ElementType
  className?: string
  children?: ReactNode
}

export function ContentCard({
  title,
  description,
  eyebrow,
  href,
  metadata,
  action,
  headingAs: Heading = 'h3',
  className,
  children,
}: ContentCardProps) {
  const body = (
    <>
      {eyebrow ? <div className={styles.cardEyebrow}>{eyebrow}</div> : null}
      <Heading className={styles.cardTitle}>{title}</Heading>
      {description ? <p className={styles.cardDescription}>{description}</p> : null}
      {children}
      {metadata || action ? (
        <div className={styles.cardFooter}>
          {metadata}
          {action}
        </div>
      ) : null}
    </>
  )

  if (href) {
    return (
      <ContentLink href={href} className={cx(styles.card, styles.cardLink, className)}>
        {body}
      </ContentLink>
    )
  }

  return <div className={cx(styles.card, className)}>{body}</div>
}
