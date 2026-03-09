/**
 * PanelFooter
 * -----------
 * Interpretation rail for FT2Panel.
 *
 * Replaces InfoBlockFooter.
 *
 * Responsibilities:
 *  - render contextual interpretation lines
 *  - provide visual separation from panel rows
 *
 * No layout logic.
 * No business semantics.
 */

import { styled } from '@mui/material/styles';

export interface PanelFooterProps {
  line1: string;
  line2?: string;
}

export function PanelFooter({ line1, line2 }: PanelFooterProps) {
  return (
    <FooterContainer data-ft2-panel-footer>
      <div>{line1}</div>
      {line2 && <div>{line2}</div>}
    </FooterContainer>
  );
}

/**
 * Styled primitive
 */

const FooterContainer = styled('div')({
  padding: '8px 14px',

  background: 'var(--ft2-infoblock-footer-bg)',

  borderTop: '1px solid var(--ft2-infoblock-border)',

  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 10,
  lineHeight: '14px',

  color: 'var(--ft2-infoblock-footer-text)',

  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});