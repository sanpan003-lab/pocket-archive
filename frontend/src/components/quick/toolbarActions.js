import {
  Pencil, Pin, PinOff, Palette, FolderInput, Merge, Share2, Trash2, RotateCcw, Sparkles,
  CheckCircle2, Split, RefreshCw, Users, Paperclip, Images,
} from 'lucide-react';
import { noteRole } from '../../lib/sharing';

/** Every note action, in the default order. `when` hides it where it doesn't apply. */
export const TOOLBAR_ACTIONS = [
  { id: 'edit', label: 'Edit', icon: Pencil, role: 'edit' },
  { id: 'attach', label: 'Attach', icon: Paperclip, role: 'edit' },
  // Photos / scan pages: reorder, rotate, crop, mark up, retake, split/merge, cover
  { id: 'pages', label: 'Pages', icon: Images, role: 'edit', when: n => n?.media?.kind === 'image' || (n?.attachments || []).some(a => a.kind === 'image' || a.pageList?.length) },
  { id: 'pin', label: n => (n?.pinned ? 'Unpin' : 'Pin'), icon: n => (n?.pinned ? PinOff : Pin) },
  { id: 'color', label: 'Color', icon: Palette },
  { id: 'project', label: n => (n?.projectId ? 'Project…' : 'Add to project'), icon: FolderInput },
  { id: 'merge', label: 'Merge', icon: Merge },
  { id: 'people', label: n => (n?.sharedFrom ? 'Sharing' : 'Share with…'), icon: Users, role: 'view' },
  { id: 'share', label: 'Share', icon: Share2, role: 'view' },
  { id: 'done', label: n => (n?.errandDone ? 'Reopen' : 'Mark done'), icon: n => (n?.errandDone ? RotateCcw : CheckCircle2), when: n => n?.type === 'errand', role: 'edit' },
  { id: 'summarize', label: 'Summarize', icon: Sparkles, when: n => !!(n?.transcript || n?.content || n?.mediaText || (n?.items || []).length), role: 'edit' },
  { id: 'split', label: 'Split back', icon: Split, when: n => (n?.combinedGroups || []).length > 0 },
  { id: 'retry', label: 'Retry AI', icon: RefreshCw, when: n => n?.status === 'needs_review' },
  { id: 'delete', label: 'Delete', icon: Trash2, danger: true },
];

// Notes shared with you: viewers get Sharing + Share, editors also Edit / Done / Summarize;
// everything else (pin, color, project, merge, delete, …) is the owner's
const RANK = { view: 0, edit: 1, owner: 2 };
export const allowedFor = (action, note) => RANK[noteRole(note)] >= RANK[action.role || 'owner'];

export const DEFAULT_ORDER = TOOLBAR_ACTIONS.map(a => a.id);
const BY_ID = Object.fromEntries(TOOLBAR_ACTIONS.map(a => [a.id, a]));

/** Settings → toolbar { order: 'a,b,…', hidden: 'x,y' } → ordered action list (unknown ids dropped, new ones appended) */
export function toolbarLayout(cfg = {}) {
  const order = String(cfg.order || '').split(',').filter(id => BY_ID[id]);
  const full = [...order, ...DEFAULT_ORDER.filter(id => !order.includes(id))];
  const hidden = new Set(String(cfg.hidden || '').split(',').filter(Boolean));
  return { order: full, hidden };
}

export const actionById = id => BY_ID[id];
export const resolve = (v, note) => (typeof v === 'function' ? v(note) : v);

/** NoteToolbar action id → the inbox page's onAction kind */
export const ACTION_KIND = { project: 'addToProject', merge: 'mergeInto' };
