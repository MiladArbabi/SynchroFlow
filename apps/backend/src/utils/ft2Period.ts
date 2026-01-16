// apps/backend/src/utils/ft2Period.ts

export type FT2DateRangePreset =
  | 'today'
  | 'this_week'
  | 'last_week'
  | 'past_7_days'
  | 'this_month'
  | 'last_month'
  | 'past_30_days';

export function resolveFt2PeriodFromPreset(input: {
  preset: FT2DateRangePreset;
}): { from: string; to: string } {
  const now = new Date();

  const to = new Date(now);
  let from = new Date(now);

  switch (input.preset) {
    case 'today': {
      from.setUTCHours(0, 0, 0, 0);
      to.setUTCHours(23, 59, 59, 999);
      break;
    }

    case 'past_7_days': {
      from.setUTCDate(from.getUTCDate() - 7);
      break;
    }

    case 'past_30_days': {
      from.setUTCDate(from.getUTCDate() - 30);
      break;
    }

    case 'this_week': {
      const day = from.getUTCDay(); // 0 = Sunday
      const diff = day === 0 ? 6 : day - 1;
      from.setUTCDate(from.getUTCDate() - diff);
      from.setUTCHours(0, 0, 0, 0);
      break;
    }

    case 'last_week': {
      const day = from.getUTCDay();
      const diff = day === 0 ? 6 : day - 1;
      from.setUTCDate(from.getUTCDate() - diff - 7);
      from.setUTCHours(0, 0, 0, 0);
      to.setUTCDate(from.getUTCDate() + 6);
      to.setUTCHours(23, 59, 59, 999);
      break;
    }

    case 'this_month': {
      from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      break;
    }

    case 'last_month': {
      from = new Date(
        Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1)
      );
      to.setUTCDate(0); // last day of previous month
      to.setUTCHours(23, 59, 59, 999);
      break;
    }

    default:
      throw new Error(`Unsupported FT2 preset: ${input.preset}`);
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export function getFt2Period() {
  return resolveFt2PeriodFromPreset({ preset: 'past_30_days' });
}