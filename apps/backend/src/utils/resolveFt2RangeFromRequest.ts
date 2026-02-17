// apps/backend/src/utils/resolveFt2RangeFromRequest.ts

import { FT2DateRangePreset, FT2RangeInput } from '@lasyncro/backend-core/utils/ft2Period.js';

export function resolveFt2RangeFromRequest(req: any): FT2RangeInput {
  const preset = req.query.preset as FT2DateRangePreset | undefined;

  if (!preset) {
    return 'past_30_days';
  }

  if (preset === 'custom') {
    return {
      preset: 'custom',
      from: String(req.query.from),
      to: String(req.query.to),
    };
  }

  return preset;
}