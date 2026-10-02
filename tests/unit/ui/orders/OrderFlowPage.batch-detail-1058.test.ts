/**
 * GH-1058
 *
 * Fulfillment batch cards are entity-inspection controls:
 * - card click opens the exact batch detail
 * - Enter / Space provide equivalent keyboard access
 * - pending cancel remains an independent action and must not open detail
 *
 * BATCH-DETAIL-HANDOFF-01 — Batch → Order inspection handoff:
 * - BATCH-HANDOFF-01: Batch → Order retains the originating batch context
 * - BATCH-HANDOFF-02: Order → Back restores the same Batch Detail
 * - BATCH-HANDOFF-03: Order X closes both Order and retained Batch context
 * - BATCH-HANDOFF-04: Batch and Order modals are never open together
 */
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { renderWithProviders } from 'test-utils';
import OrderFlowPage from 'pages/ft2-pages/OrderFlowPage';

const mockFlowBatch = {
  pick_batch_id: 'abcd1234-flow-batch',
  status: 'picking',
  release_trigger: 'manual',
  total_line_items: 3,
  total_units: 10,
  units_picked: 4,
  units_packed: 0,
  picked_by: 7,
  packed_by: null,
  pick_claimed_at: '2026-09-08T12:00:00.000Z',
  pick_completed_at: null,
  pack_claimed_at: null,
  pack_completed_at: null,
  released_at: '2026-09-08T11:30:00.000Z',
  assigned_operator_id: 7,
  assigned_packer_id: null,
  picker_name: 'Ava Picker',
  packer_name: null,
};

const mockMutation = () => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
});

jest.mock('pages/orders/useConstrainedOrders', () => ({
  getAgeLabel: () => '',
  getBlockerReason: () => '',
  getConstraintLabel: () => '',
  useConstrainedOrders: () => ({
    data: { data: [] },
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useOrderPool: () => ({
    data: { orders: [], eligible_order_count: 0 },
    isLoading: false,
    isError: false,
  }),
  useReleaseBatch: () => mockMutation(),
  useSetPriority: () => mockMutation(),
  useBulkSetPriority: () => mockMutation(),
}));

jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatches: () => ({
    data: { batches: [mockFlowBatch] },
    isLoading: false,
    isError: false,
  }),
  useCancelBatch: () => mockMutation(),
}));

jest.mock('pages/wms/useWmsOperators', () => ({
  useWmsOperators: () => ({ data: { operators: [] } }),
}));

jest.mock('pages/wms/useWmsAnalytics', () => ({
  useLiveCapacity: () => ({ data: undefined }),
}));

jest.mock('hooks/useSpotlight', () => ({
  useSpotlight: () => ({
    isDismissed: true,
    isLoading: false,
    dismiss: jest.fn(),
  }),
}));

jest.mock('components/ModuleTabBar', () => ({
  ModuleTabBar: () => null,
}));

// Real shared shell: the parent/back affordance and close semantics under
// test are owned by EntityDetailModal itself.
jest.mock('@lasyncro/shared/ui', () => ({
  EntityDetailModal: jest.requireActual(
    '../../../../modules/shared/src/ui/EntityDetailModal',
  ).EntityDetailModal,
  SpotlightCoachMark: () => null,
}));

jest.mock('pages/orders/OrderDetailModalBody', () => ({
  OrderDetailModalBody: ({ orderId }: { orderId: string }) =>
    require('react').createElement(
      'div',
      { 'data-testid': 'order-detail-body' },
      `ORDER:${orderId}`,
    ),
}));

jest.mock('pages/ft2-pages/BatchDetailModalBody', () => ({
  BatchDetailModalBody: ({
    batch,
    onNavigateToOrder,
  }: {
    batch: { pick_batch_id: string };
    onNavigateToOrder: (orderId: string) => void;
  }) =>
    require('react').createElement(
      'div',
      { 'data-testid': 'batch-detail-body' },
      `BATCH:${batch.pick_batch_id}`,
      require('react').createElement(
        'button',
        {
          type: 'button',
          onClick: () => onNavigateToOrder('order-from-batch'),
        },
        'Open member order',
      ),
    ),
}));

it('GH-1058 — fulfillment batch card opens detail accessibly while cancel stays isolated', () => {
  const filename = resolve(
    __dirname,
    '../../../../apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx',
  );

  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const descendants = (
    root: ts.Node,
    predicate: (node: ts.Node) => boolean,
  ): ts.Node[] => {
    const found: ts.Node[] = [];

    const visit = (node: ts.Node) => {
      if (predicate(node)) found.push(node);
      ts.forEachChild(node, visit);
    };

    visit(root);
    return found;
  };

  type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

  const prop = (
    node: Opening,
    name: string,
  ): ts.JsxAttribute | undefined =>
    node.attributes.properties.find(
      (item): item is ts.JsxAttribute =>
        ts.isJsxAttribute(item) &&
        item.name.getText(source) === name,
    );

  const expressionProp = (
    node: Opening,
    name: string,
  ): ts.Expression | undefined => {
    const attribute = prop(node, name);

    return attribute?.initializer &&
      ts.isJsxExpression(attribute.initializer)
      ? attribute.initializer.expression
      : undefined;
  };

  const maps = descendants(
    source,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'map' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'batches',
  ) as ts.CallExpression[];

  expect(maps).toHaveLength(1);

  const callback = maps[0].arguments[0];

  if (
    !ts.isArrowFunction(callback) &&
    !ts.isFunctionExpression(callback)
  ) {
    throw new Error('Missing batches.map callback');
  }

  const batchParameter = callback.parameters[0].name;

  if (!ts.isIdentifier(batchParameter)) {
    throw new Error('Missing batch callback parameter');
  }

  const openings = descendants(
    callback,
    (node) =>
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node),
  ) as Opening[];

  const cards = openings.filter((node) => {
    const key = expressionProp(node, 'key');

    return (
      key &&
      ts.isPropertyAccessExpression(key) &&
      ts.isIdentifier(key.expression) &&
      key.expression.text === batchParameter.text &&
      key.name.text === 'pick_batch_id'
    );
  });

  expect(cards).toHaveLength(1);

  const card = cards[0];

  // Semantic keyboard-inspection control.
  const role = prop(card, 'role');
  expect(
    role?.initializer &&
      ts.isStringLiteral(role.initializer) &&
      role.initializer.text,
  ).toBe('button');

  const tabIndex = expressionProp(card, 'tabIndex');
  expect(tabIndex?.getText(source)).toBe('0');

  // Pending cancel control must stay independent from opening the card.
  const controls = descendants(
    card.parent,
    (node) =>
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node),
  ) as Opening[];

  const cancelControls = controls.filter((node) => {
    const aria = prop(node, 'aria-label');
    return aria?.getText(source).includes('Cancel batch') ?? false;
  });

  expect(cancelControls).toHaveLength(1);

  const batch = {
    pick_batch_id: 'abcd1234-1058-batch',
    status: 'pending',
  };

  const setSelectedBatchId = jest.fn();
  const setCancelError = jest.fn();
  const setCancelConfirmBatchId = jest.fn();

  const compileHandler = (
    element: Opening,
    eventName: string,
  ) => {
    const handler = expressionProp(element, eventName);

    if (!handler) {
      throw new Error(`Missing ${eventName} handler`);
    }

    const javascript = ts.transpileModule(
      `const handler = ${handler.getText(source)};`,
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.None,
        },
      },
    ).outputText;

    return new Function(
      batchParameter.text,
      'setSelectedBatchId',
      'setCancelError',
      'setCancelConfirmBatchId',
      `${javascript}\nreturn handler;`,
    )(
      batch,
      setSelectedBatchId,
      setCancelError,
      setCancelConfirmBatchId,
    );
  };

  const cancelHandler = compileHandler(
    cancelControls[0],
    'onClick',
  );

  const cancelEvent = {
    stopPropagation: jest.fn(),
  };

  cancelHandler(cancelEvent);

  expect(cancelEvent.stopPropagation).toHaveBeenCalledTimes(1);
  expect(setCancelConfirmBatchId).toHaveBeenCalledTimes(1);
  expect(setSelectedBatchId).not.toHaveBeenCalled();

  // Mouse/card activation opens the exact batch.
  const clickHandler = compileHandler(card, 'onClick');

  clickHandler({});

  expect(setSelectedBatchId).toHaveBeenCalledTimes(1);
  expect(setSelectedBatchId).toHaveBeenLastCalledWith(
    batch.pick_batch_id,
  );

  setSelectedBatchId.mockClear();

  // Keyboard activation mirrors click.
  const keyHandler = compileHandler(card, 'onKeyDown');

  const enterEvent = {
    key: 'Enter',
    preventDefault: jest.fn(),
  };

  keyHandler(enterEvent);

  expect(enterEvent.preventDefault).toHaveBeenCalledTimes(1);
  expect(setSelectedBatchId).toHaveBeenCalledWith(
    batch.pick_batch_id,
  );

  setSelectedBatchId.mockClear();

  const spaceEvent = {
    key: ' ',
    preventDefault: jest.fn(),
  };

  keyHandler(spaceEvent);

  expect(spaceEvent.preventDefault).toHaveBeenCalledTimes(1);
  expect(setSelectedBatchId).toHaveBeenCalledWith(
    batch.pick_batch_id,
  );

  setSelectedBatchId.mockClear();

  keyHandler({
    key: 'Escape',
    preventDefault: jest.fn(),
  });

  expect(setSelectedBatchId).not.toHaveBeenCalled();
});

describe('BATCH-DETAIL-HANDOFF-01 — Order Flow Batch → Order inspection handoff', () => {
  // Counts every mounted dialog, including any MUI marks aria-hidden when a
  // second modal stacks on top — a nested/stacked modal must not be hidden
  // from this count.
  const dialogs = () => screen.queryAllByRole('dialog', { hidden: true });

  const openBatchThenOrder = async () => {
    renderWithProviders(React.createElement(OrderFlowPage));

    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect batch ABCD1234' }),
    );

    await waitFor(() => expect(dialogs()).toHaveLength(1));
    expect(screen.getByTestId('batch-detail-body')).toHaveTextContent(
      'BATCH:abcd1234-flow-batch',
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Open member order' }),
    );

    // BATCH-HANDOFF-04: Order Detail replaces the visible Batch Detail —
    // never nested or stacked over it.
    await waitFor(() => expect(dialogs()).toHaveLength(1));
    expect(screen.getByTestId('order-detail-body')).toHaveTextContent(
      'ORDER:order-from-batch',
    );
    expect(screen.queryByTestId('batch-detail-body')).not.toBeInTheDocument();

    return dialogs()[0];
  };

  it('BATCH-UX-01 — Batch Detail uses the canonical lg/default EntityDetailModal shell', async () => {
    renderWithProviders(React.createElement(OrderFlowPage));

    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect batch ABCD1234' }),
    );

    await waitFor(() => expect(dialogs()).toHaveLength(1));
    expect(screen.getByTestId('batch-detail-body')).toBeInTheDocument();
    expect(dialogs()[0]).toHaveClass('MuiDialog-paperWidthLg');
  });

  it('BATCH-HANDOFF-01/02/04 — Order Detail exposes the retained batch as parent and Back restores the same Batch Detail', async () => {
    const orderDialog = await openBatchThenOrder();

    // BATCH-HANDOFF-01: the originating batch context is retained and
    // exposed as the generic parent/back affordance on Order Detail.
    const back = within(orderDialog).getByRole('button', {
      name: /Batch ABCD1234/,
    });

    fireEvent.click(back);

    // BATCH-HANDOFF-02: Back clears only Order Detail and restores the
    // same Batch Detail.
    await waitFor(() => expect(dialogs()).toHaveLength(1));
    expect(screen.queryByTestId('order-detail-body')).not.toBeInTheDocument();
    expect(screen.getByTestId('batch-detail-body')).toHaveTextContent(
      'BATCH:abcd1234-flow-batch',
    );
  });

  it('BATCH-HANDOFF-03 — Order X closes Order Detail and the retained Batch context', async () => {
    const orderDialog = await openBatchThenOrder();

    fireEvent.click(
      within(orderDialog).getByRole('button', { name: /close/i }),
    );

    // A retained-but-uncleared batch would resurface here once Order
    // Detail closes; the whole inspection flow must end instead.
    await waitFor(() => expect(dialogs()).toHaveLength(0));
    expect(screen.queryByTestId('order-detail-body')).not.toBeInTheDocument();
    expect(screen.queryByTestId('batch-detail-body')).not.toBeInTheDocument();
  });
});
