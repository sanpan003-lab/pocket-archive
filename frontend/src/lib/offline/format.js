// Offline status wording (2.9.0): the header chip and Settings › Offline & storage
import { CloudOff, RefreshCw, CheckCircle2, AlertTriangle, Download } from 'lucide-react';

export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const gb = b => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round((b || 0) / 1e3))} KB`);

/** What the chip says: { tone, icon, text } */
export function describe(st) {
  if (!st.online) return { tone: 'offline', Icon: CloudOff, text: `Offline · last synced ${ago(st.lastSyncAt)}` };
  if (st.conflicts > 0) return { tone: 'warn', Icon: AlertTriangle, text: `${st.conflicts} note${st.conflicts === 1 ? '' : 's'} edited on 2 devices` };
  if (st.pending > 0) return { tone: 'busy', Icon: RefreshCw, text: `Syncing ${st.pending} change${st.pending === 1 ? '' : 's'}…` };
  const p = st.progress;
  if (p && p.bytesTotal > 0 && p.bytesDone < p.bytesTotal) return { tone: 'busy', Icon: Download, text: `Downloading for offline · ${gb(p.bytesDone)} of ${gb(p.bytesTotal)}` };
  if (st.syncing) return { tone: 'busy', Icon: RefreshCw, text: 'Syncing…' };
  return { tone: 'ok', Icon: CheckCircle2, text: 'Up to date' };
}

