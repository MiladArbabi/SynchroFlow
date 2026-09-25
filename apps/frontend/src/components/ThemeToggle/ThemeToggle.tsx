// apps/frontend/src/components/ThemeToggle/ThemeToggle.tsx
//
// GH-1158 — the single theme control, living in the sidenav footer.
//
// Theme authority is unchanged: MUI useColorScheme(). This component only
// reads the resolved scheme and calls setMode('light' | 'dark') — exactly what
// the retired top-nav Sun/Moon buttons did. No storage, no data-theme writes.
//
//   row  — expanded sidenav: full-width "Dark mode" row with an animated switch
//   icon — compact sidenav: icon-sized control in the same footer position
//
// Motion: knob travel + sun→moon morph on SHELL_MOTION; keyboard focus draws an
// accent ring (ButtonBase's focus-visible class), pointer focus draws nothing;
// prefers-reduced-motion drops every transition to zero.

import { ButtonBase, Tooltip } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { REDUCED_MOTION_QUERY, shellTransition } from './shellMotion';

export type ThemeToggleVariant = 'row' | 'icon';

const RAYS: ReadonlyArray<readonly [number, number, number, number]> = [
  [12, 2, 12, 4], [12, 20, 12, 22], [4.93, 4.93, 6.34, 6.34], [17.66, 17.66, 19.07, 19.07],
  [2, 12, 4, 12], [20, 12, 22, 12], [6.34, 17.66, 4.93, 19.07], [19.07, 4.93, 17.66, 6.34],
];

/** Sun whose rays retract as it rotates out while the moon rotates in. */
function ThemeMorphIcon({ size }: { size: number | string }) {
  return (
    <svg
      className="ls-theme-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <g className="ls-theme-sun">
        <circle cx="12" cy="12" r="4" />
        <g className="ls-theme-rays">
          {RAYS.map(([x1, y1, x2, y2], i) => (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              style={{ transitionDelay: `${i * 25}ms` }}
            />
          ))}
        </g>
      </g>
      <path className="ls-theme-moon" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

// Switch geometry (reference "sm" size): 44 × 24 track, 2px knob inset.
const TRACK_W = 44;
const TRACK_H = 24;
const KNOB_INSET = 2;
const KNOB = TRACK_H - 2 * KNOB_INSET - 2; // track border is 1px each side

const morphSx = {
  '& .ls-theme-icon': {
    display: 'block', overflow: 'visible', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
  },
  '& .ls-theme-sun, & .ls-theme-moon, & .ls-theme-rays line': {
    transformBox: 'view-box',
    transformOrigin: '12px 12px',
    transition: `${shellTransition('transform')}, opacity 250ms ease`,
  },
  '& .ls-theme-moon': { opacity: 0, transform: 'rotate(-70deg) scale(.5)' },
  '&[data-state="dark"] .ls-theme-sun': { opacity: 0, transform: 'rotate(90deg) scale(.55)' },
  '&[data-state="dark"] .ls-theme-rays line': { opacity: 0, transform: 'scale(.3)' },
  '&[data-state="dark"] .ls-theme-moon': { opacity: 1, transform: 'none', transitionDelay: '60ms' },
} as const;

const reducedMotionSx = {
  [`@media ${REDUCED_MOTION_QUERY}`]: {
    '&, & *': { transitionDuration: '0s !important', transitionDelay: '0s !important' },
  },
} as const;

export function ThemeToggle({ variant }: { variant: ThemeToggleVariant }) {
  const { mode, systemMode, setMode } = useColorScheme();
  const resolved = mode === 'system' ? systemMode : mode;
  const isDark = resolved === 'dark';
  const toggle = () => setMode(isDark ? 'light' : 'dark');

  const common = {
    role: 'switch',
    'aria-checked': isDark,
    'aria-label': 'Dark mode',
    'data-state': isDark ? 'dark' : 'light',
    disableRipple: true,
    onClick: toggle,
  } as const;

  if (variant === 'icon') {
    return (
      <Tooltip
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        placement="right"
        arrow
        describeChild
      >
        <ButtonBase
          {...common}
          sx={{
            ...morphSx,
            width: 36, height: 36, borderRadius: '8px', flexShrink: 0,
            color: 'var(--ink-3)',
            outline: 'none',
            transition: 'background 150ms ease, color 150ms ease',
            '&:hover': { bgcolor: 'var(--bg-2)', color: 'var(--ink)' },
            '&.Mui-focusVisible': { boxShadow: 'inset 0 0 0 2px var(--accent)' },
            ...reducedMotionSx,
          }}
        >
          <ThemeMorphIcon size={20} />
        </ButtonBase>
      </Tooltip>
    );
  }

  return (
    <ButtonBase
      {...common}
      sx={{
        ...morphSx,
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 1.25,
        pl: 1.5, pr: 1.25, py: 0.75,
        borderRadius: '8px',
        color: 'var(--ink-3)',
        outline: 'none',
        transition: 'background 150ms ease, color 150ms ease',
        '&:hover': { bgcolor: 'var(--bg-2)', color: 'var(--ink)' },
        '&:hover .ls-theme-track': { borderColor: 'var(--accent-border)' },
        '&.Mui-focusVisible': { boxShadow: 'inset 0 0 0 2px var(--accent)' },
        '& .ls-theme-track': {
          position: 'relative', flex: 'none',
          width: TRACK_W, height: TRACK_H, borderRadius: '100px',
          bgcolor: 'var(--bg-2)',
          border: '1px solid var(--rule-2)',
          transition: 'background 300ms ease, border-color 150ms ease',
        },
        '& .ls-theme-knob': {
          position: 'absolute', top: KNOB_INSET, left: KNOB_INSET,
          width: KNOB, height: KNOB, borderRadius: '50%',
          display: 'grid', placeItems: 'center',
          bgcolor: 'var(--surface)',
          color: 'var(--ink-3)',
          boxShadow: '0 1px 2px rgba(15,14,13,.14)',
          transition: `${shellTransition('transform')}, background 300ms ease, color 300ms ease`,
        },
        '&[data-state="dark"] .ls-theme-knob': {
          transform: `translateX(${TRACK_W - TRACK_H}px)`,
          bgcolor: 'var(--bg)',
          color: 'var(--ink)',
          boxShadow: '0 1px 3px rgba(0,0,0,.4)',
        },
        ...reducedMotionSx,
      }}
    >
      <span style={{ fontSize: 13, lineHeight: 1.4, color: 'inherit' }}>Dark mode</span>
      <span className="ls-theme-track" aria-hidden="true">
        <span className="ls-theme-knob">
          <ThemeMorphIcon size="64%" />
        </span>
      </span>
    </ButtonBase>
  );
}
