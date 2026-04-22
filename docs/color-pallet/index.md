The final palette — all tokens
Space dark
#151D29
Space mid
#1C2740
Space surface
#243050
Orange
#FF6B2B
Orange light
#FF8C5A
Orange ghost
#FFF0E8
Paper
#FAFAF8
Paper-2
#F3F2EF
Rule
#E8E6E0
Ink
#0F0E0D
Ink-muted
#6B7280
Ink-hint
#9CA3AF
Click any swatch to copy the hex value.

CSS variables — the complete root block
This replaces everything in both your current root blocks. Copy this once, use everywhere — landing page, app, emails, docs.

Light + dark mode CSSCopy
/* ── LaSyncro design tokens ── */
:root {
  /* Accent — orange */
  --accent:        #FF6B2B;
  --accent-hover:  #FF8C5A;
  --accent-ghost:  #FFF0E8;
  --accent-border: #FFDCCA;

  /* Background — light mode */
  --bg:            #FAFAF8;
  --bg-2:          #F3F2EF;
  --bg-3:          #E8E6E0;
  --surface:       #FFFFFF;

  /* Ink — light mode */
  --ink:           #0F0E0D;
  --ink-2:         #3A3835;
  --ink-3:         #6B7280;
  --ink-4:         #9CA3AF;

  /* Rule / border */
  --rule:          #E8E6E0;
  --rule-2:        #D1CFC8;

  /* Space dark (dark mode backgrounds) */
  --space-1:       #151D29;
  --space-2:       #1C2740;
  --space-3:       #243050;
  --space-4:       #2E3D62;

  /* Typography */
  --serif: 'Instrument Serif', Georgia, serif;
  --sans:  'DM Sans', system-ui, sans-serif;
}

/* ── Dark mode override ── */
@media (prefers-color-scheme: dark) {
  :root {
    --bg:      #151D29;
    --bg-2:    #1C2740;
    --bg-3:    #243050;
    --surface: #1C2740;

    --ink:     #F0EEE8;
    --ink-2:   #C8C4BB;
    --ink-3:   #8B8F9A;
    --ink-4:   #5A5F6E;

    --rule:    rgba(255,255,255,0.08);
    --rule-2:  rgba(255,255,255,0.14);

    /* Accent stays identical in both modes */
    --accent-ghost:  rgba(255,107,43,0.12);
    --accent-border: rgba(255,107,43,0.25);
  }
}
The accent (orange) is identical in light and dark mode — it's already warm enough to read on both white and space-dark. Never adjust the orange per mode. Everything else flips via the media query.
Usage rules — what goes where
Element	Light mode token	Dark mode token	Notes
Page background	--bg	--bg	Auto-switches
Card / surface	--surface	--surface	Cards, inputs, modals
Primary CTA button	--accent	--accent	Never change this per mode
CTA hover	--accent-hover	--accent-hover	Lighten, not darken
Accent badge bg	--accent-ghost	--accent-ghost	rgba version in dark
Hero / dark sections	--space-1	--space-1	Same in both — intentionally dark
Body text	--ink	--ink	Auto-switches
Secondary text	--ink-3	--ink-3	Captions, hints, metadata
Dividers / borders	--rule	--rule	Auto-switches