// tests/unit/ui/shared/OperationalContextShell.test.tsx
//
// SCREEN-ARCH RED — shared OperationalContextShell composition contract.
//
// Operational screens compose a stable PRIMARY workspace with a canonical
// secondary RAIL, using Overview's certified grid grammar. When the rail is
// suppressed (e.g. the app shell opens the Ops Console), only the rail
// CONTENT withdraws — the primary stays in the first track and is not
// remounted, and the secondary track stays allocated.
//
// jsdom does no layout, so track stability is proven structurally: the
// shell's semantic track markers (data-shell-track) and their DOM order.
// Breakpoint behaviour (lg columns; suppressed rail track display:none below
// lg) is not asserted: jsdom applies every @media rule unconditionally, so
// computed style cannot distinguish breakpoints.
//
// Minimal API under test: { primary, rail, suppressRail }.
//
// Deliberately RED while modules/shared/src/ui/OperationalContextShell.tsx
// does not exist — the import below fails to resolve.

import React, { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { OperationalContextShell } from '../../../../modules/shared/src/ui/OperationalContextShell';

function Primary({ onMount }: { onMount?: () => void }) {
  useEffect(() => {
    onMount?.();
  }, [onMount]);
  return <div data-testid="primary-workspace">workspace</div>;
}

const rail = <div data-testid="secondary-rail">rail</div>;

function tracks(container: HTMLElement) {
  const shell = container.querySelector('[data-operational-context-shell]') as HTMLElement | null;
  expect(shell).not.toBeNull();
  const children = Array.from(shell!.children) as HTMLElement[];
  return { shell: shell!, children };
}

describe('OperationalContextShell — primary workspace + secondary rail', () => {
  it('renders the primary workspace and the rail together by default', () => {
    render(<OperationalContextShell primary={<Primary />} rail={rail} />);

    expect(screen.getByTestId('primary-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('secondary-rail')).toBeInTheDocument();
  });

  it('suppressRail=false keeps both regions', () => {
    render(<OperationalContextShell primary={<Primary />} rail={rail} suppressRail={false} />);

    expect(screen.getByTestId('primary-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('secondary-rail')).toBeInTheDocument();
  });

  it('suppressRail=true removes only the rail; the primary workspace remains rendered', () => {
    render(<OperationalContextShell primary={<Primary />} rail={rail} suppressRail />);

    expect(screen.queryByTestId('secondary-rail')).toBeNull();
    expect(screen.getByTestId('primary-workspace')).toBeInTheDocument();
  });

  it('toggling suppression withdraws and restores the rail without remounting the primary workspace', () => {
    const onMount = jest.fn();
    const primary = <Primary onMount={onMount} />;

    const { rerender } = render(
      <OperationalContextShell primary={primary} rail={rail} suppressRail={false} />,
    );
    const primaryNode = screen.getByTestId('primary-workspace');
    expect(onMount).toHaveBeenCalledTimes(1);

    rerender(<OperationalContextShell primary={primary} rail={rail} suppressRail />);
    expect(screen.queryByTestId('secondary-rail')).toBeNull();
    expect(screen.getByTestId('primary-workspace')).toBe(primaryNode);

    rerender(<OperationalContextShell primary={primary} rail={rail} suppressRail={false} />);
    expect(screen.getByTestId('secondary-rail')).toBeInTheDocument();
    expect(screen.getByTestId('primary-workspace')).toBe(primaryNode);

    expect(onMount).toHaveBeenCalledTimes(1);
  });
});

describe('OperationalContextShell — track stability', () => {
  it('lays out as a grid with the primary in the first track and the rail in the second', () => {
    const { container } = render(<OperationalContextShell primary={<Primary />} rail={rail} />);
    const { shell, children } = tracks(container);

    expect(shell).toHaveStyle({ display: 'grid' });
    expect(children).toHaveLength(2);
    expect(children[0]).toHaveAttribute('data-shell-track', 'primary');
    expect(children[1]).toHaveAttribute('data-shell-track', 'rail');
    expect(children[0]).toContainElement(screen.getByTestId('primary-workspace'));
    expect(children[1]).toContainElement(screen.getByTestId('secondary-rail'));
  });

  it('suppressRail keeps the secondary track allocated and empty, with the primary still first', () => {
    const { container } = render(
      <OperationalContextShell primary={<Primary />} rail={rail} suppressRail />,
    );
    const { children } = tracks(container);

    expect(children).toHaveLength(2);
    expect(children[0]).toHaveAttribute('data-shell-track', 'primary');
    expect(children[0]).toContainElement(screen.getByTestId('primary-workspace'));
    expect(children[1]).toHaveAttribute('data-shell-track', 'rail');
    expect(children[1]).toBeEmptyDOMElement();
  });

  it('toggling suppression keeps the same shell and track nodes in the same order', () => {
    const primary = <Primary />;
    const { container, rerender } = render(
      <OperationalContextShell primary={primary} rail={rail} suppressRail={false} />,
    );
    const before = tracks(container);

    rerender(<OperationalContextShell primary={primary} rail={rail} suppressRail />);
    const suppressed = tracks(container);
    expect(suppressed.shell).toBe(before.shell);
    expect(suppressed.children).toHaveLength(2);
    expect(suppressed.children[0]).toBe(before.children[0]);
    expect(suppressed.children[1]).toBe(before.children[1]);
    expect(suppressed.children[1]).toBeEmptyDOMElement();

    rerender(<OperationalContextShell primary={primary} rail={rail} suppressRail={false} />);
    const restored = tracks(container);
    expect(restored.children[0]).toBe(before.children[0]);
    expect(restored.children[1]).toBe(before.children[1]);
    expect(restored.children[1]).toContainElement(screen.getByTestId('secondary-rail'));
  });
});
