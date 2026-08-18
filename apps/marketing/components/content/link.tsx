import Link from 'next/link'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:)/.test(href)
}

export interface ContentLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  children: ReactNode
}

export function ContentLink({ href, children, target, rel, ...props }: ContentLinkProps) {
  if (isExternalHref(href)) {
    const safeRel = target === '_blank' && rel == null ? 'noopener noreferrer' : rel

    return (
      <a
        href={href}
        target={target}
        rel={safeRel}
        {...props}
      >
        {children}
      </a>
    )
  }

  return (
    <Link href={href} target={target} rel={rel} {...props}>
      {children}
    </Link>
  )
}
