import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, X, ChevronLeft, ChevronRight, Pin, FolderKanban } from 'lucide-react';
import { useAppearance } from '../../context/appearanceStore';
import { useIsMobile } from '../../hooks/useIsMobile';
import { QUICK_TYPES, describeWhen } from './quickMeta';
import NoteContent from './NoteContent';
import NoteToolbar from './NoteToolbar';
import { noteColorStyle, resolveOpenStyle } from './noteHelpers';
import AskPrompt from './AskPrompt';
import SharedBadge from './SharedBadge';
import NoteActivity from './NoteActivity';

const fullDate = iso => (iso ? new Date(iso).toLocaleString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '');

function NoteHeader({ note, projectName }) {
  const meta = QUICK_TYPES[note.type] || QUICK_TYPES.note;
  const review = note.status === 'needs_review' && !note.undone;
  const when = describeWhen(note);
  return (
    <header className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`badge ${meta.badge}`}><meta.icon size={11} /> {note.format === 'list' && note.type !== 'errand' ? 'List' : meta.label}</span>
        {review && <span className="badge badge-orange">Needs review</span>}
        {note.undone && <span className="badge badge-slate">Deleted</span>}
        {note.pinned && <span className="badge badge-gold"><Pin size={11} /> Pinned</span>}
        <SharedBadge note={note} />
        {projectName && <span className="badge badge-gold"><FolderKanban size={11} /> {projectName}</span>}
        {(note.updates || []).length > 0 && <span className="badge badge-slate">Updated {note.updates.length}×</span>}
      </div>
      <h2 id="note-view-title" className="mt-2 text-xl sm:text-2xl font-bold text-navy-900 dark:text-white break-words">{note.title}</h2>
      <p className="mt-0.5 text-xs text-navy-500 dark:text-white/50">
        {fullDate(note.capturedAt || note.createdAt)}
        {when && note.type !== 'errand' ? ` · ${when}` : ''}
        {note.location ? ` · ${note.location}` : ''}
      </p>
    </header>
  );
}

/** Body + toolbar, shared by every opening style */
function NotePanelBody({ note, projectName, onChanged, arrivalReady, onReload }) {
  const pending = note.status === 'pending_decision' && note.pending;
  return (
    <>
      <div className="px-5 sm:px-6 pt-1 pb-3" data-note-body>
        {pending && <div className="mb-3"><AskPrompt note={note} onResolved={() => onReload?.()} /></div>}
        <NoteContent note={note} onChanged={onChanged} projectName={projectName} arrivalReady={arrivalReady} />
        <NoteActivity note={note} />
      </div>
    </>
  );
}

/**
 * One opened note. style: card | full | sheet | side.
 * Close: ✕ / Back, Esc, tap outside (card/sheet), swipe down (card/sheet).
 * Previous / next: swipe left/right or ←/→.
 */
export default function NoteView({
  note, projectName, style, onClose, onPrev, onNext, onAction, onChanged, onReload, busy, arrivalReady, origin,
}) {
  const { settings, darkMode } = useAppearance();
  const isMobile = useIsMobile();
  const mode = resolveOpenStyle(style, isMobile);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const touch = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [expanded, setExpanded] = useState(false); // phone sheet → full screen
  const swipe = settings.opening.swipe;
  const colorStyle = noteColorStyle(note, darkMode, settings.look.noteColors);

  // Esc closes, ←/→ moves (not while typing)
  useEffect(() => {
    const onKey = e => {
      if (e.defaultPrevented) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (!typing && swipe && e.key === 'ArrowLeft' && onPrev) { e.preventDefault(); onPrev(); }
      else if (!typing && swipe && e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext, swipe]);

  // Overlays: lock the page behind, focus the note
  useEffect(() => {
    if (mode === 'side') return undefined;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });
    return () => { html.style.overflow = prev; };
  }, [mode]);

  // Another note in the same view (prev/next): back to the top, sheet size again
  const [shownId, setShownId] = useState(note.id);
  if (shownId !== note.id) { setShownId(note.id); setExpanded(false); }
  useEffect(() => { scrollRef.current?.scrollTo?.({ top: 0 }); }, [note.id]);

  // Touch: swipe down to close (card/sheet, when scrolled to the top), left/right for prev/next
  const onTouchStart = e => {
    // The action toolbar scrolls sideways itself: gestures that start there never change notes
    if (e.target.closest?.('[data-no-swipe]')) { touch.current = null; return; }
    const t = e.touches[0];
    touch.current = {
      x: t.clientX, y: t.clientY, top: (scrollRef.current?.scrollTop || 0) <= 0, axis: null,
      fromBody: !!e.target.closest?.('[data-note-body]'),   // prev/next only from the note itself
    };
  };
  const onTouchMove = e => {
    const s = touch.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.axis && Math.hypot(dx, dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (s.axis === 'y' && s.top && (mode === 'card' || mode === 'sheet')) {
      if (dy > 0) setDragY(dy);
      else if (mode === 'sheet' && dy < -40 && !expanded) setExpanded(true);
    }
  };
  const onTouchEnd = e => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (s.axis === 'y' && dragY > 110) { onClose(); return; }
    setDragY(0);
    if (swipe && s.fromBody && s.axis === 'x' && Math.abs(dx) > 70 && Math.abs(dy) < 60) {
      if (dx < 0 && onNext) onNext();
      if (dx > 0 && onPrev) onPrev();
    }
  };
  const touchProps = { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: () => { touch.current = null; setDragY(0); } };

  const navButtons = (onPrev || onNext) && swipe && (
    <div className="flex items-center gap-1">
      <button className="w-9 h-9 rounded-xl flex items-center justify-center text-navy-500 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30" onClick={onPrev} disabled={!onPrev} aria-label="Previous note"><ChevronLeft size={18} /></button>
      <button className="w-9 h-9 rounded-xl flex items-center justify-center text-navy-500 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30" onClick={onNext} disabled={!onNext} aria-label="Next note"><ChevronRight size={18} /></button>
    </div>
  );
  const closeButton = (
    <button className="w-10 h-10 rounded-xl flex items-center justify-center text-navy-500 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose} aria-label="Close note">
      <X size={20} />
    </button>
  );
  const body = <NotePanelBody note={note} projectName={projectName} onChanged={onChanged} arrivalReady={arrivalReady} onReload={onReload} />;
  const toolbar = (
    <div className="quick-card-divider px-3 sm:px-4 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <NoteToolbar note={note} onAction={onAction} busy={busy} />
    </div>
  );

  // ── Side panel (desktop): rendered in the page's right column ──
  if (mode === 'side') {
    return (
      <aside
        ref={panelRef}
        className="note-surface rounded-3xl border border-navy-100 dark:border-white/10 shadow-xl flex flex-col max-h-[calc(100vh-3rem)] sticky top-6 note-anim-fade"
        style={colorStyle}
        aria-labelledby="note-view-title"
      >
        <div className="flex items-start gap-2 px-5 sm:px-6 pt-4 pb-2">
          <div className="flex-1 min-w-0"><NoteHeader note={note} projectName={projectName} /></div>
          {navButtons}
          {closeButton}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto">{body}</div>
        {toolbar}
      </aside>
    );
  }

  // ── Full screen: top bar with Back, title, prev/next ──
  if (mode === 'full') {
    return (
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-view-title"
        className="fixed inset-0 z-[150] note-surface flex flex-col note-anim-right outline-none"
        style={colorStyle}
        {...touchProps}
      >
        <div className="flex items-center gap-1 h-14 px-2 border-b border-navy-100 dark:border-white/10 pt-[env(safe-area-inset-top)] box-content">
          <button className="w-11 h-11 rounded-xl flex items-center justify-center text-navy-700 dark:text-white/80" onClick={onClose} aria-label="Back">
            <ArrowLeft size={21} />
          </button>
          <p className="flex-1 min-w-0 truncate font-semibold text-navy-900 dark:text-white">{note.title}</p>
          {navButtons}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto">
            <div className="px-5 sm:px-6 pt-4 pb-2"><NoteHeader note={note} projectName={projectName} /></div>
            {body}
          </div>
        </div>
        <div className="max-w-3xl w-full mx-auto">{toolbar}</div>
      </div>
    );
  }

  const scrim = settings.opening.backdrop === 'none' ? 'note-scrim-none' : settings.opening.backdrop === 'fade' ? 'note-scrim-fade' : 'note-scrim-blur';

  // ── Bottom sheet (phones; expands to full screen when dragged up) ──
  if (mode === 'sheet') {
    return (
      <div className="fixed inset-0 z-[150]" role="presentation">
        <div className={`absolute inset-0 ${scrim} note-anim-fade`} onClick={onClose} aria-hidden="true" />
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-view-title"
          className={`absolute inset-x-0 bottom-0 note-surface flex flex-col shadow-2xl outline-none note-anim-up transition-[height,border-radius] duration-300 ${expanded ? 'h-full rounded-none' : 'h-[88vh] rounded-t-3xl'}`}
          style={{ ...colorStyle, transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragY ? 'none' : undefined }}
          {...touchProps}
        >
          <div className={`flex justify-center pt-2 pb-1 ${expanded ? 'pt-[max(0.5rem,env(safe-area-inset-top))]' : ''}`}>
            <button className="w-12 h-1.5 rounded-full bg-navy-200 dark:bg-white/25" onClick={() => setExpanded(e => !e)} aria-label={expanded ? 'Shrink' : 'Expand to full screen'} />
          </div>
          <div className="flex items-start gap-1 px-5 pt-1 pb-2">
            <div className="flex-1 min-w-0"><NoteHeader note={note} projectName={projectName} /></div>
            {closeButton}
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain" onScroll={e => { if (e.currentTarget.scrollTop > 40 && !expanded) setExpanded(true); }}>
            {body}
          </div>
          {toolbar}
        </div>
      </div>
    );
  }

  // ── Floating card (default on wider screens) ──
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <div className={`absolute inset-0 ${scrim} note-anim-fade`} onClick={onClose} aria-hidden="true" />
      {(onPrev || onNext) && swipe && !isMobile && (
        <>
          <button className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/90 dark:bg-white/15 text-navy-700 dark:text-white shadow-lg flex items-center justify-center disabled:opacity-0" onClick={onPrev} disabled={!onPrev} aria-label="Previous note"><ChevronLeft size={22} /></button>
          <button className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/90 dark:bg-white/15 text-navy-700 dark:text-white shadow-lg flex items-center justify-center disabled:opacity-0" onClick={onNext} disabled={!onNext} aria-label="Next note"><ChevronRight size={22} /></button>
        </>
      )}
      <div
        key={note.id}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-view-title"
        className="relative w-full max-w-2xl max-h-[88vh] note-surface rounded-3xl shadow-2xl flex flex-col outline-none note-anim-pop"
        style={{
          ...colorStyle,
          '--from-x': origin ? `${origin.x}px` : '0px',
          '--from-y': origin ? `${origin.y}px` : '12px',
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          opacity: dragY ? Math.max(0.4, 1 - dragY / 400) : undefined,
        }}
        {...touchProps}
      >
        <div className="flex items-start gap-1 px-5 sm:px-6 pt-5 pb-2">
          <div className="flex-1 min-w-0"><NoteHeader note={note} projectName={projectName} /></div>
          {closeButton}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">{body}</div>
        {toolbar}
      </div>
    </div>
  );
}
