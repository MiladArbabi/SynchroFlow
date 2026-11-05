/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.lasyncro.com/?utm_source=newsletter&utm_campaign=p0"}
 */
/**
 * MARKETING-P0-IMPLEMENT-002 — Next.js marketing consent + conversion behaviour.
 *
 * Renders the real PostHogProvider + GoogleAnalyticsProvider (and the waitlist
 * forms) with the marketing app's own React, replacing only third-party
 * boundaries: posthog-js (recording fake) and next/navigation (controllable
 * route). Protects consent gating, withdrawal, one pageview per navigation,
 * in-memory UTM carry-over, waitlist success/failure events without PII, and
 * per-event marketing tagging.
 */
import path from 'path';

const MARKETING = path.join(process.cwd(), 'apps/marketing');
// The marketing app pins its own React. React, react-dom and the components
// are loaded in one isolated registry per test so they share one instance.
const REACT_PATH = path.join(MARKETING, 'node_modules/react');
const REACT_DOM_CLIENT_PATH = path.join(MARKETING, 'node_modules/react-dom/client');
let React: any;
let createRoot: any;

const GA4_ID = 'G-1H3XLN9MN2';

type Call = { method: string; args: unknown[] };
const mockPostHog = (() => {
  const calls: Call[] = [];
  let optedOut = false;
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };
  return {
    calls,
    reset() {
      calls.length = 0;
      optedOut = false;
    },
    setOptedOut(value: boolean) {
      optedOut = value;
    },
    init: record('init'),
    capture: record('capture'),
    register: record('register'),
    opt_in_capturing: (...args: unknown[]) => {
      optedOut = false;
      calls.push({ method: 'opt_in_capturing', args });
    },
    opt_out_capturing: (...args: unknown[]) => {
      optedOut = true;
      calls.push({ method: 'opt_out_capturing', args });
    },
    has_opted_out_capturing: () => optedOut,
  };
})();

const mockRoute = { pathname: '/', search: '' };

jest.mock('posthog-js', () => ({ __esModule: true, default: mockPostHog }));
jest.mock('posthog-js/react', () => ({
  __esModule: true,
  PostHogProvider: ({ children }: { children: unknown }) => children,
}));
jest.mock('next/navigation', () => ({
  usePathname: () => mockRoute.pathname,
  useSearchParams: () => new URLSearchParams(mockRoute.search),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const act = (cb: () => unknown): Promise<void> => React.act(cb);

const ORIGINAL_ENV = process.env.NODE_ENV;
let container: HTMLDivElement;
let root: any;

type Modules = {
  PostHogProvider: any;
  GoogleAnalyticsProvider: any;
  AnalyticsPreferencesButton: any;
  captureMarketingEvent: (event: string, props?: Record<string, unknown>) => void;
  LaunchNotifyForm: any;
};

function loadModules(): Modules {
  let mods!: Modules;
  // Load React's development build (needed for act); the providers read
  // NODE_ENV at runtime, so they still see the value the test configured.
  const runtimeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  jest.isolateModules(() => {
    React = require(REACT_PATH);
    createRoot = require(REACT_DOM_CLIENT_PATH).createRoot;
    // Mirror the real alias so form components share the provider instance.
    jest.doMock('@/components/PostHogProvider', () =>
      require(path.join(MARKETING, 'components/PostHogProvider.tsx')), { virtual: true });
    const ph = require(path.join(MARKETING, 'components/PostHogProvider.tsx'));
    const ga = require(path.join(MARKETING, 'components/GoogleAnalyticsProvider.tsx'));
    mods = {
      PostHogProvider: ph.default,
      captureMarketingEvent: ph.captureMarketingEvent,
      GoogleAnalyticsProvider: ga.default,
      AnalyticsPreferencesButton: ga.AnalyticsPreferencesButton,
      LaunchNotifyForm: require(path.join(MARKETING, 'components/conversion/LaunchNotifyForm.tsx')).default,
    };
  });
  process.env.NODE_ENV = runtimeEnv;
  return mods;
}

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.trim().split('=')[0];
    if (!name) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.lasyncro.com`;
    document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

function setConsentCookie(value: 'granted' | 'denied') {
  document.cookie = `lasyncro_analytics_consent=${value}; Path=/; Domain=.lasyncro.com; Secure`;
}

async function render(mods: Modules, extra: unknown = null) {
  if (!root) root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        mods.PostHogProvider,
        null,
        React.createElement(
          mods.GoogleAnalyticsProvider,
          null,
          React.createElement(mods.AnalyticsPreferencesButton),
          extra
        )
      )
    );
  });
}

async function navigate(mods: Modules, pathname: string, search = '', extra: unknown = null) {
  mockRoute.pathname = pathname;
  mockRoute.search = search;
  await render(mods, extra);
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found as HTMLButtonElement;
}

async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
}

const calls = (method: string) => mockPostHog.calls.filter((call) => call.method === method);
const pageviews = () => calls('capture').filter((call) => call.args[0] === '$pageview');
const gaPageViews = () =>
  Array.from(((window as any).dataLayer ?? []) as ArrayLike<unknown>[])
    .map((entry) => Array.from(entry))
    .filter((args) => args[0] === 'event' && args[1] === 'page_view');

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_marketing';
  mockPostHog.reset();
  mockRoute.pathname = '/blog';
  mockRoute.search = '';
  clearCookies();
  (window as any).dataLayer = [];
  delete (window as any).gtag;
  delete (window as any)[`ga-disable-${GA4_ID}`];
  document.head.querySelectorAll('script[data-lasyncro-ga4]').forEach((node) => node.remove());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = null;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container.remove();
  process.env.NODE_ENV = ORIGINAL_ENV;
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
});

describe('MARKETING-P0 Next consent lifecycle', () => {
  test('absent consent: banner shown, nothing initialised or captured', async () => {
    const mods = loadModules();
    await render(mods);

    expect(container.querySelector('[aria-label="Analytics consent"]')).not.toBeNull();
    expect(mockPostHog.calls).toEqual([]);
    expect(gaPageViews()).toEqual([]);

    mods.captureMarketingEvent('cta_clicked', { location: 'x' });
    expect(mockPostHog.calls).toEqual([]);
  });

  test('denied consent: no banner and no tracking across navigation', async () => {
    setConsentCookie('denied');
    const mods = loadModules();
    await render(mods);
    await navigate(mods, '/pricing');

    expect(container.querySelector('[aria-label="Analytics consent"]')).toBeNull();
    expect(mockPostHog.calls).toEqual([]);
    expect(gaPageViews()).toEqual([]);
  });

  test('grant after load: one init, one pageview per navigation, never duplicated', async () => {
    const mods = loadModules();
    await render(mods);
    await click('Allow analytics');

    expect(calls('init')).toHaveLength(1);
    expect(pageviews()).toHaveLength(1);
    expect(gaPageViews()).toHaveLength(1);

    // Re-render on the same URL must not capture again.
    await render(mods);
    await render(mods);
    expect(pageviews()).toHaveLength(1);
    expect(gaPageViews()).toHaveLength(1);

    await navigate(mods, '/pricing');
    await navigate(mods, '/pricing', 'plan=core');
    expect(pageviews()).toHaveLength(3);
    expect(gaPageViews()).toHaveLength(3);
    expect(pageviews().map((call) => (call.args[1] as any).pathname)).toEqual([
      '/blog',
      '/pricing',
      '/pricing',
    ]);
    expect(calls('init')).toHaveLength(1);
  });

  test('withdrawal via Cookie preferences stops PostHog and GA4', async () => {
    setConsentCookie('granted');
    const mods = loadModules();
    await render(mods);
    expect(pageviews()).toHaveLength(1);

    await click('Cookie preferences');
    const banner = container.querySelector('[aria-label="Analytics consent"]');
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute('role')).toBe('dialog');
    expect(document.activeElement?.textContent).toBe('Allow analytics');

    await click('Decline analytics');

    expect(document.cookie).toContain('lasyncro_analytics_consent=denied');
    expect(calls('opt_out_capturing')).toHaveLength(1);
    expect((window as any)[`ga-disable-${GA4_ID}`]).toBe(true);

    const before = mockPostHog.calls.length;
    const gaBefore = gaPageViews().length;
    await navigate(mods, '/compare');
    mods.captureMarketingEvent('cta_clicked', { location: 'x' });

    expect(mockPostHog.calls.slice(before)).toEqual([]);
    expect(gaPageViews()).toHaveLength(gaBefore);
  });

  test('re-grant after withdrawal clears the opt-out without $opt_in and continues tracking', async () => {
    setConsentCookie('granted');
    const mods = loadModules();
    await render(mods);
    await click('Cookie preferences');
    await click('Decline analytics');
    await click('Cookie preferences');
    await click('Allow analytics');

    expect(mockPostHog.has_opted_out_capturing()).toBe(false);
    expect(calls('opt_in_capturing').pop()?.args[0]).toEqual({ captureEventName: false });
    // Same URL: still one pageview.
    expect(pageviews()).toHaveLength(1);
    await navigate(mods, '/about');
    expect(pageviews()).toHaveLength(2);
  });

  test('a persisted PostHog opt-out from an earlier visit is cleared before the first pageview', async () => {
    setConsentCookie('granted');
    mockPostHog.setOptedOut(true);
    const mods = loadModules();
    await render(mods);

    const order = mockPostHog.calls.map((call) =>
      call.method === 'capture' ? `capture:${call.args[0]}` : call.method
    );
    expect(order.indexOf('init')).toBeLessThan(order.indexOf('opt_in_capturing'));
    expect(order.indexOf('opt_in_capturing')).toBeLessThan(order.indexOf('capture:$pageview'));
  });
});

describe('MARKETING-P0 Next attribution and isolation', () => {
  test('landing UTM params (memory only) attach once to the first pageview after consent', async () => {
    const mods = loadModules();
    await render(mods); // landed with ?utm_source=newsletter&utm_campaign=p0
    await navigate(mods, '/pricing');
    expect(mockPostHog.calls).toEqual([]);
    expect(document.cookie).not.toContain('utm_');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    await click('Allow analytics');
    await navigate(mods, '/about');

    const [first, second] = pageviews().map((call) => call.args[1] as Record<string, unknown>);
    expect(first).toMatchObject({ utm_source: 'newsletter', utm_campaign: 'p0', pathname: '/pricing' });
    expect(second).not.toHaveProperty('utm_source');
  });

  test('events are tagged surface=marketing per event; nothing is registered persistently', async () => {
    setConsentCookie('granted');
    const mods = loadModules();
    await render(mods);

    const config = calls('init')[0].args[1] as {
      before_send: (event: unknown) => any;
      cookie_domain: string;
      capture_pageview: boolean;
    };
    expect(config.capture_pageview).toBe(false);
    expect(config.before_send({ event: 'x', properties: { a: 1 } }).properties).toEqual({
      a: 1,
      surface: 'marketing',
    });
    expect(config.before_send(null)).toBeNull();
    expect(calls('register')).toEqual([]);
  });

  test('non-production host never initialises even with consent', async () => {
    setConsentCookie('granted');
    process.env.NODE_ENV = 'test';
    const mods = loadModules();
    await render(mods);
    expect(mockPostHog.calls).toEqual([]);
    expect(container.querySelector('[aria-label="Analytics consent"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).map((b) => b.textContent)).not.toContain(
      'Cookie preferences'
    );
  });
});

describe('MARKETING-P0 Next waitlist conversion', () => {
  function mockFetch(waitlistOk: boolean) {
    const fetchMock = jest.fn((input: string) =>
      Promise.resolve({
        ok: input === '/api/waitlist' ? waitlistOk : true,
        status: input === '/api/waitlist' && !waitlistOk ? 502 : 200,
        json: () => Promise.resolve(input === '/api/waitlist' ? { success: true } : { available: false }),
      })
    );
    (globalThis as any).fetch = fetchMock;
    return fetchMock;
  }

  async function submitLaunchForm(waitlistOk: boolean) {
    setConsentCookie('granted');
    mockFetch(waitlistOk);
    const mods = loadModules();
    await render(mods, React.createElement(mods.LaunchNotifyForm, { source: 'launch_pricing' }));

    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(email, 'merchant@example.com');
      email.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      email.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  const accepted = () =>
    calls('capture').filter((call) => call.args[0] === 'waitlist_submission_accepted');

  test('successful submission captures one accepted event without PII', async () => {
    await submitLaunchForm(true);

    expect(accepted()).toHaveLength(1);
    expect(accepted()[0].args[1]).toEqual({ source: 'launch_pricing', form: 'launch_notify' });
    expect(JSON.stringify(mockPostHog.calls)).not.toContain('merchant@example.com');
  });

  test('failed submission captures nothing', async () => {
    await submitLaunchForm(false);

    expect(accepted()).toHaveLength(0);
  });
});
