import { fireEvent, render, screen } from '@testing-library/react';
import { SpotlightCoachMark } from '../../../../modules/shared/src/ui/SpotlightCoachMark';

describe('SpotlightCoachMark', () => {
  it('keeps the default "Got it" acknowledgement for existing consumers', () => {
    const onDismiss = jest.fn();
    render(<SpotlightCoachMark title="Coach" body="Body" isDismissed={false} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders an optional primary action in place of "Got it" and invokes only onAction', () => {
    const onDismiss = jest.fn();
    const onAction = jest.fn();
    render(
      <SpotlightCoachMark
        title="Coach"
        body="Body"
        isDismissed={false}
        onDismiss={onDismiss}
        actionLabel="Open Floor settings"
        onAction={onAction}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Floor settings' }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('keeps the X control dismiss-only when a custom action is provided', () => {
    const onDismiss = jest.fn();
    const onAction = jest.fn();
    render(
      <SpotlightCoachMark
        title="Coach"
        body="Body"
        isDismissed={false}
        onDismiss={onDismiss}
        actionLabel="Open Floor settings"
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });
});
