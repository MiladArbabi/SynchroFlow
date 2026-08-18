import type { CSSProperties, ReactNode } from 'react'

const helpTheme = {
  minHeight: '100vh',
  background: '#151D29',
  color: '#F0EEE8',
  colorScheme: 'dark',
  '--bg': '#151D29',
  '--bg-2': '#1C2740',
  '--bg-3': '#243050',
  '--surface': '#1C2740',
  '--ink': '#F0EEE8',
  '--ink-2': '#C8C4BB',
  '--ink-3': '#8B8F9A',
  '--ink-4': '#5A5F6E',
  '--rule': 'rgba(255,255,255,0.08)',
  '--rule-2': 'rgba(255,255,255,0.14)',
  '--accent-ghost': 'rgba(255,107,43,0.12)',
  '--accent-border': 'rgba(255,107,43,0.25)',
  '--on-accent': '#FFFFFF',
} as CSSProperties

export default function HelpLayout({ children }: { children: ReactNode }) {
  return <div style={helpTheme}>{children}</div>
}
