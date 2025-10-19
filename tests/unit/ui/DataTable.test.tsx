// packages/ui/src/components/DataTable.test.tsx
import { render, screen } from '@testing-library/react';
import { DataTable } from '../../../packages/ui/src/components/DataTable';
import { createColumnHelper } from '@tanstack/react-table';

// Define a sample data type and mock data/columns
type SampleData = { col1: string; col2: number };
const columnHelper = createColumnHelper<SampleData>();
const columns = [
  columnHelper.accessor('col1', { header: 'Header 1', cell: info => info.getValue() }),
  columnHelper.accessor('col2', { header: 'Header 2', cell: info => info.getValue() }),
];
const data: SampleData[] = [
  { col1: 'Row 1 Cell 1', col2: 111 },
  { col1: 'Row 2 Cell 1', col2: 222 },
];

describe('DataTable', () => {
  it('renders headers and data cells correctly', () => {
    render(<DataTable columns={columns} data={data} />);

    // Robustly check for key structural elements
    expect(screen.getByRole('columnheader', { name: 'Header 1' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Header 2' })).toBeInTheDocument();

    // And confirm the data is rendered
    expect(screen.getByText('Row 1 Cell 1')).toBeInTheDocument();
    expect(screen.getByText('222')).toBeInTheDocument();
  });
});