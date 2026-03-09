import {
  PanelRow,
  PanelFooter,
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
    <>
      <PanelRow
        label="Dependency surface"
        value={surface}
      />

      <PanelRow
        label="Blast radius"
        value={blastRadius}
      />

      <PanelFooter
        line1="> DEPENDENCY EXPOSURE SHOWN"
        line2="> IMPACT ASSESSMENT IS USER-INFERRED"
      />
    </>
  );
}
