import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  getAnalyticsConsent,
  trackGoogleAnalyticsPageView,
  type AnalyticsConsent,
} from './googleAnalytics';

export function GoogleAnalyticsPageView() {
  const location = useLocation();
  const [consent, setConsent] = useState<AnalyticsConsent>(
    getAnalyticsConsent()
  );

  useEffect(() => {
    const onConsent = () => setConsent(getAnalyticsConsent());

    window.addEventListener('lasyncro:analytics-consent', onConsent);
    return () =>
      window.removeEventListener('lasyncro:analytics-consent', onConsent);
  }, []);

  useEffect(() => {
    if (consent !== 'granted') return;
    trackGoogleAnalyticsPageView();
  }, [location.pathname, location.search, consent]);

  return null;
}
