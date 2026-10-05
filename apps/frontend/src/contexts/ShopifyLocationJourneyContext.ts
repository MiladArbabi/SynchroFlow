import { createContext } from 'react';

// Presentation transport only. Canonical readiness owns all completion facts.
export const SHOPIFY_LOCATION_JOURNEY = 'first-entry-shopify-location';
export const SHOPIFY_LOCATION_CONTINUATION = 'shopify-location-saved';

export interface ShopifyLocationJourneyState {
  onboardingJourney?: typeof SHOPIFY_LOCATION_JOURNEY;
  onboardingContinuation?: typeof SHOPIFY_LOCATION_CONTINUATION;
}

// The mapping page reports a successful write, never onboarding completion.
export const ShopifyLocationPersistenceContext = createContext<(() => void) | null>(null);
