import type { CSSProperties, ElementType, ReactNode } from 'react'
import styles from './content.module.css'
import { cx } from './link'

export type ContentShellWidth = 'wide' | 'medium' | 'article'

export interface ContentShellProps {
  children: ReactNode
  width?: ContentShellWidth
  as?: ElementType
  className?: string
  style?: CSSProperties
}

const WIDTH_CLASS: Record<ContentShellWidth, string> = {
  wide: styles.shellWide,
  medium: styles.shellMedium,
  article: styles.shellArticle,
}

export function ContentShell({
  children,
  width = 'wide',
  as: Element = 'div',
  className,
  style,
}: ContentShellProps) {
  return (
    <Element className={cx(styles.shell, WIDTH_CLASS[width], className)} style={style}>
      {children}
    </Element>
  )
}
