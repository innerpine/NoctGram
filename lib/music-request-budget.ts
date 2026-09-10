import { rateLimit } from './rate-limit';

// All connected providers and every imported page share one account budget.
// Charge before upstream work so failures and concurrent requests also count.
export function musicProviderRequestLimit(user: string) {
  return rateLimit('music-provider', user, 60, 60);
}
