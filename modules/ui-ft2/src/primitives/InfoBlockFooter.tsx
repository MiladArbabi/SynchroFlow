// InfoBlockFooter.tsx
// -------------------
// Interpretation Rail (FT2-adjacent).
// Copy-only. No logic.
import { InfoBlockFooterContainer } from './InfoBlock.styles';

export interface InfoBlockFooterProps {
  line1: string;
  line2?: string;
}

export function InfoBlockFooter({ line1, line2 }: InfoBlockFooterProps) {
  return (
    <InfoBlockFooterContainer>
      <div>{line1}</div>
      {line2 && <div>{line2}</div>}
    </InfoBlockFooterContainer>
  );
}
