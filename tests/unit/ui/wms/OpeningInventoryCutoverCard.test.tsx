// 4b-2b GRILL-04 — merchant opening inventory cutover card.
//
// Renders the extracted OpeningInventoryCutoverCard directly — not
// WmsModuleFT2 (30+ prop surface; see RecountFreshNoBins.test.tsx for the
// precedent). The card is presentational: canonical state comes from
// GET /api/v1/wms/opening-inventory/progress and the only thing it may
// send back is the explicit physical-truth acceptance boolean. It never
// computes deltas or Shopify quantities.
import { fireEvent, render, screen } from '@testing-library/react';
import {
  OpeningInventoryCutoverCard,
  type OpeningInventoryCutoverView,
  type OpeningInventoryCutoverCardProps,
} from '../../../../modules/wms/src/ui/components/OpeningInventoryCutoverCard';

const ACCEPT_PHRASE = 'LaSyncro physical count is truth';
const SYNC_LABEL = /sync opening inventory to shopify/i;

type ProgressOverrides = Partial<OpeningInventoryCutoverView['progress']>;
type Cutover = NonNullable<OpeningInventoryCutoverView['cutover']>;

function cutover(overrides: Partial<Cutover> & Pick<Cutover, 'status'>): Cutover {
  return {
    physical_truth_accepted: false,
    error_code: null,
    error_message: null,
    completed_at: null,
    ...overrides,
  };
}

function view(
  progress: ProgressOverrides,
  extra: Partial<Omit<OpeningInventoryCutoverView, 'progress'>> = {}
): OpeningInventoryCutoverView {
  return {
    progress: {
      bootstrap_model: 'reconcile_opening_expectation_v2',
      reconciliation_required: true,
      started_at: '2026-09-20T00:00:00.000Z',
      state: 'not_started',
      total_bins: 4,
      complete_bins: 0,
      in_progress_bins: 0,
      needs_review_bins: 0,
      not_started_bins: 4,
      remaining_bins: 4,
      progress_pct: 0,
      all_bins_settled: false,
      difference_count: 0,
      differences: [],
      bins: [],
      ...progress,
    },
    cutover: null,
    shopify_synced_at: null,
    ...extra,
  };
}

function renderCard(props: Partial<OpeningInventoryCutoverCardProps> & { view: OpeningInventoryCutoverView | null }) {
  const onApprove = props.onApprove ?? jest.fn();
  const utils = render(
    <OpeningInventoryCutoverCard
      canApprove={props.canApprove ?? true}
      submitting={props.submitting ?? false}
      error={props.error ?? null}
      view={props.view}
      onApprove={onApprove}
    />
  );
  return { ...utils, onApprove };
}

function expectNoAction() {
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
}

const REVIEW_REQUIRED = view({
  state: 'review_required',
  complete_bins: 4,
  not_started_bins: 0,
  remaining_bins: 0,
  progress_pct: 100,
  all_bins_settled: true,
  difference_count: 2,
  differences: [
    { lasyncro_variant_id: 'v1', expected_quantity: 5, observed_quantity: 3, delta: -2 },
    { lasyncro_variant_id: 'v2', expected_quantity: 1, observed_quantity: 2, delta: 1 },
  ],
});

const READY = view({
  state: 'ready_for_cutover',
  complete_bins: 4,
  not_started_bins: 0,
  remaining_bins: 0,
  progress_pct: 100,
  all_bins_settled: true,
});

describe('OpeningInventoryCutoverCard — non-actionable states', () => {
  test('not_required renders nothing', () => {
    const { container } = renderCard({ view: view({ state: 'not_required', reconciliation_required: false }) });
    expect(container).toBeEmptyDOMElement();
  });

  test('null view renders nothing', () => {
    const { container } = renderCard({ view: null });
    expect(container).toBeEmptyDOMElement();
  });

  test('not_started is informational only', () => {
    renderCard({ view: view({ state: 'not_started' }) });
    expect(screen.getByText(/opening inventory/i)).toBeInTheDocument();
    expectNoAction();
  });

  test('GRILL-04A counting => informational, no cutover CTA', () => {
    renderCard({
      view: view({ state: 'counting', complete_bins: 1, in_progress_bins: 1, not_started_bins: 2, remaining_bins: 3, progress_pct: 25 }),
    });
    expect(screen.getByText(/count in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 4 bins/i)).toBeInTheDocument();
    expectNoAction();
  });

  test('GRILL-04B needs_bin_review => informational, no cutover CTA', () => {
    renderCard({
      view: view({ state: 'needs_bin_review', complete_bins: 3, needs_review_bins: 1, not_started_bins: 0, remaining_bins: 1 }),
    });
    expect(screen.getByText(/bin review/i)).toBeInTheDocument();
    expectNoAction();
  });
});

describe('OpeningInventoryCutoverCard — owner/admin approval', () => {
  test('GRILL-04C review_required: explicit acceptance gates the action and callback receives true', () => {
    const { onApprove } = renderCard({ view: REVIEW_REQUIRED, canApprove: true });

    const checkbox = screen.getByRole('checkbox', { name: ACCEPT_PHRASE });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(ACCEPT_PHRASE)).toBeInTheDocument();

    const action = screen.getByRole('button', { name: SYNC_LABEL });
    expect(action).toBeDisabled();

    fireEvent.click(action);
    expect(onApprove).not.toHaveBeenCalled();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(action).toBeEnabled();

    fireEvent.click(action);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(true);
  });

  test('GRILL-04C review_required: un-accepting disables the action again', () => {
    renderCard({ view: REVIEW_REQUIRED, canApprove: true });
    const checkbox = screen.getByRole('checkbox', { name: ACCEPT_PHRASE });
    const action = screen.getByRole('button', { name: SYNC_LABEL });

    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    expect(action).toBeDisabled();
  });

  test('GRILL-04D ready_for_cutover: action visible, no acceptance control, callback receives false', () => {
    const { onApprove } = renderCard({ view: READY, canApprove: true });

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const action = screen.getByRole('button', { name: SYNC_LABEL });
    expect(action).toBeEnabled();

    fireEvent.click(action);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(false);
  });
});

describe('OpeningInventoryCutoverCard — operator', () => {
  test.each([
    ['review_required', REVIEW_REQUIRED],
    ['ready_for_cutover', READY],
    ['failed', view(READY.progress, { cutover: cutover({ status: 'failed', error_code: 'OPENING_CUTOVER_SHOPIFY', error_message: 'Shopify did not accept the update.' }) })],
  ])('GRILL-04E operator sees %s status but no approval/cutover action', (_label, v) => {
    const { onApprove } = renderCard({ view: v, canApprove: false });
    expect(screen.getByText(/owner or admin/i)).toBeInTheDocument();
    expectNoAction();
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe('OpeningInventoryCutoverCard — cutover lifecycle', () => {
  test.each([
    ['cutover.status complete', view(READY.progress, { cutover: cutover({ status: 'complete', completed_at: '2026-09-23T10:00:00.000Z' }) })],
    ['shopify_synced_at set', view(REVIEW_REQUIRED.progress, { shopify_synced_at: '2026-09-23T10:00:00.000Z' })],
  ])('GRILL-04F %s => success, no action', (_label, v) => {
    renderCard({ view: v, canApprove: true });
    expect(screen.getByText(/synced to shopify/i)).toBeInTheDocument();
    expectNoAction();
  });

  test('GRILL-04I persisted executing + no local request: owner/admin can resume via the same callback', () => {
    const { onApprove } = renderCard({
      view: view(READY.progress, { cutover: cutover({ status: 'executing' }) }),
      canApprove: true,
      submitting: false,
    });
    expect(screen.getByText(/started but has not finished/i)).toBeInTheDocument();
    const resume = screen.getByRole('button', { name: /resume shopify sync/i });
    expect(resume).toBeEnabled();
    fireEvent.click(resume);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(false);
  });

  test('GRILL-04J persisted executing + local request in flight: action disabled, Syncing…', () => {
    const { onApprove } = renderCard({
      view: view(READY.progress, { cutover: cutover({ status: 'executing' }) }),
      canApprove: true,
      submitting: true,
    });
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
    const action = screen.getByRole('button', { name: /syncing/i });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(onApprove).not.toHaveBeenCalled();
  });

  test('GRILL-04K persisted mismatch acceptance is reused on resume: no checkbox, callback receives true', () => {
    const { onApprove } = renderCard({
      view: view(REVIEW_REQUIRED.progress, {
        cutover: cutover({ status: 'executing', physical_truth_accepted: true }),
      }),
      canApprove: true,
    });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const resume = screen.getByRole('button', { name: /resume shopify sync/i });
    expect(resume).toBeEnabled();
    fireEvent.click(resume);
    expect(onApprove).toHaveBeenCalledWith(true);
  });

  test('GRILL-04K no persisted acceptance on resume: explicit checkbox still required before true is sent', () => {
    const { onApprove } = renderCard({
      view: view(REVIEW_REQUIRED.progress, {
        cutover: cutover({ status: 'executing', physical_truth_accepted: false }),
      }),
      canApprove: true,
    });
    const resume = screen.getByRole('button', { name: /resume shopify sync/i });
    expect(resume).toBeDisabled();
    fireEvent.click(resume);
    expect(onApprove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: ACCEPT_PHRASE }));
    fireEvent.click(resume);
    expect(onApprove).toHaveBeenCalledWith(true);
  });

  test('GRILL-04L persisted executing operator: status visible, no executable action', () => {
    const { onApprove } = renderCard({
      view: view(REVIEW_REQUIRED.progress, {
        cutover: cutover({ status: 'executing', physical_truth_accepted: true }),
      }),
      canApprove: false,
    });
    expect(screen.getByText(/started but has not finished/i)).toBeInTheDocument();
    expect(screen.getByText(/owner or admin/i)).toBeInTheDocument();
    expectNoAction();
    expect(onApprove).not.toHaveBeenCalled();
  });

  test('GRILL-04G local in-flight submission disables duplicate action', () => {
    const { onApprove } = renderCard({ view: READY, canApprove: true, submitting: true });
    const action = screen.getByRole('button', { name: /syncing/i });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(onApprove).not.toHaveBeenCalled();
  });

  test('GRILL-04H failed + ready_for_cutover: shows public failure and retry sends false (same economic operation)', () => {
    const { onApprove } = renderCard({
      view: view(READY.progress, {
        cutover: cutover({
          status: 'failed',
          error_code: 'OPENING_CUTOVER_SHOPIFY',
          error_message: 'Shopify did not accept the opening inventory update.',
        }),
      }),
      canApprove: true,
    });
    expect(screen.getByText(/Shopify did not accept the opening inventory update/)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(false);
  });

  test('GRILL-04H failed + review_required: retry keeps the acceptance rule and sends true', () => {
    const { onApprove } = renderCard({
      view: view(REVIEW_REQUIRED.progress, {
        cutover: cutover({ status: 'failed', error_code: 'OPENING_CUTOVER_INTERNAL', error_message: 'Failed unexpectedly.' }),
      }),
      canApprove: true,
    });
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: ACCEPT_PHRASE }));
    fireEvent.click(retry);
    expect(onApprove).toHaveBeenCalledWith(true);
  });

  test('GRILL-04H failed with persisted acceptance: retry reuses recorded consent and sends true', () => {
    const { onApprove } = renderCard({
      view: view(REVIEW_REQUIRED.progress, {
        cutover: cutover({ status: 'failed', physical_truth_accepted: true, error_code: 'OPENING_CUTOVER_INTERNAL', error_message: 'Failed unexpectedly.' }),
      }),
      canApprove: true,
    });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onApprove).toHaveBeenCalledWith(true);
  });

  test('request error from the page is surfaced', () => {
    renderCard({ view: READY, canApprove: true, error: 'Shopify location mapping missing' });
    expect(screen.getByText('Shopify location mapping missing')).toBeInTheDocument();
  });
});
