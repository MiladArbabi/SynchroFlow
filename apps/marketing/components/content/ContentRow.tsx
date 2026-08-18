import type { ElementType, ReactNode } from 'react'
import styles from './content.module.css'
import { ContentLink, cx } from './link'

export interface ContentRowProps {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  href?: string
  meta?: ReactNode
  trailing?: ReactNode
  headingAs?: ElementType
  className?: string
}

export function ContentRow({
  title,
  description,
  eyebrow,
  href,
  meta,
  trailing,
  headingAs: Heading = 'h3',
  className,
}: ContentRowProps) {
  const body = (
    <>
      <div>
        {eyebrow ? <div className={styles.rowEyebrow}>{eyebrow}</div> : null}
        <Heading className={styles.rowTitle}>{title}</Heading>
        {description ? <p className={styles.rowDescription}>{description}</p> : null}
        {meta ? <div className={styles.rowMeta}>{meta}</div> : null}
      </div>
      {trailing ? <div className={styles.rowTrailing}>{trailing}</div> : null}
    </>
  )

  if (href) {
    return (
      <ContentLink href={href} className={cx(styles.row, styles.rowLink, className)}>
        {body}
      </ContentLink>
    )
  }

  return <div className={cx(styles.row, className)}>{body}</div>
}
