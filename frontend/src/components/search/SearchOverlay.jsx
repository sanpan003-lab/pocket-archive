import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { OPEN_SEARCH } from '../../lib/uiBus';
import NoteSearch from './NoteSearch';

/**
 * Global search from the header (mobile top bar / desktop header), Ctrl+K or "/" anywhere
 * (on Settings "/" searches the settings). Full screen on a phone, a panel on a computer.
 */
export default function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = e => {
      const t = e.target;
      const typing = t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); return; }
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('[data-settings-search], [data-note-search="bar"], [data-note-search="page"]')) {
        e.preventDefault(); setOpen(true);
      }
    };
    window.addEventListener(OPEN_SEARCH, show);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(OPEN_SEARCH, show); window.removeEventListener('keydown', onKey); };
  }, []);

  // Navigating away (a result was opened, Back) closes it
  const [path, setPath] = useState(pathname);
  if (path !== pathname) { setPath(pathname); if (open) setOpen(false); }

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[230] flex items-start justify-center md:p-6 md:pt-16" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 hidden md:block bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="relative w-full h-full md:h-auto md:max-h-[80vh] md:max-w-2xl overflow-y-auto note-surface md:rounded-3xl shadow-2xl px-4 pb-6 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-4">
        <div className="flex items-start gap-1">
          <button type="button" className="shrink-0 w-11 h-11 -ml-2 flex items-center justify-center rounded-xl text-navy-600 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setOpen(false)} aria-label="Close search"><ArrowLeft size={20} /></button>
          <div className="flex-1 min-w-0">
            <NoteSearch variant="overlay" autoFocus onClose={() => setOpen(false)} placeholder="Search everything…" />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
