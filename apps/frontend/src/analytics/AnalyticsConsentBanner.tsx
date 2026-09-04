import { useState } from 'react';
import { shouldEnableFrontendAnalytics } from './environment';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
} from './googleAnalytics';

export function AnalyticsConsentBanner() {
  const production = shouldEnableFrontendAnalytics({
    hostname: window.location.hostname,
    mode: import.meta.env.MODE,
  });

  const [visible, setVisible] = useState(
    production && getAnalyticsConsent() === null
  );

  if (!visible) return null;

  const choose = (value: 'granted' | 'denied') => {
    setAnalyticsConsent(value);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 99999,
        maxWidth: 720,
        margin: '0 auto',
        padding: 16,
        borderRadius: 12,
        background: '#151D29',
        color: '#F0EEE8',
        boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
      }}
    >
      <div style={{ marginBottom: 12, lineHeight: 1.5 }}>
        LaSyncro uses Google Analytics to understand product usage. It is optional
        and is not loaded unless you allow it.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => choose('granted')}>
          Allow Google Analytics
        </button>
        <button type="button" onClick={() => choose('denied')}>
          Decline Google Analytics
        </button>
      </div>
    </div>
  );
}
