import { fireEvent, render, screen } from '@testing-library/react';
import { DecisionConfirmationModal } from '../../../../modules/shared/src/ui/DecisionConfirmationModal';

describe('DecisionConfirmationModal', () => {
  it('renders a compact decision with safe cancel focus and confirms once', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();

    render(
      <DecisionConfirmationModal
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Duplicate 3 components?"
        description="3 new components will be created. The originals will stay unchanged."
        confirmLabel="Duplicate"
      />,
    );

    expect(screen.getByText('Duplicate 3 components?')).toBeInTheDocument();
    expect(
      screen.getByText('3 new components will be created. The originals will stay unchanged.'),
    ).toBeInTheDocument();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Duplicate' });

    expect(cancel).toHaveFocus();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses destructive treatment for destructive decisions', () => {
    render(
      <DecisionConfirmationModal
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Delete 3 components?"
        description="The selected components will be removed."
        confirmLabel="Delete"
        tone="destructive"
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Delete' });

    expect(confirm).toHaveAttribute('data-tone', 'destructive');
  });

  it('allows dismissal while idle', () => {
    const onClose = jest.fn();

    render(
      <DecisionConfirmationModal
        open
        onClose={onClose}
        onConfirm={jest.fn()}
        title="Delete component?"
        confirmLabel="Delete"
        tone="destructive"
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Escape',
      code: 'Escape',
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks dismissal and duplicate actions while pending', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();

    render(
      <DecisionConfirmationModal
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete 3 components?"
        confirmLabel="Delete"
        tone="destructive"
        isPending
      />,
    );

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: /^Delete/ });

    expect(cancel).toBeDisabled();
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);
    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Escape',
      code: 'Escape',
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('supports a disabled commit action independently of pending state', () => {
    render(
      <DecisionConfirmationModal
        open
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Duplicate selected?"
        confirmLabel="Duplicate"
        confirmDisabled
      />,
    );

    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
  });
});
