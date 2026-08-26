import fs from 'fs';
import path from 'path';

type AxiosLikeError = {
  response?: {
    status?: number;
    data?: {
      error?: unknown;
    };
  };
};

type EntitlementDenialModule = {
  isEntitlementDenial: (error: unknown) => boolean;
};

const TARGET_FILES = [
  'apps/frontend/src/components/ExportDrawer.tsx',
  'apps/frontend/src/pages/ft2-pages/ShopSettingsReportsPage.tsx',
] as const;

const RETRY_EXPORT_ERROR_PATTERN = /setError\(\s*(['"`])Export failed\s+.\s+please try again\.\1\s*\)/;
const ENTITLEMENT_HELPER_IMPORT_PATTERN = /from\s+['"]api\/entitlementDenial['"]/;

function axiosLike(status: number, error?: unknown): AxiosLikeError {
  return {
    response: {
      status,
      data: error === undefined ? {} : { error },
    },
  };
}

async function loadHelper(): Promise<EntitlementDenialModule> {
  return import('api/entitlementDenial') as Promise<EntitlementDenialModule>;
}

function scanTarget(file: string) {
  const absolutePath = path.join(process.cwd(), file);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const lines = source.split('\n');
  const genericExportErrors = lines
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter(({ text }) => RETRY_EXPORT_ERROR_PATTERN.test(text));

  return {
    file,
    importsEntitlementHelper: ENTITLEMENT_HELPER_IMPORT_PATTERN.test(source),
    genericExportErrors,
  };
}

describe('CONTRACT-ENT-DENIAL-01 entitlement denial classifier', () => {
  it('classifies tier/commercial upgrade denials and rejects non-tier 403s', async () => {
    const { isEntitlementDenial } = await loadHelper();

    for (const code of [
      'TIER_INSUFFICIENT',
      'TIER_INSUFFICIENT_FIELD',
      'COLUMN_SELECTION_REQUIRES_GROWTH',
      'SEAT_LIMIT_REACHED',
      'SHIPPED_ORDER_CAP_REACHED',
    ]) {
      expect(isEntitlementDenial(axiosLike(403, code))).toBe(true);
    }

    for (const value of [
      axiosLike(403, 'OVERAGE_DISABLED'),
      axiosLike(403, 'ACTION_FORBIDDEN'),
      axiosLike(403, 'NO_ROLE_ASSIGNED'),
      axiosLike(403, 'Batch not owned by this operator'),
      axiosLike(403, 'SESSION_COMPROMISED'),
      axiosLike(403),
      axiosLike(401, 'TIER_INSUFFICIENT'),
      axiosLike(500, 'TIER_INSUFFICIENT'),
      undefined,
      null,
      {},
      { request: {} },
    ]) {
      expect(isEntitlementDenial(value)).toBe(false);
    }
  });
});

describe('CONTRACT-ENT-DENIAL-02 export catches use entitlement denial helper', () => {
  it('does not set retry-suggesting export errors without importing api/entitlementDenial', () => {
    const matches = TARGET_FILES.map(scanTarget);

    console.log('CONTRACT-ENT-DENIAL-02_MATCHES', JSON.stringify(matches, null, 2));

    for (const match of matches) {
      expect(match.genericExportErrors).not.toEqual([]);
    }

    const violations = matches.filter(
      (match) => match.genericExportErrors.length > 0 && !match.importsEntitlementHelper
    );

    expect(violations).toEqual([]);
  });
});
