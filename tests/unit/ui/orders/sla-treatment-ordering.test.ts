import { comparePoolOrders } from 'pages/ft2-pages/orderPoolSorting';
it('SLA-TREAT-01 merchant priority > breached > approaching > normal > operator tie-break', () => {
  const row = (id: string, priority: boolean, state: string, value: string) => ({ id, is_priority_flagged: priority, sla_state: state, is_shipping_sla_breached: state === 'breached', order_created_at: '2026-09-01', total_price: value, line_item_count: 1, unit_count: 1 });
  const rows = [row('normal', false, 'normal', '100'), row('approaching-low', false, 'approaching', '1'), row('breached', false, 'breached', '0'), row('priority', true, 'normal', '0'), row('approaching-high', false, 'approaching', '10')];
  expect(rows.sort(comparePoolOrders('value', 'desc')).map(r => r.id)).toEqual(['priority', 'breached', 'approaching-high', 'approaching-low', 'normal']);
});
