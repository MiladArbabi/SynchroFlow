import {
  claimShopifyUninstallVerification,
  nextShopifyUninstallRecoveryShop,
  readOwnedShopifyUninstallVerification,
  settleShopifyUninstallRecovery,
  settleShopifyUninstallVerification,
} from '../services/shopify/shopifyUninstallVerification.repository.js';
import { resolveShopifyAdminCredentialForUninstallVerification } from '../services/shopify/shopifyAdminCredentialConsumer.service.js';
import {
  graphqlClient,
  providerRequest,
  SHOPIFY_DISCONNECT_PRECHECK_QUERY,
} from '../services/shopify/shopifyAppDisconnect.service.js';

const POLL_INTERVAL_MS = 1_000;
let stopped = true;
let timer: ReturnType<typeof setTimeout> | null = null;
let cycle: Promise<void> | null = null;
let stopping: Promise<void> | null = null;

const normalizeDomain = (value: string) => value.trim().toLowerCase();

export async function processShopifyUninstallVerificationOnce(): Promise<'IDLE' | 'SETTLED'> {
  // Recovery precedes provider probing and also covers exhausted rows. The
  // cross-tenant discovery returns only a shop id; the tenant-scoped settlement
  // re-checks the identical eligibility under the T2 lock. A candidate that is
  // no longer eligible settles nothing and is not rediscovered.
  const recoveryShopId = await nextShopifyUninstallRecoveryShop();
  if (recoveryShopId !== null) {
    const recovered = await settleShopifyUninstallRecovery(recoveryShopId);
    if (recovered > 0) return 'SETTLED';
  }
  const claim = await claimShopifyUninstallVerification();
  if (!claim) return 'IDLE';
  const authority = await readOwnedShopifyUninstallVerification(claim);
  if (!authority) return 'IDLE';

  const credential = await resolveShopifyAdminCredentialForUninstallVerification({
    shopId: claim.shopId, verificationId: claim.id, claimToken: claim.claimToken,
  });
  if (credential.kind === 'SUPERSEDED') {
    // A moved installation/generation is not recovery proof: stay blocking for
    // the proof-backed recovery path (no generation-only supersession).
    await settleShopifyUninstallVerification(authority, 'UNRESOLVED', 'AUTHORITY_CHANGED');
    return 'SETTLED';
  }
  if (credential.kind !== 'READY') {
    await settleShopifyUninstallVerification(authority, 'UNRESOLVED', 'AUTHORITY_UNAVAILABLE');
    return 'SETTLED';
  }

  try {
    const client = await graphqlClient(credential.accessToken, credential.shopDomain, claim.shopId);
    const evidence: any = await providerRequest(client, SHOPIFY_DISCONNECT_PRECHECK_QUERY);
    const servedDomain = evidence?.data?.shop?.myshopifyDomain;
    const installationGid = evidence?.data?.currentAppInstallation?.id;
    if (typeof servedDomain === 'string'
      && normalizeDomain(servedDomain) === normalizeDomain(credential.shopDomain)
      && typeof installationGid === 'string' && installationGid.length > 0) {
      await settleShopifyUninstallVerification(authority, 'CURRENT_AUTHORITY_VERIFIED', 'CURRENT_AUTHORITY_LIVE');
    } else {
      await settleShopifyUninstallVerification(authority, 'UNRESOLVED', 'PROVIDER_EVIDENCE_MALFORMED');
    }
  } catch {
    // 401, timeouts, transport errors and provider errors are equally
    // non-authoritative for uninstall identity.
    await settleShopifyUninstallVerification(authority, 'UNRESOLVED', 'PROVIDER_UNVERIFIED');
  }
  return 'SETTLED';
}

function schedule(delay: number): void {
  if (stopped) return;
  timer = setTimeout(() => {
    timer = null;
    if (stopped) return;
    cycle = processShopifyUninstallVerificationOnce()
      .then(() => undefined)
      .catch(error => console.error('[shopify-uninstall-verification] iteration failed', {
        message: error instanceof Error ? error.message : 'unknown',
      }))
      .finally(() => { cycle = null; schedule(POLL_INTERVAL_MS); });
  }, delay);
}

export function startShopifyUninstallVerificationWorker(): void {
  if (!stopped || stopping) return;
  stopped = false;
  schedule(0);
  console.info('[shopify-uninstall-verification] Worker started');
}

export function stopShopifyUninstallVerificationWorker(): Promise<void> {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  if (stopping) return stopping;
  stopping = Promise.resolve(cycle).then(() => undefined).finally(() => { stopping = null; });
  return stopping;
}
