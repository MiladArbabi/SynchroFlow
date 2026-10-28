/**
 * WS-UX-RECEIVE-D4R S1 — Receive-local presentation shell (approved V3.1
 * wireframe grammar). Presentation only: every component here renders what it
 * is given and owns no session state, writes or handlers. Not a shared
 * warehouse framework — Receive is the reference implementation first.
 *
 * Grammar: header (workflow pill · reference / supplier · job · centred
 * progress bars · optional exit), one centred task column (eyebrow, light
 * headline, sub, task content, status line, one primary action) and a footer
 * carrying secondary actions such as the PO-lines drawer. The Work Note is
 * distributed across these parts (UX-13): no separate strip.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Package } from 'lucide-react';
import { Box, Button, Dialog, Drawer, LinearProgress, Typography, type ButtonProps, type SxProps, type Theme } from '@mui/material';

export const receiveMonoSx = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  letterSpacing: 0,
} as const;

/** One progress segment per line: done, current, needs a decision/hold, or not started. */
export type ReceiveBarTone = 'done' | 'current' | 'flag' | 'idle';

const BAR_COLOR: Record<ReceiveBarTone, string> = {
  done: 'var(--good-ink)',
  current: 'var(--ink)',
  flag: 'var(--accent)',
  idle: 'var(--rule)',
};

function ProgressBars({ bars }: { bars: ReceiveBarTone[] }) {
  if (bars.length === 0) return null;
  return (
    <Box
      aria-hidden="true"
      sx={{
        display: 'flex',
        gap: '4px',
        width: { xs: '100%', md: Math.min(bars.length * 56, 360) },
      }}
    >
      {bars.map((tone, index) => (
        <Box key={index} sx={{ flex: '1 1 0', maxWidth: { md: 52 }, height: 4, borderRadius: '2px', bgcolor: BAR_COLOR[tone] }} />
      ))}
    </Box>
  );
}

export function ReceiveSessionShell({
  reference,
  supplier,
  jobId,
  bars,
  progressLabel,
  headerAction,
  footerLeft,
  footerRight,
  children,
  overlay,
}: {
  reference: string;
  supplier: string;
  jobId?: string | null;
  bars: ReceiveBarTone[];
  progressLabel?: string;
  headerAction?: ReactNode;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  const hasFooter = !!(footerLeft || footerRight);
  return (
    <Box
      data-testid="receive-session-shell"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        bgcolor: 'var(--bg)',
        color: 'var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pb: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <Box
        component="header"
        sx={{
          flex: '0 0 auto',
          bgcolor: { xs: 'var(--bg)', md: 'var(--surface)' },
          borderBottom: { xs: 0, md: '1px solid var(--rule)' },
          pt: { xs: 'max(8px, env(safe-area-inset-top, 0px))', md: 0 },
        }}
      >
        {/* One DOM for both viewports: desktop = identity | centred bars + label | action;
            mobile = identity | action, then label and full-width bars. */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0,1fr) auto', md: '1fr auto 1fr' },
            alignItems: 'center',
            minHeight: { md: 64 },
            px: { xs: 2, md: 3 },
            pb: { xs: 1, md: 0 },
            columnGap: 2,
            rowGap: 0.75,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, gridColumn: 1, gridRow: 1 }}>
            <Box
              component="span"
              sx={{
                fontSize: { xs: 10, md: 11 },
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: '0.12em',
                color: 'var(--accent-text)',
                bgcolor: { xs: 'transparent', md: 'var(--accent-ghost)' },
                borderRadius: '100px',
                px: { xs: 0, md: '11px' },
                py: { xs: 0, md: '6px' },
                flexShrink: 0,
              }}
            >
              RECEIVE
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ ...receiveMonoSx, fontSize: { xs: 12, md: 14 }, fontWeight: 500, color: 'var(--ink)' }}>{reference}</Typography>
              <Typography noWrap sx={{ display: { xs: 'none', md: 'block' }, fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                {supplier}
                {jobId ? <> · <Box component="span" sx={receiveMonoSx}>{jobId}</Box></> : null}
              </Typography>
            </Box>
          </Box>
          <Box
            sx={{
              display: 'grid',
              justifyItems: { xs: 'stretch', md: 'center' },
              gap: 0.75,
              // Mobile: label and bars sit beside Exit, which spans both rows (V3.1).
              gridColumn: { xs: headerAction ? 1 : '1 / -1', md: 2 },
              gridRow: { xs: 2, md: 1 },
            }}
          >
            {progressLabel ? (
              <Typography sx={{ order: { xs: 0, md: 1 }, fontSize: { xs: 14, md: 12 }, fontWeight: 500, color: { xs: 'var(--ink)', md: 'var(--ink-2)' } }}>
                {progressLabel}
              </Typography>
            ) : null}
            <ProgressBars bars={bars} />
          </Box>
          <Box sx={{ justifySelf: 'end', alignSelf: 'center', gridColumn: { xs: 2, md: 3 }, gridRow: { xs: '1 / span 2', md: 1 } }}>{headerAction}</Box>
        </Box>
      </Box>

      <Box
        component="main"
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowX: 'hidden',
          // Zero-scroll is the design target at 1440x900 and 390x844; overflow
          // stays reachable rather than clipped when real data is longer.
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{
            width: { xs: 'auto', md: 600 },
            maxWidth: '100%',
            m: { xs: 0, md: 'auto' },
            flex: { xs: '1 0 auto', md: '0 0 auto' },
            display: 'flex',
            flexDirection: 'column',
            gap: { xs: 1.5, md: 2.25 },
            px: { xs: 2, md: 0 },
            pt: { xs: 2, md: 3 },
            pb: { xs: 1, md: 3 },
          }}
        >
          {children}
        </Box>
      </Box>

      {hasFooter && (
        <Box
          component="footer"
          sx={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            minHeight: { xs: 0, md: 60 },
            px: { xs: 2, md: 3 },
            py: { xs: 1, md: 0 },
            bgcolor: { xs: 'transparent', md: 'var(--surface)' },
            borderTop: { xs: 0, md: '1px solid var(--rule)' },
          }}
        >
          <Box>{footerLeft}</Box>
          <Box>{footerRight}</Box>
        </Box>
      )}
      {overlay}
    </Box>
  );
}

/** Eyebrow (Work Note action), light headline with optional italic accent, sub. */
export function ReceiveTaskHeading({
  eyebrow,
  eyebrowTone = 'accent',
  title,
  accent,
  sub,
  titleSx,
}: {
  eyebrow: ReactNode;
  eyebrowTone?: 'accent' | 'error' | 'ok';
  title: ReactNode;
  /** Italic accent words after the title. Omitted where the title must stay one text node. */
  accent?: ReactNode;
  sub?: ReactNode;
  titleSx?: SxProps<Theme>;
}) {
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 1 }}>
      <Typography
        component="div"
        sx={{
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: eyebrowTone === 'error' ? 'var(--critical-text)' : eyebrowTone === 'ok' ? 'var(--good-ink)' : 'var(--accent-text)',
        }}
      >
        {eyebrow}
      </Typography>
      <Typography
        component="h1"
        sx={[
          {
            m: 0,
            fontSize: { xs: 34, md: 52 },
            fontWeight: 400,
            lineHeight: 1.06,
            letterSpacing: '-0.02em',
            textWrap: 'balance',
            overflowWrap: 'anywhere',
            color: 'var(--ink)',
          },
          ...(Array.isArray(titleSx) ? titleSx : titleSx ? [titleSx] : []),
        ]}
      >
        {title}
        {accent ? <> <Box component="em" sx={{ fontStyle: 'italic', color: 'var(--accent)' }}>{accent}</Box></> : null}
      </Typography>
      {sub ? (
        <Typography component="div" sx={{ fontSize: { xs: 14, md: 16 }, fontWeight: 300, lineHeight: 1.5, color: 'var(--ink-2)', maxWidth: 520 }}>
          {sub}
        </Typography>
      ) : null}
    </Box>
  );
}

export type ReceiveStatusTone = 'ok' | 'warn' | 'error' | 'neutral';

const STATUS_DOT: Record<ReceiveStatusTone, string> = {
  ok: 'var(--good-ink)',
  warn: 'var(--warning-ink)',
  error: 'var(--critical-ink)',
  neutral: 'var(--ink-4)',
};

/** Fixed-height Next / acknowledgement / error line. */
export function ReceiveStatusLine({
  tone = 'neutral',
  role,
  children,
}: {
  tone?: ReceiveStatusTone;
  role?: 'alert' | 'status';
  children: ReactNode;
}) {
  return (
    <Box
      role={role}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        minHeight: 20,
        textAlign: 'center',
        fontSize: 13,
        color: tone === 'error' ? 'var(--critical-text)' : 'var(--ink-2)',
      }}
    >
      <Box aria-hidden="true" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: STATUS_DOT[tone], flex: '0 0 auto' }} />
      <Box component="span">{children}</Box>
    </Box>
  );
}

/** Actions stack: anchored at the bottom of the column on mobile (thumb reach). */
export function ReceiveActions({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.25, md: 1.5 }, mt: { xs: 'auto', md: 0 } }}>
      {children}
    </Box>
  );
}

type CtaTier = 'primary' | 'secondary' | 'strong';

/** S8-C4 — keyboard-only focus ring (the accent outline used by Receive choice buttons). */
export const receiveFocusRingSx = {
  '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
} as const;

/** S8-C4 — 44px minimum touch target on mobile; desktop keeps its compact size. */
export const receiveTouchTargetSx = { minHeight: { xs: 44, md: 0 } } as const;

export function receiveCtaSx(tier: CtaTier): SxProps<Theme> {
  const base = {
    width: '100%',
    height: { xs: 52, md: 56 },
    borderRadius: '10px',
    fontSize: { xs: 15, md: 16 },
    fontWeight: 500,
    textTransform: 'none',
    boxShadow: 'none',
    gap: 1,
    ...receiveFocusRingSx,
  } as const;
  if (tier === 'primary') {
    return {
      ...base,
      bgcolor: 'var(--accent)',
      color: 'var(--accent-ink)',
      '&:hover': { bgcolor: 'var(--accent-hover, var(--accent))', boxShadow: 'none' },
      '&.Mui-disabled': { bgcolor: 'var(--surface)', color: 'var(--ink-4)', border: '1.5px dashed var(--rule-2)' },
    };
  }
  return {
    ...base,
    bgcolor: 'var(--surface)',
    color: 'var(--ink)',
    border: tier === 'strong' ? '1.5px solid var(--ink)' : '1px solid var(--rule-2)',
    '&:hover': { bgcolor: 'var(--bg-2)', borderColor: tier === 'strong' ? 'var(--ink)' : 'var(--rule-2)' },
    '&.Mui-disabled': { color: 'var(--ink-4)', borderStyle: 'dashed' },
  };
}

export function ReceiveCta({ tier = 'primary', sx, ...props }: ButtonProps & { tier?: CtaTier }) {
  return (
    <Button
      variant={tier === 'primary' ? 'contained' : 'outlined'}
      // Accent fill comes from the tokens, never the MUI palette primary.
      color="inherit"
      disableElevation
      {...props}
      sx={[receiveCtaSx(tier), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
    />
  );
}

/** Tertiary text action under the primary CTA. */
export function ReceiveTextAction({ sx, ...props }: ButtonProps) {
  return (
    <Button
      variant="text"
      color="inherit"
      {...props}
      sx={[
        { alignSelf: 'center', minHeight: { xs: 44, md: 32 }, fontSize: 14, fontWeight: 500, textTransform: 'none', color: 'var(--ink-2)', ...receiveFocusRingSx },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}

/** Neutral footer button (e.g. "PO lines · 3"). */
export function ReceiveFooterButton({ sx, ...props }: ButtonProps) {
  return (
    <Button
      variant="outlined"
      color="inherit"
      {...props}
      sx={[
        {
          height: 38,
          px: 1.75,
          borderRadius: '8px',
          borderColor: 'var(--rule-2)',
          bgcolor: 'var(--surface)',
          color: 'var(--ink)',
          fontSize: 13,
          fontWeight: 500,
          textTransform: 'none',
          ...receiveTouchTargetSx,
          ...receiveFocusRingSx,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}

/**
 * Count-screen product image: the line's own image_url, centred and contained
 * (never cropped). A missing or broken image falls back to a compact neutral
 * tile; no stock or placeholder photography.
 */
export function ReceiveProductImage({ src }: { src: string | null | undefined }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const shown = !!src && !broken;
  return (
    <Box
      data-testid="receive-product-image"
      sx={{
        alignSelf: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: shown ? { xs: 132, md: 184 } : { xs: 64, md: 80 },
        height: shown ? { xs: 132, md: 184 } : { xs: 64, md: 80 },
        p: shown ? 1 : 0,
        border: '1px solid var(--rule-2)',
        borderRadius: '12px',
        bgcolor: 'var(--surface)',
        flexShrink: 0,
      }}
    >
      {shown ? (
        <Box
          component="img"
          src={src!}
          alt=""
          onError={() => setBroken(true)}
          sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '6px', display: 'block' }}
        />
      ) : (
        <Package size={24} style={{ opacity: 0.4 }} aria-hidden="true" />
      )}
    </Box>
  );
}

/** Product line: thumbnail, name and mono identity, centred. */
export function ReceiveItemLine({
  name,
  identity,
  media,
}: {
  name: ReactNode;
  identity?: ReactNode;
  media?: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, textAlign: 'left', minWidth: 0 }}>
      {media}
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 500, overflowWrap: 'anywhere' }}>{name}</Typography>
        {identity ? (
          <Typography component="div" sx={{ ...receiveMonoSx, fontSize: 12, letterSpacing: '0.04em', color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>
            {identity}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

/** Three-up fact strip (EXPECTED / SELLABLE / TO ACCOUNT FOR …). Labels stay one text node each. */
export function ReceiveFactStrip({ facts }: { facts: Array<{ label: string; value: ReactNode; highlight?: boolean }> }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))`,
        border: '1px solid var(--rule-2)',
        borderRadius: '12px',
        bgcolor: 'var(--surface)',
      }}
    >
      {facts.map((fact, index) => (
        <Box key={fact.label} sx={{ px: { xs: 1.25, md: 1.75 }, py: { xs: 1, md: 1.25 }, display: 'grid', gap: '2px', borderLeft: index === 0 ? 0 : '1px solid var(--rule)' }}>
          <Typography component="span" sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            {fact.label}
          </Typography>
          <Typography component="span" sx={{ ...receiveMonoSx, fontSize: { xs: 18, md: 22 }, fontWeight: 500, color: fact.highlight ? 'var(--accent-text)' : 'var(--ink)' }}>
            {fact.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function ReceivePill({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok'; children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        gap: 0.75,
        alignItems: 'center',
        fontSize: 12,
        fontWeight: 500,
        borderRadius: '100px',
        px: 1.25,
        py: '5px',
        bgcolor: tone === 'ok' ? 'var(--good-ghost, var(--bg-2))' : 'var(--bg-2)',
        color: tone === 'ok' ? 'var(--good-ink)' : 'var(--ink-2)',
        '& b': { ...receiveMonoSx, fontWeight: 600 },
      }}
    >
      {children}
    </Box>
  );
}

export function ReceivePillRow({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, justifyContent: 'center' }}>{children}</Box>;
}

/** Completion audit seal: STATUS / CLOSED AT / ACTUAL DELIVERY. */
export function ReceiveSeal({ facts }: { facts: Array<{ label: string; value: ReactNode }> }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))`,
        border: '1px solid var(--rule-2)',
        borderRadius: '12px',
        bgcolor: 'var(--surface)',
      }}
    >
      {facts.map((fact, index) => (
        <Box key={fact.label} sx={{ px: 1.75, py: 1.5, display: 'grid', gap: '2px', borderLeft: index === 0 ? 0 : '1px solid var(--rule)', minWidth: 0 }}>
          <Typography component="span" sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            {fact.label}
          </Typography>
          <Typography component="span" sx={{ ...receiveMonoSx, fontSize: { xs: 12.5, md: 14 }, fontWeight: 500, overflowWrap: 'anywhere' }}>
            {fact.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** One-tap PO-lines / Products drawer. keepMounted preserves the DOM where the old rail was always rendered. */
export function ReceiveLinesDrawer({
  open,
  title,
  onClose,
  keepMounted = true,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  keepMounted?: boolean;
  children: ReactNode;
}) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted }}
      sx={{ zIndex: 1400 }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': title,
          sx: {
            width: { xs: '100%', sm: 420 },
            bgcolor: 'var(--bg)',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, borderBottom: '1px solid var(--rule)' }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{title}</Typography>
        <ReceiveFooterButton onClick={onClose}>Close</ReceiveFooterButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.5 }}>{children}</Box>
    </Drawer>
  );
}

/** UX-14 — list page size for Brief / Review (pages after six lines). */
export const RECEIVE_LIST_PAGE_SIZE = 6;

/**
 * UX-14 — compact pager for Brief / Review line lists. Presentation state
 * only: callers keep totals and gates on the full list.
 */
export function ReceiveListPager({
  page,
  total,
  onPage,
  label,
  pageSize = RECEIVE_LIST_PAGE_SIZE,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
  pageSize?: number;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const first = page * pageSize + 1;
  const last = Math.min(total, first + pageSize - 1);
  return (
    <Box
      component="nav"
      aria-label={label}
      sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center', gap: 1 }}
    >
      <ReceiveFooterButton aria-label="Previous lines" disabled={page === 0} onClick={() => onPage(page - 1)} sx={{ height: 32, minWidth: { xs: 44, md: 32 }, px: 1.25 }}>
        ‹
      </ReceiveFooterButton>
      <Typography role="status" aria-live="polite" sx={{ textAlign: 'center', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>
        {`Lines ${first}–${last} of ${total}`}
      </Typography>
      <ReceiveFooterButton aria-label="Next lines" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)} sx={{ height: 32, minWidth: { xs: 44, md: 32 }, px: 1.25 }}>
        ›
      </ReceiveFooterButton>
    </Box>
  );
}

/**
 * WS-UX-RECEIVE-D4R S7 — V3.1 "Leave receiving" sheet: centred card on
 * desktop, bottom sheet on mobile. Escape and backdrop call onDismiss, which
 * callers only provide when dismissing is safe (it means "keep receiving");
 * without it neither can close the sheet or bypass unsaved-work protection.
 */
export function ReceiveExitSheet({
  open,
  eyebrow,
  eyebrowTone = 'accent',
  title,
  accent,
  body,
  busy = false,
  onDismiss,
  children,
}: {
  open: boolean;
  eyebrow: string;
  eyebrowTone?: 'accent' | 'error';
  title: string;
  accent: string;
  body: ReactNode;
  busy?: boolean;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onDismiss ? () => onDismiss() : undefined}
      disableEscapeKeyDown={!onDismiss}
      aria-labelledby="receive-exit-sheet-title"
      sx={{ zIndex: 1450, '& .MuiDialog-container': { alignItems: { xs: 'flex-end', md: 'center' } } }}
      slotProps={{
        paper: {
          sx: {
            m: { xs: 0, md: 4 },
            width: { xs: '100%', md: 480 },
            maxWidth: { xs: '100%', md: 480 },
            borderRadius: { xs: '18px 18px 0 0', md: '16px' },
            bgcolor: 'var(--surface)',
            backgroundImage: 'none',
            px: { xs: 2, md: 3.5 },
            pt: { xs: 3, md: 3.5 },
            pb: { xs: 'max(34px, env(safe-area-inset-bottom, 0px))', md: 3.5 },
            display: 'grid',
            gap: 1.5,
            textAlign: 'center',
          },
        },
      }}
    >
      <Typography
        component="div"
        sx={{
          fontSize: 11, fontWeight: 500, lineHeight: 1, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: eyebrowTone === 'error' ? 'var(--critical-text)' : 'var(--accent-text)',
        }}
      >
        {eyebrow}
      </Typography>
      <Typography id="receive-exit-sheet-title" component="h2" sx={{ m: 0, fontSize: 30, fontWeight: 400, lineHeight: 1.1, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
        {title} <Box component="em" sx={{ fontStyle: 'italic', color: 'var(--accent)' }}>{accent}</Box>
      </Typography>
      <Box sx={{ fontSize: { xs: 14, md: 16 }, fontWeight: 300, lineHeight: 1.5, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{body}</Box>
      {busy && (
        <LinearProgress
          aria-label="Saving"
          sx={{ width: 200, justifySelf: 'center', height: 3, borderRadius: '2px', bgcolor: 'var(--bg-3)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' } }}
        />
      )}
      <Box sx={{ display: 'grid', gap: 1.25, mt: 0.5 }}>{children}</Box>
    </Dialog>
  );
}
