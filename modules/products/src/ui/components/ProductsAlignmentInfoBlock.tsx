import {
  PanelRow,
  PanelFooter,
} from '@lasyncro/ui-ft2';

type ProductsAlignmentInfoBlockProps = {
  alignment: 'aligned' | 'misaligned' | 'unknown' | null;
};

export function ProductsAlignmentInfoBlock({
  alignment,
}: ProductsAlignmentInfoBlockProps) {
  return (
    <>
      <PanelRow
        label="Reality agreement"
        value={alignment}
      />

      <PanelFooter
        line1="> MULTI-DOMAIN CONSISTENCY CHECK"
        line2="> SIGNAL ONLY — NO INTERPRETATION"
      />
    </>
  );
}
