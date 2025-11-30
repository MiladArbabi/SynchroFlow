// apps/frontend/src/pages/ProductIntelligencePage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductIntelligencePage } from '../../../apps/frontend/src/pages/ProductIntelligencePage'

// Mock the DataMapper component
jest.mock('../../../apps/frontend/src/components/DataMapper/DataMapper.tsx', () => () => <div>Mocked DataMapper</div>);

describe('ProductIntelligencePage', () => {
  it('renders the DataMapper component', () => {
    render(
      <MemoryRouter>
        <ProductIntelligencePage />
      </MemoryRouter>
    );

    // Check that the page renders our mocked component
    expect(screen.getByText('Mocked DataMapper')).toBeInTheDocument();
  });
});