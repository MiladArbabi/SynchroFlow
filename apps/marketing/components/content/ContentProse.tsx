import type {
  AnchorHTMLAttributes,
  BlockquoteHTMLAttributes,
  CSSProperties,
  ElementType,
  HTMLAttributes,
  LiHTMLAttributes,
  OlHTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react'
import styles from './content.module.css'
import { ContentLink, cx } from './link'

export interface ContentProseProps {
  children: ReactNode
  as?: ElementType
  className?: string
  style?: CSSProperties
}

export type ContentMdxComponentMap = {
  h2: (props: HTMLAttributes<HTMLHeadingElement>) => ReactNode
  h3: (props: HTMLAttributes<HTMLHeadingElement>) => ReactNode
  p: (props: HTMLAttributes<HTMLParagraphElement>) => ReactNode
  ul: (props: HTMLAttributes<HTMLUListElement>) => ReactNode
  ol: (props: OlHTMLAttributes<HTMLOListElement>) => ReactNode
  li: (props: LiHTMLAttributes<HTMLLIElement>) => ReactNode
  strong: (props: HTMLAttributes<HTMLElement>) => ReactNode
  a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => ReactNode
  table: (props: TableHTMLAttributes<HTMLTableElement>) => ReactNode
  thead: (props: HTMLAttributes<HTMLTableSectionElement>) => ReactNode
  tbody: (props: HTMLAttributes<HTMLTableSectionElement>) => ReactNode
  tr: (props: HTMLAttributes<HTMLTableRowElement>) => ReactNode
  th: (props: ThHTMLAttributes<HTMLTableCellElement>) => ReactNode
  td: (props: TdHTMLAttributes<HTMLTableCellElement>) => ReactNode
  blockquote: (props: BlockquoteHTMLAttributes<HTMLQuoteElement>) => ReactNode
  pre: (props: HTMLAttributes<HTMLPreElement>) => ReactNode
  code: (props: HTMLAttributes<HTMLElement>) => ReactNode
}

export function ContentProse({
  children,
  as: Element = 'div',
  className,
  style,
}: ContentProseProps) {
  return (
    <Element className={cx(styles.prose, className)} style={style}>
      {children}
    </Element>
  )
}

export const contentMdxComponents: ContentMdxComponentMap = {
  h2: ({ className, ...props }) => <h2 className={cx(styles.proseH2, className)} {...props} />,
  h3: ({ className, ...props }) => <h3 className={cx(styles.proseH3, className)} {...props} />,
  p: ({ className, ...props }) => <p className={cx(styles.proseP, className)} {...props} />,
  ul: ({ className, ...props }) => <ul className={cx(styles.proseUl, className)} {...props} />,
  ol: ({ className, ...props }) => <ol className={cx(styles.proseOl, className)} {...props} />,
  li: ({ className, ...props }) => <li className={cx(styles.proseLi, className)} {...props} />,
  strong: ({ className, ...props }) => <strong className={cx(styles.proseStrong, className)} {...props} />,
  a: ({ href, className, children, ...props }) => {
    if (!href) {
      return <a className={cx(styles.proseLink, className)} {...props}>{children}</a>
    }

    return (
      <ContentLink href={href} className={cx(styles.proseLink, className)} {...props}>
        {children}
      </ContentLink>
    )
  },
  table: ({ className, ...props }) => (
    <div className={styles.proseTableWrap}>
      <table className={cx(styles.proseTable, className)} {...props} />
    </div>
  ),
  thead: (props) => <thead {...props} />,
  tbody: (props) => <tbody {...props} />,
  tr: (props) => <tr {...props} />,
  th: ({ className, ...props }) => <th className={cx(styles.proseTh, className)} {...props} />,
  td: ({ className, ...props }) => <td className={cx(styles.proseTd, className)} {...props} />,
  blockquote: ({ className, ...props }) => (
    <blockquote className={cx(styles.proseBlockquote, className)} {...props} />
  ),
  pre: ({ className, ...props }) => <pre className={cx(styles.prosePre, className)} {...props} />,
  code: ({ className, ...props }) => <code className={cx(styles.proseInlineCode, className)} {...props} />,
}

export function createContentMdxComponents(
  overrides: Partial<ContentMdxComponentMap> = {}
): ContentMdxComponentMap {
  return { ...contentMdxComponents, ...overrides }
}
