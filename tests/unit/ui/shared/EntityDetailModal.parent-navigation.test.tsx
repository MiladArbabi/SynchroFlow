/**
 * BATCH-DETAIL-HANDOFF-01 — shared EntityDetailModal parent navigation.
 *
 * Contract:
 * - ENTITY-NAV-01: the shared shell owns an entity-agnostic parent/back
 *   affordance (e.g. "← Batch D8A81DF2" on a child Order Detail). Consumers
 *   pass a label + handler; no entity-specific header hacks.
 * - ENTITY-NAV-02: parent/back and X/close are separate controls with
 *   separate semantics — back never closes, close never navigates back.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { EntityDetailModal } from '../../../../modules/shared/src/ui/EntityDetailModal';

describe('BATCH-DETAIL-HANDOFF-01 — EntityDetailModal parent navigation', () => {
  it('ENTITY-NAV-01/02 — exposes a parent/back control that navigates without closing', () => {
    const onClose = jest.fn();
    const onNavigate = jest.fn();

    render(
      <EntityDetailModal
        entityId="order-1"
        onClose={onClose}
        title="Order #1001"
        parentNavigation={{ label: 'Batch D8A81DF2', onNavigate }}
      >
        <div>order body</div>
      </EntityDetailModal>,
    );

    const back = screen.getByRole('button', { name: /Batch D8A81DF2/ });
    const close = screen.getByRole('button', { name: /close/i });

    expect(back).not.toBe(close);
    expect(back).toHaveTextContent('Batch D8A81DF2');

    fireEvent.click(back);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ENTITY-NAV-02 — close closes without invoking parent navigation, for any entity type', () => {
    const onClose = jest.fn();
    const onNavigate = jest.fn();

    render(
      <EntityDetailModal
        entityId="variant-9"
        onClose={onClose}
        title="Variant SKU-9"
        parentNavigation={{ label: 'Product P-17', onNavigate }}
      >
        <div>variant body</div>
      </EntityDetailModal>,
    );

    expect(
      screen.getByRole('button', { name: /Product P-17/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('ENTITY-NAV-01 — renders no parent/back control when no parent is supplied', () => {
    render(
      <EntityDetailModal
        entityId="order-1"
        onClose={jest.fn()}
        title="Order #1001"
      >
        <div>order body</div>
      </EntityDetailModal>,
    );

    const buttons = screen.getAllByRole('button');

    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/close/i);
  });
});
