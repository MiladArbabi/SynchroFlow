// tests/unit/ui/hooks/useKoreRanking.test.tsx
import { renderHook } from '@testing-library/react';
import { useKoreRanking } from 'components/OpsCommandCenter/hooks/useKoreRanking';
import { OpsContextState } from 'contexts/OpsContext';
import { OpsAction, SearchResult } from 'components/OpsCommandCenter/types';
import { NavigateFunction } from 'react-router-dom';

describe('useKoreRanking', () => {

  const createMockAction = (overrides: Partial<OpsAction> = {}): OpsAction => ({
    id: 'default-action',
    name: 'Default Action',
    description: 'Default description',
    keywords: [],
    category: 'safe',
    context: {
      pages: [],
      requiredPermissions: [],
    },
    execute: async (_context: OpsContextState, _navigate: NavigateFunction) => ({
      success: true,
      message: '',
    }),
    ...overrides,
  });

  const createMockEntity = (overrides: Partial<SearchResult> = {}): SearchResult => ({
    id: 'default-entity',
    type: 'order',
    title: 'Default Title',
    description: 'Default description',
    url: '/default',
    ...overrides,
  });

  const defaultContext: OpsContextState = {
    page: 'home',
    userPermissions: ['perm1', 'perm2'],
  } as OpsContextState; // Cast if more fields are required

  it('should return an empty list if no results are provided', () => {
    const { result } = renderHook(() => useKoreRanking([], [], defaultContext));
    expect(result.current).toHaveLength(0);
  });

  it('should boost results relevant to the current page context', () => {
    const actions: OpsAction[] = [
      createMockAction({
        id: 'find-order',
        context: {
          pages: ['orders'],
          requiredPermissions: [],
        },
      }),
      createMockAction({
        id: 'find-customer',
        context: {
          pages: ['customers'],
          requiredPermissions: [],
        },
      }),
    ];

    const entities: SearchResult[] = [
      createMockEntity({ id: 'ord-1', type: 'order' }),
      createMockEntity({ id: 'cust-1', type: 'customer' }),
    ];

    const context: OpsContextState = {
      ...defaultContext,
      page: 'orders',
    } as OpsContextState;

    const { result } = renderHook(() => useKoreRanking(actions, entities, context));

    expect(result.current[0].id).toBe('find-order');
    expect(result.current[1].id).toBe('ord-1');
    expect(result.current[2].id).toBe('find-customer');
    expect(result.current[3].id).toBe('cust-1');
  });

  it('should put all actions before all entities if no context matches', () => {
    const actions: OpsAction[] = [
      createMockAction({
        id: 'act1',
        context: { pages: ['other'], requiredPermissions: [] },
      }),
      createMockAction({
        id: 'act2',
        context: { pages: ['other'], requiredPermissions: [] },
      }),
    ];

    const entities: SearchResult[] = [
      createMockEntity({ id: 'ent1', type: 'order' }),
      createMockEntity({ id: 'ent2', type: 'customer' }),
    ];

    const context: OpsContextState = {
      ...defaultContext,
      page: 'home',
    } as OpsContextState;

    const { result } = renderHook(() => useKoreRanking(actions, entities, context));

    expect(result.current[0].id).toBe('act1');
    expect(result.current[1].id).toBe('act2');
    expect(result.current[2].id).toBe('ent1');
    expect(result.current[3].id).toBe('ent2');
  });

  it('should apply permission boost only if user has all required permissions', () => {
    const actions: OpsAction[] = [
      createMockAction({
        id: 'permitted-action',
        context: { pages: [], requiredPermissions: ['perm1'] },
      }),
      createMockAction({
        id: 'unpermitted-action',
        context: { pages: [], requiredPermissions: ['perm3'] },
      }),
    ];

    const { result } = renderHook(() => useKoreRanking(actions, [], defaultContext));

    expect(result.current[0].id).toBe('permitted-action');
    expect(result.current[1].id).toBe('unpermitted-action');
  });

  it('should not apply permission boost if requiredPermissions is undefined', () => {
    const actions: OpsAction[] = [
      createMockAction({
        id: 'no-perms-defined',
        context: { pages: [], requiredPermissions: undefined },
      }),
    ];

    const { result } = renderHook(() => useKoreRanking(actions, [], defaultContext));

    expect(result.current).toHaveLength(1);
  });

  it('should rank entities by page boost without actions', () => {
    const entities: SearchResult[] = [
      createMockEntity({ id: 'ord-1', type: 'order' }),
      createMockEntity({ id: 'cust-1', type: 'customer' }),
    ];

    const context: OpsContextState = {
      ...defaultContext,
      page: 'customers',
    } as OpsContextState;

    const { result } = renderHook(() => useKoreRanking([], entities, context));

    expect(result.current[0].id).toBe('cust-1');
    expect(result.current[1].id).toBe('ord-1');
  });

  it('should use type boost as tie-breaker when scores are otherwise equal', () => {
    const actions: OpsAction[] = [
      createMockAction({
        id: 'action-no-boost',
        context: { pages: [], requiredPermissions: ['perm3'] },
      }),
    ];

    const entities: SearchResult[] = [
      createMockEntity({ id: 'entity-no-boost', type: 'product' }),
    ];

    const context: OpsContextState = {
      ...defaultContext,
      page: 'home',
    } as OpsContextState;

    const { result } = renderHook(() => useKoreRanking(actions, entities, context));

    expect(result.current[0].id).toBe('action-no-boost');
    expect(result.current[1].id).toBe('entity-no-boost');
  });
});