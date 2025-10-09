import { render, screen } from '@testing-library/react';
import { SimulationModal } from './SimulationModal';

test('is hidden by default', () => {
  render(<SimulationModal isOpen={false} onClose={() => {}} />);
  
  // The title of the modal should not be in the document
  const titleElement = screen.queryByRole('heading', { name: /Simulate a Scenario/i });
  expect(titleElement).not.toBeInTheDocument();
});

test('is visible when isOpen is true', () => {
  render(<SimulationModal isOpen={true} onClose={() => {}} />);

  // The title of the modal SHOULD be in the document
  const titleElement = screen.getByRole('heading', { name: /Simulate a Scenario/i });
  expect(titleElement).toBeInTheDocument();
});