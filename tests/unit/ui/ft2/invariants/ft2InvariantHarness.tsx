import React from 'react';
import { renderWithTheme } from 'test-utils';

export type FT2InvariantCase<Props> = {
  name: string;
  Component: React.ComponentType<Props>;
  validProps: Props;
  nullProps: Props;
};

export function runFT2Invariants<Props>({
  name,
  Component,
  validProps,
  nullProps,
}: FT2InvariantCase<Props>) {
  describe(`FT2 CNS invariants — ${name}`, () => {
    test('null safety', () => {
      expect(() =>
        renderWithTheme(<Component {...nullProps} />)
      ).not.toThrow();
    });

    test('deterministic rendering', () => {
      const r1 = renderWithTheme(<Component {...validProps} />);
      const html1 = r1.container.innerHTML;

      r1.unmount();

      const r2 = renderWithTheme(<Component {...validProps} />);
      const html2 = r2.container.innerHTML;

      expect(html1).toEqual(html2);
    });

    test('no interpretation vocabulary leakage', () => {
      const { container } = renderWithTheme(
        <Component {...validProps} />
      );

      const forbidden = [
        'good',
        'bad',
        'healthy',
        'unhealthy',
        'risk',
        'safe',
        'warning',
        'critical',
        'score',
        'status',
        'severity',
      ];

      const text = container.textContent?.toLowerCase() ?? '';

      forbidden.forEach((word) => {
        expect(text).not.toContain(word);
      });
    });
  });
}