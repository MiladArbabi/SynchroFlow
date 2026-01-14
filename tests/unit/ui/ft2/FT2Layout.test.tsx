import React from 'react';
import { render } from '@testing-library/react';
import { FT2Layout, FT2Surface } from '@lasyncro/ui-ft2';

describe('FT2Layout (structural only)', () => {
  it('renders children deterministically', () => {
    const { getByText } = render(
      <FT2Layout>
        <FT2Surface>
          <div>Top</div>
        </FT2Surface>
        <FT2Surface>
          <div>Middle</div>
        </FT2Surface>
        <FT2Surface>
          <div>Bottom</div>
        </FT2Surface>
      </FT2Layout>
    );

    expect(getByText('Top')).toBeInTheDocument();
    expect(getByText('Middle')).toBeInTheDocument();
    expect(getByText('Bottom')).toBeInTheDocument();
  });
});