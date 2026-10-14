import { useEffect } from 'react';

/**
 * While any quick note's AI summary is "pending", call refresh() every 3s.
 * Stops after 60s for a given set of pending notes. One request per list,
 * not one per card.
 */
export function useSummaryPolling(notes, refresh, { intervalMs = 3000, maxMs = 60000 } = {}) {
  const pendingKey = notes
    .filter(n => n.summaryStatus === 'pending' && !n.undone)
    .map(n => n.id)
    .sort()
    .join(',');

  useEffect(() => {
    if (!pendingKey) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > maxMs) { clearInterval(timer); return; }
      refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [pendingKey, refresh, intervalMs, maxMs]);
}
