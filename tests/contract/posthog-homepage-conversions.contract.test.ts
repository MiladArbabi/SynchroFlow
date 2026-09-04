import fs from 'fs';
import path from 'path';

const page = fs.readFileSync(
  path.join(process.cwd(), 'packages/landing-page/index.html'),
  'utf8'
);

describe('AN-PH-01 homepage conversion analytics', () => {
  test('homepage exposes a consent-aware PostHog capture boundary', () => {
    expect(page).toContain('function captureHomepageEvent');
    expect(page).toContain('window.__LASYNCRO_ANALYTICS_ENABLED__');
    expect(page).toContain("typeof posthog === 'undefined'");
    expect(page).toContain("typeof posthog.capture !== 'function'");
    expect(page).toMatch(
      /function captureHomepageEvent[\s\S]*?posthog\.capture\(/
    );
  });

  test('homepage captures the three canonical conversion intents', () => {
    expect(page).toContain(
      "captureHomepageEvent('launch_notify_clicked'"
    );
    expect(page).toContain(
      "captureHomepageEvent('waitlist_signup'"
    );
    expect(page).toContain(
      "captureHomepageEvent('shopify_install_clicked'"
    );
  });

  test('waitlist analytics fires only after successful API confirmation', () => {
    const failureCheck = page.indexOf(
      "if (!response.ok) throw new Error('waitlist failed');"
    );
    const capture = page.indexOf(
      "captureHomepageEvent('waitlist_signup'"
    );

    expect(failureCheck).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(failureCheck);
  });

  test('homepage PostHog waitlist event does not contain email', () => {
    const match = page.match(
      /captureHomepageEvent\('waitlist_signup',\s*\{([\s\S]*?)\}\)/
    );

    expect(match).not.toBeNull();
    expect(match?.[1]).not.toMatch(/\bemail\b/i);
  });
});
