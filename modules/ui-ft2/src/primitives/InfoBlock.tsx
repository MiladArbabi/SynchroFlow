// InfoBlock.tsx
// -------------
// FT2 narrative grouping primitive.
// No semantics. No inference.

import { ReactNode } from 'react';
import {
  InfoBlockContainer,
  InfoBlockHeader,
  InfoBlockBody,
} from './InfoBlock.styles.js';

export interface InfoBlockProps {
  title: string;
  children: ReactNode;
}

export function InfoBlock({ title, children }: InfoBlockProps) {
  return (
    <InfoBlockContainer>
      <InfoBlockHeader>{title}</InfoBlockHeader>
      <InfoBlockBody>{children}</InfoBlockBody>
    </InfoBlockContainer>
  );
}
