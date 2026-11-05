/**
 * MARKETING-P0-IMPLEMENT-002 — static marketing consent + conversion behaviour.
 *
 * Executes the real inline scripts of packages/landing-page/index.html and
 * packages/landing-page/checklist/index.html in jsdom, with a recording
 * PostHog fake in place of the CDN library (the snippet skips its loader when
 * window.posthog.__SV is set). Protects:
 *   - no PostHog/GA activity while consent is absent or denied;
 *   - grant after load initialises once and sends exactly one pageview;
 *   - withdrawal opts PostHog out, disables GA4 and stops custom events;
 *   - consent persists across page loads via the shared cookie;
 *   - waitlist analytics fire only on API success and never carry the email;
 *   - every marketing event is tagged surface=marketing per event (no register).
 */
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM, VirtualConsole } = require('jsdom');

const root = process.cwd();
const HOMEPAGE = fs.readFileSync(path.join(root, 'packages/landing-page/index.html'), 'utf8');
const CHECKLIST = fs.readFileSync(
  path.join(root, 'packages/landing-page/checklist/index.html'),
  'utf8'
);
const GA4_ID = 'G-1H3XLN9MN2';

type Call = { method: string; args: unknown[] };

function createPostHogFake() {
  const calls: Call[] = [];
  let optedOut = false;
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };
  return {
    __SV: 1,
    calls,
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
}

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

interface LoadOptions {
  html: string;
  url?: string;
  cookie?: string;
  waitlistOk?: boolean;
  /** Overrides waitlistOk, for network failures and in-flight or changing responses. */
  waitlistFetch?: () => Promise<FetchResponse>;
}

async function load({ html, url = 'https://www.lasyncro.com/', cookie, waitlistOk = true, waitlistFetch }: LoadOptions) {
  const posthog = createPostHogFake();
  const fetchCalls: Array<{ url: string; body?: string }> = [];
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window: any) {
      // Each cookie is written separately on the shared domain, as production does.
      for (const pair of (cookie ?? '').split(';').map((part) => part.trim()).filter(Boolean)) {
        window.document.cookie = `${pair}; Path=/; Domain=.lasyncro.com; Secure`;
      }
      window.posthog = posthog;
      window.scrollTo = () => undefined;
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => undefined;
      window.Element.prototype.scrollIntoView = () => undefined;
      window.fetch = (input: string, init?: { body?: string }) => {
        fetchCalls.push({ url: input, body: init?.body });
        if (input === '/api/waitlist') {
          if (waitlistFetch) return waitlistFetch();
          return Promise.resolve<FetchResponse>({
            ok: waitlistOk,
            status: waitlistOk ? 200 : 502,
            json: () => Promise.resolve(waitlistOk ? { success: true } : { error: 'Server error' }),
          });
        }
        return Promise.resolve<FetchResponse>({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ available: false, installUrl: null }),
        });
      };
    },
  });
  const window = dom.window as any;
  const document = window.document as Document;
  openWindows.push(window);
  if (document.readyState === 'loading') {
    await new Promise((resolve) =>
      window.addEventListener('DOMContentLoaded', resolve, { once: true })
    );
  }
  return { dom, window, document, posthog, fetchCalls };
}

const openWindows: any[] = [];
afterEach(() => {
  // Homepage animations schedule timers; close every window so none leak.
  while (openWindows.length) openWindows.pop().close();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function names(posthog: ReturnType<typeof createPostHogFake>, method: string) {
  return posthog.calls.filter((call) => call.method === method);
}

function captured(posthog: ReturnType<typeof createPostHogFake>, event: string) {
  return names(posthog, 'capture').filter((call) => call.args[0] === event);
}

function gaPageViews(window: any) {
  return Array.from((window.dataLayer ?? []) as ArrayLike<unknown>[])
    .map((entry) => Array.from(entry))
    .filter((args) => args[0] === 'event' && args[1] === 'page_view');
}

function clickButton(document: Document, label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label && !candidate.hidden
  );
  if (!button) throw new Error(`button not found: ${label}`);
  button.click();
}

describe('MARKETING-P0 homepage consent lifecycle', () => {
  test('absent consent: banner shown, no PostHog or GA activity', async () => {
    const { window, document, posthog } = await load({ html: HOMEPAGE });

    expect(document.querySelector('[aria-label="Analytics consent"]')).not.toBeNull();
    expect(posthog.calls).toEqual([]);
    expect(gaPageViews(window)).toEqual([]);
    expect(window.__LASYNCRO_ANALYTICS_ENABLED__).toBe(false);
  });

  test('denied consent: no banner, no PostHog or GA activity', async () => {
    const { window, document, posthog } = await load({
      html: HOMEPAGE,
      cookie: 'lasyncro_analytics_consent=denied',
    });

    expect(document.querySelector('[aria-label="Analytics consent"]')).toBeNull();
    expect(posthog.calls).toEqual([]);
    expect(gaPageViews(window)).toEqual([]);
  });

  test('non-production host never initialises, even with consent', async () => {
    const { posthog, document } = await load({
      html: HOMEPAGE,
      url: 'https://synchro-flow-landing.vercel.app/',
      cookie: 'lasyncro_analytics_consent=granted',
    });

    expect(posthog.calls).toEqual([]);
    const preferences = document.querySelector<HTMLButtonElement>('[data-analytics-preferences]');
    expect(preferences?.hidden).toBe(true);
  });

  test('grant after load initialises once and sends exactly one pageview', async () => {
    const { window, document, posthog } = await load({ html: HOMEPAGE });

    clickButton(document, 'Allow analytics');

    expect(document.cookie).toContain('lasyncro_analytics_consent=granted');
    expect(names(posthog, 'init')).toHaveLength(1);
    const config = names(posthog, 'init')[0].args[1] as Record<string, unknown>;
    expect(config.capture_pageview).toBe(false);
    expect(captured(posthog, '$pageview')).toHaveLength(1);
    expect(gaPageViews(window)).toHaveLength(1);
    expect(window.__LASYNCRO_ANALYTICS_ENABLED__).toBe(true);
    expect(document.querySelector('[aria-label="Analytics consent"]')).toBeNull();
  });

  test('withdrawal via Cookie preferences opts out and stops subsequent events', async () => {
    const { window, document, posthog } = await load({
      html: HOMEPAGE,
      cookie: 'lasyncro_analytics_consent=granted; _ga=GA1.1.123; _ga_ABC=GS1.1',
    });

    expect(names(posthog, 'init')).toHaveLength(1);
    expect(captured(posthog, '$pageview')).toHaveLength(1);
    expect(gaPageViews(window)).toHaveLength(1);

    const preferences = document.querySelector<HTMLButtonElement>('[data-analytics-preferences]');
    expect(preferences).not.toBeNull();
    expect(preferences!.hidden).toBe(false);
    expect(preferences!.tagName).toBe('BUTTON');
    preferences!.click();

    const banner = document.querySelector('[aria-label="Analytics consent"]');
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute('role')).toBe('dialog');
    expect(document.activeElement?.textContent).toBe('Allow analytics');

    clickButton(document, 'Decline analytics');

    expect(document.cookie).toContain('lasyncro_analytics_consent=denied');
    expect(names(posthog, 'opt_out_capturing')).toHaveLength(1);
    expect(window[`ga-disable-${GA4_ID}`]).toBe(true);
    expect(document.cookie).not.toMatch(/(^|;\s*)_ga(_[^=]*)?=/);
    expect(window.__LASYNCRO_ANALYTICS_ENABLED__).toBe(false);

    const callsAtWithdrawal = posthog.calls.length;
    const gaAtWithdrawal = gaPageViews(window).length;

    // Post-withdrawal interactions must not produce analytics.
    const form = document.querySelector<HTMLFormElement>('[data-launch-form]')!;
    form.querySelector<HTMLInputElement>('input[name="email"]')!.value = 'a@example.com';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    await flush();
    document.querySelector<HTMLElement>('[data-launch-scroll]')?.click();

    expect(posthog.calls.slice(callsAtWithdrawal)).toEqual([]);
    expect(gaPageViews(window)).toHaveLength(gaAtWithdrawal);
  });

  test('re-grant on the same page re-enables capture without a duplicate pageview', async () => {
    const { window, document, posthog } = await load({
      html: HOMEPAGE,
      cookie: 'lasyncro_analytics_consent=granted',
    });

    document.querySelector<HTMLButtonElement>('[data-analytics-preferences]')!.click();
    clickButton(document, 'Decline analytics');
    document.querySelector<HTMLButtonElement>('[data-analytics-preferences]')!.click();
    clickButton(document, 'Allow analytics');

    expect(names(posthog, 'init')).toHaveLength(1);
    expect(posthog.has_opted_out_capturing()).toBe(false);
    expect(captured(posthog, '$pageview')).toHaveLength(1);
    expect(captured(posthog, '$opt_in')).toHaveLength(0);
    expect(gaPageViews(window)).toHaveLength(1);
    expect(window[`ga-disable-${GA4_ID}`]).toBe(false);
  });

  test('consent persists across navigation: a fresh load with the cookie tracks immediately', async () => {
    const first = await load({ html: HOMEPAGE });
    clickButton(first.document, 'Allow analytics');
    const persisted = first.document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('lasyncro_analytics_consent='));
    expect(persisted).toBe('lasyncro_analytics_consent=granted');

    const second = await load({ html: CHECKLIST, url: 'https://www.lasyncro.com/checklist', cookie: persisted });
    expect(second.document.querySelector('[aria-label="Analytics consent"]')).toBeNull();
    expect(names(second.posthog, 'init')).toHaveLength(1);
    expect(captured(second.posthog, '$pageview')).toHaveLength(1);
  });

  test('a persisted PostHog opt-out is cleared on a fresh grant without an $opt_in event', async () => {
    const { posthog } = await load({ html: HOMEPAGE, cookie: 'lasyncro_analytics_consent=granted' });

    const optIn = names(posthog, 'opt_in_capturing');
    expect(optIn.length).toBeGreaterThanOrEqual(1);
    expect(optIn[0].args[0]).toEqual({ captureEventName: false });
    const initIndex = posthog.calls.findIndex((call) => call.method === 'init');
    const optInIndex = posthog.calls.findIndex((call) => call.method === 'opt_in_capturing');
    const pageviewIndex = posthog.calls.findIndex(
      (call) => call.method === 'capture' && call.args[0] === '$pageview'
    );
    expect(initIndex).toBeLessThan(optInIndex);
    expect(optInIndex).toBeLessThan(pageviewIndex);
  });
});

describe('MARKETING-P0 marketing/app isolation (static pages)', () => {
  test.each([
    ['homepage', HOMEPAGE, 'https://www.lasyncro.com/'],
    ['checklist', CHECKLIST, 'https://www.lasyncro.com/checklist'],
  ])('%s tags events per event and never registers persistent properties', async (_name, html, url) => {
    const { posthog } = await load({ html, url, cookie: 'lasyncro_analytics_consent=granted' });

    const config = names(posthog, 'init')[0].args[1] as {
      before_send: (event: unknown) => { properties: Record<string, unknown> };
      cookie_domain: string;
    };
    expect(config.cookie_domain).toBe('.lasyncro.com');
    const tagged = config.before_send({ event: 'x', properties: { a: 1 } });
    expect(tagged.properties).toEqual({ a: 1, surface: 'marketing' });
    expect(config.before_send(null)).toBeNull();
    expect(names(posthog, 'register')).toEqual([]);
  });
});

describe('MARKETING-P0 homepage waitlist conversion', () => {
  async function submit(waitlistOk: boolean) {
    const ctx = await load({
      html: HOMEPAGE,
      cookie: 'lasyncro_analytics_consent=granted',
      waitlistOk,
    });
    await flush();
    const form = ctx.document.querySelector<HTMLFormElement>('[data-launch-form]')!;
    form.querySelector<HTMLInputElement>('input[name="email"]')!.value = 'merchant@example.com';
    form.dispatchEvent(new ctx.window.Event('submit', { cancelable: true }));
    await flush();
    await flush();
    return ctx;
  }

  test('successful submission captures one accepted event without PII', async () => {
    const { posthog, fetchCalls } = await submit(true);

    expect(fetchCalls.some((call) => call.url === '/api/waitlist')).toBe(true);
    const events = captured(posthog, 'waitlist_submission_accepted');
    expect(events).toHaveLength(1);
    const props = events[0].args[1] as Record<string, unknown>;
    expect(props).toEqual({ source: expect.any(String), form: 'launch_notify' });
    expect(JSON.stringify(props)).not.toContain('merchant@example.com');
    expect(captured(posthog, 'waitlist_signup')).toHaveLength(0);
  });

  test('failed submission captures nothing', async () => {
    const { posthog } = await submit(false);

    expect(captured(posthog, 'waitlist_submission_accepted')).toHaveLength(0);
  });
});

describe('MARKETING-P0 checklist waitlist gate', () => {
  const EMAIL = 'merchant@example.com';
  const ok = (): FetchResponse => ({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
  const failed = (status: number): FetchResponse => ({
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'failed' }),
  });

  async function open(options: Partial<LoadOptions> = {}) {
    const ctx = await load({
      html: CHECKLIST,
      url: 'https://www.lasyncro.com/checklist',
      cookie: 'lasyncro_analytics_consent=granted',
      ...options,
    });
    const { document, window } = ctx;
    const input = document.querySelector<HTMLInputElement>('#eg-email')!;
    const button = document.querySelector<HTMLButtonElement>('#eg-submit')!;
    const error = document.querySelector<HTMLElement>('#eg-error')!;
    const gate = document.querySelector<HTMLElement>('#email-gate')!;
    const results = document.querySelector<HTMLElement>('#post-email')!;
    const send = () =>
      document
        .querySelector<HTMLFormElement>('.eg-form')!
        .dispatchEvent(new window.Event('submit', { cancelable: true }));
    const waitlistCalls = () => ctx.fetchCalls.filter((call) => call.url === '/api/waitlist');
    input.value = EMAIL;
    return { ...ctx, input, button, error, gate, results, send, waitlistCalls };
  }

  const settle = async () => {
    await flush();
    await flush();
  };

  test('stays on the gate until the API confirms, and ignores double submits', async () => {
    let resolve!: (response: FetchResponse) => void;
    const page = await open({
      waitlistFetch: () => new Promise<FetchResponse>((done) => { resolve = done; }),
    });

    page.send();
    page.send();
    await settle();

    expect(page.waitlistCalls()).toHaveLength(1);
    expect(page.button.disabled).toBe(true);
    expect(page.gate.style.display).not.toBe('none');
    expect(page.results.style.display).toBe('none');
    expect(captured(page.posthog, 'waitlist_submission_accepted')).toHaveLength(0);

    resolve(ok());
    await settle();

    expect(page.gate.style.display).toBe('none');
    expect(page.results.style.display).toBe('block');
    expect(page.document.querySelectorAll('#breakdown-list .breakdown-item').length).toBeGreaterThan(0);
    expect(page.error.textContent).toBe('');
    const events = captured(page.posthog, 'waitlist_submission_accepted');
    expect(events).toHaveLength(1);
    expect(events[0].args[1]).toEqual({ source: 'checklist', form: 'checklist' });
  });

  test.each([
    ['server error', () => Promise.resolve(failed(502)), /check your connection and try again/i],
    ['network failure', () => Promise.reject(new Error('offline')), /check your connection and try again/i],
    ['rejected email', () => Promise.resolve(failed(400)), /check it for typos and try again/i],
  ])('%s keeps the gate, explains, and preserves input', async (_name, waitlistFetch, message) => {
    const page = await open({ waitlistFetch });

    page.send();
    await settle();

    expect(page.gate.style.display).not.toBe('none');
    expect(page.results.style.display).toBe('none');
    expect(page.error.getAttribute('role')).toBe('alert');
    expect(page.error.textContent).toMatch(message);
    expect(page.input.value).toBe(EMAIL);
    expect(page.button.disabled).toBe(false);
    expect(page.button.textContent).toBe('Send my breakdown →');
    expect(captured(page.posthog, 'waitlist_submission_accepted')).toHaveLength(0);
  });

  test('retry after a failure resubmits the same email and then advances', async () => {
    const responses = [failed(502), ok()];
    const page = await open({ waitlistFetch: () => Promise.resolve(responses.shift()!) });

    page.send();
    await settle();
    page.send();
    await settle();

    const bodies = page.waitlistCalls().map((call) => JSON.parse(call.body!));
    expect(bodies).toEqual([
      { email: EMAIL, store: 'checklist-signup', source: 'checklist' },
      { email: EMAIL, store: 'checklist-signup', source: 'checklist' },
    ]);
    expect(page.results.style.display).toBe('block');
    expect(page.error.textContent).toBe('');
    expect(captured(page.posthog, 'waitlist_submission_accepted')).toHaveLength(1);
  });

  test.each([
    ['denied', 'lasyncro_analytics_consent=denied'],
    ['absent', undefined],
  ])('%s consent: success advances without any analytics', async (_name, cookie) => {
    const page = await open({ cookie });

    page.send();
    await settle();

    expect(page.results.style.display).toBe('block');
    expect(page.posthog.calls).toEqual([]);
  });

  test('an analytics fault does not turn a confirmed signup into an error', async () => {
    const page = await open();
    page.posthog.capture = () => {
      throw new Error('posthog down');
    };

    page.send();
    await settle();

    expect(page.results.style.display).toBe('block');
    expect(page.error.textContent).toBe('');
  });
});
