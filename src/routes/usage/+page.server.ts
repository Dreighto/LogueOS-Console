import { getUsageMetrics, getUsageHistory } from '$lib/server/usage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const raw = parseInt(url.searchParams.get('days') ?? '30', 10);
  const days = isNaN(raw) ? 30 : Math.min(Math.max(raw, 7), 365);
  const metrics = getUsageMetrics();
  const history = getUsageHistory(days);
  return { metrics, history, days };
};
