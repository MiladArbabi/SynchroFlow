import fs from 'fs';
import path from 'path';
import { CAPABILITY_PRESENTATION } from '../../../../apps/frontend/src/commercial/capabilityPresentation';

const approvedPresentation = {
  'purchasing.sourcing': {
    featureName: 'Sourcing',
    benefits: [
      'Prioritize sourcing work from current inventory demand',
      'Compare supplier recommendations by product',
      'Use supplier-product preferences',
      'Accumulate reorder quantities against MOQ',
    ],
  },
  'demand.forecasting': {
    featureName: 'Demand',
    benefits: [
      'Identify SKUs at critical stockout risk',
      'Prioritize reorders using recent sales velocity and days of stock',
      'See suggested reorder quantities for urgent products',
      'Move from demand signals directly into purchasing and warehouse context',
    ],
  },
  'warehouse.floor_planning': {
    featureName: 'Floor Planning',
    benefits: [
      'Map warehouse bins, zones, and current occupancy',
      'See where a product is stored across warehouse locations',
      'Create and manage warehouse zones and locations',
      'Generate and print location and product barcode labels',
    ],
  },
  'warehouse.analytics': {
    featureName: 'Warehouse Analytics',
    benefits: [
      'Track operator pace and accuracy across pick and pack',
      'Monitor pipeline velocity, throughput, and aging work in progress',
      'Identify exception-heavy operators and SKUs',
      'Understand warehouse cost and capacity signals',
    ],
  },
  'returns.analysis': {
    featureName: 'Supplier Ratings',
    benefits: [
      'Compare suppliers by return rate across received stock',
      'Spot suspect batches with unusually high return rates',
      'See returned vs received units and affected SKUs',
      'Identify suppliers that may need a credit or quality review',
    ],
  },
};

const frontendRoot = path.join(process.cwd(), 'apps/frontend/src');
const registryPath = path.join(frontendRoot, 'commercial/capabilityPresentation.ts');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

it('the presentation registry contains all five approved canonical definitions exactly', () => {
  expect(CAPABILITY_PRESENTATION).toEqual(approvedPresentation);
});

it('the frontend presentation registry is the single production owner of all approved benefits, including unchanged Sourcing benefits', () => {
  const sources = sourceFiles(frontendRoot).map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));
  const benefits = Object.values(approvedPresentation).flatMap((presentation) => presentation.benefits);

  for (const benefit of benefits) {
    const occurrences = sources.flatMap(({ file, source }) =>
      Array.from({ length: source.split(benefit).length - 1 }, () => file),
    );
    expect(occurrences).toEqual([registryPath]);
  }
});
