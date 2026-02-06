import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type ProductsDependencyInfoBlockProps = {
  surface: 'isolated' | 'coupled' | 'unknown' | null;
  blastRadius: 'contained' | 'wide' | 'unknown' | null;
};

export function ProductsDependencyInfoBlock({
  surface,
  blastRadius,
}: ProductsDependencyInfoBlockProps) {
  return (
    <InfoBlock title="Dependency surface">
      <InfoBlockRow
        label="Dependency surface"
        value={surface}
      />

      <InfoBlockRow
        label="Blast radius"
        value={blastRadius}
      />

      <InfoBlockFooter
        line1="> DEPENDENCY EXPOSURE SHOWN"
        line2="> IMPACT ASSESSMENT IS USER-INFERRED"
      />
    </InfoBlock>
  );
}
