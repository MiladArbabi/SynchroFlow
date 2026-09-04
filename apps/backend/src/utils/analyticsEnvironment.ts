export function shouldEnableBackendAnalytics(
  env: NodeJS.ProcessEnv
): boolean {
  return (
    env.NODE_ENV === 'production' &&
    env.ANALYTICS_PRODUCTION_ENABLED === 'true' &&
    Boolean(env.POSTHOG_API_KEY)
  );
}
