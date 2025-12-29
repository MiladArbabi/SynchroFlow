//tests/unit/ui/specter/SpecterModule.ft1-scenarios.test.tsx
import React from 'react';
import { screen } from '@testing-library/react';
import { SpecterModule } from '@lasyncro/specter';
import { renderWithTheme } from 'test-utils';

describe('SpecterModule — FT1 scenarios', () => {
  it('LOADING when sessionCount is null', () => {
    renderWithTheme(
      <SpecterModule sessionCount={null} signalConfidence={null} />
    );

    expect(
      screen.getByTestId('specter-ft1-loading')
    ).toBeInTheDocument();
  });

  it('NO_SESSIONS when sessionCount is 0', () => {
    renderWithTheme(
      <SpecterModule sessionCount={0} signalConfidence={null} />
    );

    expect(
      screen.getByTestId('specter-ft1-no-sessions')
    ).toBeInTheDocument();
  });

  it('LOW_SIGNAL when sessions exist but confidence is null', () => {
    renderWithTheme(
      <SpecterModule sessionCount={12} signalConfidence={null} />
    );

    expect(
      screen.getByTestId('specter-ft1-low-signal')
    ).toBeInTheDocument();
  });

  it('HEALTHY when sessions exist and confidence is known', () => {
    renderWithTheme(
      <SpecterModule sessionCount={25} signalConfidence={0.42} />
    );

    expect(
      screen.getByTestId('specter-ft1-healthy')
    ).toBeInTheDocument();
  });

  it('emits START_ONBOARDING intent from NO_SESSIONS CTA', () => {
    const onIntent = jest.fn();

    renderWithTheme(
      <SpecterModule
        sessionCount={0}
        signalConfidence={null}
        onIntent={onIntent}
      />
    );

    screen
      .getByRole('button', { name: /activate session tracking/i })
      .click();

    expect(onIntent).toHaveBeenCalledWith({
      type: 'START_ONBOARDING',
      taskId: 'install-sdk',
    });
  });
});