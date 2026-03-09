import {
  PanelRow,
  PanelFooter,
} from '@lasyncro/ui-ft2';

type ProductsOperationalInfoBlockProps = {
  inventory: 'ok' | 'gaps' | 'unknown' | null;
  fulfillment: 'visible' | 'missing' | 'unknown' | null;
  stability: 'stable' | 'fragile' | 'unknown' | null;
};

export function ProductsOperationalInfoBlock({
  inventory,
  fulfillment,
  stability,
}: ProductsOperationalInfoBlockProps) {
  return (
    <>
      <PanelRow
        label="Inventory visibility"
        value={inventory}
      />

      <PanelRow
        label="Fulfillment visibility"
        value={fulfillment}
      />

      <PanelRow
        label="Operational stability"
        value={stability}
      />

      <PanelFooter
        line1="> OPERATIONAL SIGNALS SHOWN"
        line2="> EXECUTION DETAILS SHOWN ELSEWHERE"
      />
    </>
  );
}
