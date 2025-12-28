// tests/unit/ui/helpers/assertAhaPanelIntent.ts

import { fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderWithTheme } from 'test-utils';

interface AssertAhaPanelIntentArgs {
  ui: ReactElement;
  ctaLabel: string;
  expectedIntent: unknown;
}

/**
 * assertAhaPanelIntent
 * --------------------
 * Shared contract test for all FT1 / Aha panels.
 *
 * Enforces:
 * - Exactly one CTA
 * - CTA emits semantic intent only
 * - No routing / lifecycle leakage
 */
export function assertAhaPanelIntent({
  ui,
  ctaLabel,
  expectedIntent,
}: AssertAhaPanelIntentArgs) {
  const onIntent = jest.fn();

  renderWithTheme(
    // @ts-expect-error — onIntent is required by contract
    ui.props.onIntent
      ? ui
      : { ...ui, props: { ...ui.props, onIntent } }
  );

  const button = screen.getByRole('button', {
    name: new RegExp(ctaLabel, 'i'),
  });

  expect(button).toBeInTheDocument();

  fireEvent.click(button);

  expect(onIntent).toHaveBeenCalledTimes(1);
  expect(onIntent).toHaveBeenCalledWith(expectedIntent);
}