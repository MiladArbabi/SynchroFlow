//apps/backend/src/onboarding/utils/deriveKnownCount.ts
export function deriveKnownCount(rawCount: unknown) {
  const count = Number(rawCount);

  if (!Number.isFinite(count)) {
    return {
      known: false,
      count: null,
      usageCount: 0,
    };
  }

  return {
    known: true,
    count,
    usageCount: count,
  };
}
