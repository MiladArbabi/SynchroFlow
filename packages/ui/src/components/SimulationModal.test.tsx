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

test('renders the simulation form fields when open', () => {
  render(<SimulationModal isOpen={true} onClose={() => {}} />);

  // Look for the "Payment Amount" input field
  expect(screen.getByLabelText(/Payment Amount/i)).toBeInTheDocument();

  // Look for the "Delay Period" input field
  expect(screen.getByLabelText(/Delay by/i)).toBeInTheDocument();

  // Look for the "Run Simulation" button
  expect(screen.getByRole('button', { name: /Run Simulation/i })).toBeInTheDocument();
<<<<<<< Updated upstream
});
=======
});
>>>>>>> Stashed changes
