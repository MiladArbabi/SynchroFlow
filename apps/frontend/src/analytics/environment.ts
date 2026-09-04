export const APP_PRODUCTION_ANALYTICS_HOST = 'app.lasyncro.com';

export interface FrontendAnalyticsEnvironment {
  hostname: string;
  mode: string;
}

export function shouldEnableFrontendAnalytics({
  hostname,
  mode,
}: FrontendAnalyticsEnvironment): boolean {
  return mode === 'production' && hostname === APP_PRODUCTION_ANALYTICS_HOST;
}
