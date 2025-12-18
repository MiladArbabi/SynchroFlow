//tests/unit/onboarding/deriveFt0Phase.test.ts
import { deriveFt0Phase } from 'ui/src/onboarding/deriveFt0Phase';
import { Ft0Phase } from 'ui/src/types/onboarding';

describe('deriveFt0Phase — FT-0 state machine', () => {
  const base = {
    hasIntegrations: false,
    isConnectModalOpen: false,
    isSyncModalOpen: false,
    syncStatus: 'NOT_FOUND',
    showPostSyncSkeleton: false,
  };

  it('returns PRE_CONNECT when no integrations and no modals', () => {
    expect(deriveFt0Phase(base)).toBe<Ft0Phase>('PRE_CONNECT');
  });

  it('returns CONNECTING when connect modal is open', () => {
    expect(
      deriveFt0Phase({
        ...base,
        isConnectModalOpen: true,
      })
    ).toBe('CONNECTING');
  });

  it('returns SYNCING when sync modal is open', () => {
    expect(
      deriveFt0Phase({
        ...base,
        isSyncModalOpen: true,
      })
    ).toBe('SYNCING');
  });

  it('returns SYNCING when integration exists but sync not completed', () => {
    expect(
      deriveFt0Phase({
        ...base,
        hasIntegrations: true,
        syncStatus: 'SYNCING_PRODUCTS',
      })
    ).toBe('SYNCING');
  });

  it('returns POST_SYNC_SKELETON when post-sync skeleton flag is set', () => {
    expect(
      deriveFt0Phase({
        ...base,
        hasIntegrations: true,
        syncStatus: 'COMPLETED',
        showPostSyncSkeleton: true,
      })
    ).toBe('POST_SYNC_SKELETON');
  });

  it('returns STEADY_STATE when integration completed and no skeleton', () => {
    expect(
      deriveFt0Phase({
        ...base,
        hasIntegrations: true,
        syncStatus: 'COMPLETED',
      })
    ).toBe('STEADY_STATE');
  });
});
