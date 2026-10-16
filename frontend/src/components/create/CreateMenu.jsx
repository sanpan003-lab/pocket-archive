import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, Mic, Type, ListChecks, Image as ImageIcon, Brush } from 'lucide-react';
import { useAppearance, useHaptics } from '../../context/appearanceStore';
import { useFabHidden, notifyQuickChanged } from '../../lib/uiBus';
import { decideQuickNote, undoQuickNote } from '../../lib/api';
import QuickToast from '../quick/QuickToast';
import { confirmationFor } from '../quick/quickMeta';
import NoteComposer from './NoteComposer';
import ImageComposer from './ImageComposer';
import DrawingComposer from './DrawingComposer';

// Bottom → top as the menu fans upward (Voice closest to the button)
const OPTIONS = [
  { key: 'voice',   label: 'Voice',   icon: Mic },
  { key: 'text',    label: 'Text',    icon: Type },
  { key: 'list',    label: 'List',    icon: ListChecks },
  { key: 'image',   label: 'Image',   icon: ImageIcon },
  { key: 'drawing', label: 'Drawing', icon: Brush },
];

const CAPTURE_ROUTES = /^\/(quick(\/.*)?|projects(\/.*)?)$/;

/**
 * Google Keep-style "+" button: speed dial with Voice / Text / List / Image /
 * Drawing. Shown on Quick Capture, Inbox and Projects (or everywhere).
 */
export default function CreateMenu() {
  const { settings, motion } = useAppearance();
  const haptic = useHaptics();
  const hidden = useFabHidden();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [composer, setComposer] = useState(null);   // 'text' | 'list' | 'image' | 'drawing'
  const [toast, setToast] = useState(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const showHere = settings.behavior.createButton === 'everywhere' || CAPTURE_ROUTES.test(pathname);
  const opened = /^\/quick\/qn_/.test(pathname);    // a note is open on top

  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function pick(key) {
    setOpen(false);
    setToast(null); // don't cover the next editor's Save button
    haptic(10);
    if (key === 'voice') {
      // Already on Quick Capture: start there; otherwise go and start
      if (pathname === '/quick') window.dispatchEvent(new CustomEvent('pa:start-voice'));
      else navigate('/quick?voice=1');
      return;
    }
    setComposer(key);
  }

  function saved(result) {
    setComposer(null);
    const note = result.note;
    notifyQuickChanged(note);
    const conf = result.confirmation || confirmationFor(note) || { icon: '📝', text: 'Saved', tone: 'success' };
    const actions = [];
    if (note.status === 'pending_decision') {
      actions.push({ label: 'Yes', onClick: async () => { const r = await decideQuickNote(note.id, 'yes'); notifyQuickChanged(r.note); setToast({ id: Date.now(), ...(r.confirmation || { icon: '✅', text: 'Added', tone: 'success' }) }); } });
      actions.push({ label: 'New note', onClick: async () => { const r = await decideQuickNote(note.id, 'new'); notifyQuickChanged(r.note); } });
    } else {
      if (note.kind !== 'append') actions.push({ label: 'Open', onClick: () => navigate(`/quick/${note.id}`) });
      actions.push({ label: 'Undo', onClick: async () => { await undoQuickNote(note.id); notifyQuickChanged(); setToast({ id: Date.now(), icon: '↩️', text: 'Undone', tone: 'queued' }); } });
      if (note.appliedTo && note.appendConfirmation?.movable !== false) actions.push({ label: 'Move', onClick: () => navigate(`/quick/inbox?move=${note.id}`) });
    }
    setToast({ ...conf, id: Date.now(), duration: note.status === 'pending_decision' ? 120000 : 30000, actions });
  }

  const animate = motion === 'full';
  const visible = showHere && !hidden && !opened;

  return (
    <>
      <QuickToast toast={toast} onDismiss={dismissToast} />

      {visible && (
        <>
          {open && (
            <div className={`fixed inset-0 z-[118] bg-black/35 ${animate ? 'backdrop-blur-[2px] note-anim-fade' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
          )}
          <div className="fixed z-[119] right-4 sm:right-6 bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+1rem))] flex flex-col items-end gap-3">
            <ul id="create-menu" className={`flex flex-col-reverse items-end gap-2.5 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open} role="menu" aria-label="Create">
              {OPTIONS.map((o, i) => (
                <li key={o.key} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={open ? 0 : -1}
                    className="fab-pill"
                    onClick={() => pick(o.key)}
                    style={{
                      opacity: open ? 1 : 0,
                      transform: open ? 'none' : `translateY(${animate ? 12 + i * 6 : 0}px) scale(${animate ? 0.9 : 1})`,
                      transitionDelay: open && animate ? `${i * 35}ms` : '0ms',
                    }}
                  >
                    <span className="fab-pill-icon"><o.icon size={17} /></span>
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="fab"
              onClick={() => { setOpen(o => !o); haptic(10); }}
              aria-label={open ? 'Close create menu' : 'Create'}
              aria-expanded={open}
              aria-controls="create-menu"
            >
              <Plus size={28} style={{ transform: open ? 'rotate(45deg)' : 'none', transition: animate ? 'transform .2s ease' : 'none' }} />
            </button>
          </div>
        </>
      )}

      {(composer === 'text' || composer === 'list') && <NoteComposer mode={composer} onClose={() => setComposer(null)} onSaved={saved} />}
      {composer === 'image' && <ImageComposer onClose={() => setComposer(null)} onSaved={saved} />}
      {composer === 'drawing' && <DrawingComposer onClose={() => setComposer(null)} onSaved={saved} />}
    </>
  );
}
