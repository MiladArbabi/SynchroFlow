import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type ProductsAlignmentInfoBlockProps = {
  alignment: 'aligned' | 'misaligned' | 'unknown' | null;
};

export function ProductsAlignmentInfoBlock({
  alignment,
}: ProductsAlignmentInfoBlockProps) {
  return (
    <InfoBlock title="Cross-domain alignment">
      <InfoBlockRow
        label="Reality agreement"
        value={alignment}
      />

      <InfoBlockFooter
        line1="> MULTI-DOMAIN CONSISTENCY CHECK"
        line2="> SIGNAL ONLY — NO INTERPRETATION"
      />
    </InfoBlock>
  );
}
