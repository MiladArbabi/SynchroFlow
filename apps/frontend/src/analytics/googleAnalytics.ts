import { shouldEnableFrontendAnalytics } from './environment';

export const GA4_ID = 'G-1H3XLN9MN2';
export const ANALYTICS_CONSENT_COOKIE = 'lasyncro_analytics_consent';

export type AnalyticsConsent = 'granted' | 'denied' | null;

function isProductionRuntime(): boolean {
  return shouldEnableFrontendAnalytics({
    hostname: window.location.hostname,
    mode: import.meta.env.MODE,
  });
}

export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof document === 'undefined') return null;

  const prefix = `${ANALYTICS_CONSENT_COOKIE}=`;
  const value = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);

  return value === 'granted' || value === 'denied' ? value : null;
}

export function setAnalyticsConsent(value: Exclude<AnalyticsConsent, null>): void {
  if (!isProductionRuntime()) return;

  document.cookie =
    `${ANALYTICS_CONSENT_COOKIE}=${value}; ` +
    'Max-Age=31536000; Path=/; Domain=.lasyncro.com; SameSite=Lax; Secure';

  window.dispatchEvent(
    new CustomEvent('lasyncro:analytics-consent', { detail: value })
  );
}

function getDataLayer(): unknown[][] {
  const analyticsWindow = window as typeof window & {
    dataLayer?: unknown[][];
  };

  analyticsWindow.dataLayer = analyticsWindow.dataLayer || [];
  return analyticsWindow.dataLayer;
}

function getGtag() {
  const analyticsWindow = window as typeof window & {
    gtag?: (...args: unknown[]) => void;
  };

  if (!analyticsWindow.gtag) {
    analyticsWindow.gtag = (...args: unknown[]) => {
      getDataLayer().push(args);
    };
  }

  return analyticsWindow.gtag;
}

export function loadGoogleAnalytics(): boolean {
  if (!isProductionRuntime()) return false;
  if (getAnalyticsConsent() !== 'granted') return false;

  const gtag = getGtag();

  if (!document.querySelector(`script[data-lasyncro-ga4="${GA4_ID}"]`)) {
    const script = document.createElement('script');
    script.async = true;
    script.dataset.lasyncroGa4 = GA4_ID;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
    document.head.appendChild(script);

    gtag('js', new Date());
    gtag('config', GA4_ID, {
      send_page_view: false,
      cookie_domain: 'lasyncro.com',
    });
  }

  return true;
}

export function trackGoogleAnalyticsPageView(): void {
  if (!loadGoogleAnalytics()) return;

  getGtag()('event', 'page_view', {
    page_location: window.location.href,
    page_path: `${window.location.pathname}${window.location.search}`,
    page_title: document.title,
  });
}
