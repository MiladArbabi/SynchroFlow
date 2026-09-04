export type AnalyticsEnvironment = Pick<
  NodeJS.ProcessEnv,
  'NODE_ENV' | 'ANALYTICS_PRODUCTION_ENABLED' | 'POSTHOG_API_KEY'
>;

export function shouldEnableBackendAnalytics(
  env: AnalyticsEnvironment
): boolean {
  return (
    env.NODE_ENV === 'production' &&
    env.ANALYTICS_PRODUCTION_ENABLED === 'true' &&
    Boolean(env.POSTHOG_API_KEY)
  );
}
