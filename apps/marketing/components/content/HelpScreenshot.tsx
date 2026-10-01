import styles from './content.module.css'

export interface HelpScreenshotProps {
  src: string
  alt: string
  /** Use intrinsic pixel dimensions; MDX requires literals such as width="1600". */
  width: number | `${number}`
  height: number | `${number}`
  caption?: string
  label?: string
  layout?: 'wide' | 'prose'
}

export function HelpScreenshot({
  src,
  alt,
  width,
  height,
  caption,
  label,
  layout = 'wide',
}: HelpScreenshotProps) {
  return (
    <figure
      className={`${styles.helpScreenshot}${layout === 'wide' ? ` ${styles.helpScreenshotBreakout}` : ''}`}
    >
      {label ? <div className={styles.helpScreenshotLabel}>{label}</div> : null}
      {/* Native image preserves the original product capture without optimization or cropping. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.helpScreenshotImage}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />
      {caption ? <figcaption className={styles.helpScreenshotCaption}>{caption}</figcaption> : null}
    </figure>
  )
}
