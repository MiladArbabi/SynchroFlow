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

/**
 * Development mode detection
 * --------------------------
 * Used for runtime instrumentation without affecting production builds.
 */
const __DEV__ =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

/**
 * InfoBlockProps
 * --------------
 * Narrative primitive wrapper.
 *
 * IMPORTANT:
 * Layout is controlled by FT2Surface and FT2Row.
 * InfoBlock must remain presentation-only.
 */
export interface InfoBlockProps {
  title: string;
  children: ReactNode;

  /**
   * Optional styling hook for host surfaces.
   */
  className?: string;

  /**
   * Optional test / instrumentation attribute.
   */
  'data-testid'?: string;
}

export function InfoBlock({
  title,
  children,
  className,
  'data-testid': testId,
}: InfoBlockProps) {

  /**
   * Development guard
   * -----------------
   * InfoBlock represents a single narrative unit.
   * Nested InfoBlocks indicate a layout misuse.
   */
  if (__DEV__) {
    const hasNestedInfoBlock =
      Array.isArray(children) &&
      children.some(
        (child: any) =>
          child?.type?.name === 'InfoBlock' ||
          child?.type?.displayName === 'InfoBlock'
      );

    if (hasNestedInfoBlock) {
      console.warn(
        '[InfoBlock] Nested InfoBlocks detected. ' +
        'Use FT2Surface or FT2Row for layout composition.'
      );
    }
  }

  return (
    <InfoBlockContainer
      className={className}
      data-testid={testId}
      data-ft2-infoblock
    >
      <InfoBlockHeader>{title}</InfoBlockHeader>
      <InfoBlockBody>{children}</InfoBlockBody>
    </InfoBlockContainer>
  );
}
