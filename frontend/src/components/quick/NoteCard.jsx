import { useRef } from 'react';
import { CheckSquare, Square, Merge, FolderKanban, Pin, Image as ImageIcon, PenLine, Check, MapPin } from 'lucide-react';
import { geoLabel } from '../../lib/geoLabel';
import { quickAudioUrl, quickMediaUrl } from '../../lib/api';
import { useAppearance, useHaptics } from '../../context/appearanceStore';
import { QUICK_TYPES, REVIEW_ACCENT, describeWhen, cardTime } from './quickMeta';
import QuickSummary from './QuickSummary';
import QuickAudio from './QuickAudio';
import AskPrompt from './AskPrompt';
import NoteContent from './NoteContent';
import NoteToolbar from './NoteToolbar';
import SharedBadge, { PersonDot } from './SharedBadge';
import { hasChecklist, previewText, noteColorStyle } from './noteHelpers';

const capturedAt = n => n.capturedAt || n.createdAt;

const CLAMP = { two: 'line-clamp-2', four: 'line-clamp-4' };

function ChecklistPreview({ note, max }) {
  const items = note.items || [];
  if (!items.length) return null;
  const open = items.filter(i => !i.done);
  const shown = [...open, ...items.filter(i => i.done)].slice(0, max);
  return (
    <ul className="mt-2 space-y-0.5">
      {shown.map(i => (
        <li key={i.id} className={`flex items-center gap-2 text-sm ${i.done ? 'line-through text-navy-400 dark:text-white/40' : 'text-navy-800 dark:text-white/80'}`}>
          {i.done ? <Check size={14} className="shrink-0 text-emerald-500" /> : <Square size={14} className="shrink-0 text-navy-300 dark:text-white/35" />}
          <span className="truncate">{i.text}</span>
        </li>
      ))}
      {items.length > max && <li className="text-xs text-navy-400 dark:text-white/40 pl-6">+{items.length - max} more</li>}
    </ul>
  );
}

/**
 * Inbox card. Previews open the note (onOpen); "Expand in place" shows the
 * whole note inside the card. layout: grid | list | compact.
 */
export default function NoteCard({
  note, layout, inline, expanded, highlighted, projectName, selectMode, selected,
  onOpen, onSelect, onLongPress, onAction, onChanged, onReload, arrivalReady, busy,
}) {
  const { settings, darkMode } = useAppearance();
  const haptic = useHaptics();
  const s = settings.inbox;
  const meta = QUICK_TYPES[note.type] || QUICK_TYPES.note;
  const review = note.status === 'needs_review' && !note.undone;
  const pending = note.status === 'pending_decision' && note.pending;
  const when = describeWhen(note);
  const text = previewText(note);
  const preview = text && text !== note.title ? text : ''; // don't repeat the title
  const compactDensity = settings.theme.density === 'compact';
  const pressTimer = useRef(null);
  const longPressed = useRef(false);
  const colorStyle = noteColorStyle(note, darkMode, settings.look.noteColors);
  const badgeLabel = note.format === 'list' && note.type !== 'errand' ? 'List' : meta.label;
  const SourceIcon = note.media?.kind === 'drawing' ? PenLine : note.media ? ImageIcon : null;

  const startPress = e => {
    if (selectMode || e.pointerType === 'mouse') return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => { longPressed.current = true; onLongPress(note); haptic(20); }, 500);
  };
  const cancelPress = () => clearTimeout(pressTimer.current);
  const activate = e => {
    if (longPressed.current) { longPressed.current = false; return; }
    if (selectMode) onSelect(note);
    else onOpen(note, e.currentTarget.closest('article')?.getBoundingClientRect());
  };

  const pad = compactDensity ? 'px-4 py-2.5' : 'pl-5 pr-4 pt-4 pb-3 sm:pl-6 sm:pr-5';
  const cardClass = `quick-card min-w-0 scroll-mt-24 ${highlighted || selected ? 'quick-card-highlight' : ''} ${note.undone ? 'opacity-60' : ''} ${note.errandDone && !note.undone ? 'opacity-80' : ''}`;
  const pressProps = {
    onPointerDown: startPress, onPointerUp: cancelPress, onPointerLeave: cancelPress, onPointerCancel: cancelPress,
    onContextMenu: e => { if (longPressed.current) e.preventDefault(); },
  };
  const selectBox = selectMode && (selected
    ? <CheckSquare size={20} className="shrink-0 text-gold-500" aria-hidden="true" />
    : <Square size={20} className="shrink-0 text-navy-300 dark:text-white/30" aria-hidden="true" />);
  const buttonLabel = selectMode ? `${selected ? 'Deselect' : 'Select'} ${note.title}` : `Open ${note.title}`;

  // ── Compact list: one line per note ──
  if (layout === 'compact' && !inline) {
    return (
      <article id={`qn-${note.id}`} className={`${cardClass} !rounded-xl`} style={colorStyle} {...pressProps}>
        {s.showAccent && <span className="quick-card-accent" style={{ background: review ? REVIEW_ACCENT : meta.color }} aria-hidden="true" />}
        <button type="button" className="w-full flex items-center gap-2.5 pl-4 pr-3 py-2.5 text-left" onClick={activate} aria-label={buttonLabel} aria-pressed={selectMode ? selected : undefined}>
          {selectBox}
          {s.showBadge && <meta.icon size={15} className="shrink-0" style={{ color: meta.color }} aria-hidden="true" />}
          {note.pinned && <Pin size={13} className="shrink-0 text-gold-500 fill-current" aria-label="Pinned" />}
          {note.sharedFrom && <PersonDot person={note.sharedFrom} size={18} />}
          <span className="flex-1 min-w-0 truncate text-sm font-semibold text-navy-900 dark:text-white">{note.title}</span>
          {hasChecklist(note) && (note.items || []).length > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-navy-400 dark:text-white/45">{note.items.filter(i => i.done).length}/{note.items.length}</span>
          )}
          {SourceIcon && <SourceIcon size={14} className="shrink-0 text-navy-400 dark:text-white/45" aria-hidden="true" />}
          {s.showTime && <span className="shrink-0 text-xs text-navy-400 dark:text-white/45">{cardTime(capturedAt(note))}</span>}
        </button>
      </article>
    );
  }

  const grid = layout === 'grid' && !inline;
  return (
    <article id={`qn-${note.id}`} className={`${cardClass} ${inline ? 'animate-fade-in' : ''}`} style={colorStyle} {...pressProps}>
      {s.showAccent && <span className="quick-card-accent" style={{ background: review ? REVIEW_ACCENT : meta.color }} aria-hidden="true" />}

      <button
        type="button"
        className={`w-full text-left ${grid ? '' : pad}`}
        onClick={activate}
        aria-label={buttonLabel}
        aria-pressed={selectMode ? selected : undefined}
        aria-expanded={inline && !selectMode ? expanded : undefined}
      >
        {/* Photo / drawing on top in the grid */}
        {grid && note.media && (
          <img src={quickMediaUrl(note.id)} alt="" loading="lazy" className={`w-full max-h-64 object-cover ${note.media.kind === 'drawing' ? 'bg-white object-contain' : ''}`} />
        )}
        <div className={grid ? (compactDensity ? 'px-3.5 py-2.5' : 'px-4 pt-3 pb-3 pl-5') : ''}>
          <div className="flex items-start gap-2">
            {selectBox}
            <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
              {s.showBadge && (grid
                ? <span className={`badge ${meta.badge} !px-1.5`} title={badgeLabel}><meta.icon size={12} /><span className="sr-only">{badgeLabel}</span></span>
                : <span className={`badge ${meta.badge} whitespace-nowrap`}><meta.icon size={11} /> {badgeLabel}</span>)}
              {note.pinned && <Pin size={13} className="text-gold-500 fill-current" aria-label="Pinned" />}
              <SharedBadge note={note} compact={grid} />
              {review &&<span className="badge badge-orange">Needs review</span>}
              {pending && <span className="badge badge-gold">Waiting for your answer</span>}
              {note.undone && <span className="badge badge-slate">Deleted</span>}
              {projectName && !grid && <span className="badge badge-gold"><FolderKanban size={11} /> {projectName}</span>}
              {(note.updates || []).length > 0 && <span className="badge badge-slate">Updated {note.updates.length}×</span>}
              {note.geo && !note.undone && (
                <span className={`badge ${note.geo.status === 'needs_place' ? 'badge-orange' : 'badge-green'}`}>
                  <MapPin size={11} /> {note.geo.status === 'needs_place' ? `Where is ${note.geo.query}?` : geoLabel(note.geo)}
                </span>
              )}
            </div>
            {s.showTime && <span className="shrink-0 text-xs text-navy-400 dark:text-white/45 pt-1">{cardTime(capturedAt(note))}</span>}
          </div>

          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <p className="mt-2 font-semibold text-base text-navy-900 dark:text-white break-words">{note.title}</p>
              {when && note.type !== 'errand' && (
                <p className="text-sm text-navy-600 dark:text-white/60 mt-0.5">{when}{note.location ? ` · ${note.location}` : ''}</p>
              )}
            </div>
            {!grid && !inline && note.media && (
              <img src={quickMediaUrl(note.id)} alt="" loading="lazy" className={`mt-2 w-16 h-16 rounded-xl object-cover shrink-0 border border-navy-100 dark:border-white/10 ${note.media.kind === 'drawing' ? 'bg-white object-contain' : ''}`} />
            )}
          </div>

          {!(inline && expanded) && s.preview !== 'title' && (
            hasChecklist(note) && (note.items || []).length ? (
              <ChecklistPreview note={note} max={s.preview === 'two' ? 3 : s.preview === 'four' ? 5 : 12} />
            ) : note.summaryStatus === 'pending' && !preview ? (
              <p className="mt-2 text-xs font-semibold text-gold-600 dark:text-gold-400">Summarizing…</p>
            ) : s.preview === 'full' && note.summaryStatus === 'done' ? (
              <div className="text-sm"><QuickSummary note={note} /></div>
            ) : preview ? (
              <p className={`mt-2 text-sm leading-relaxed text-navy-700 dark:text-white/70 break-words ${CLAMP[s.preview] || ''}`}>{preview}</p>
            ) : null
          )}
        </div>
      </button>

      {s.showAudio && !inline && note.audioFile && (
        <div className="px-5 pb-2" onClick={e => e.stopPropagation()}><QuickAudio src={quickAudioUrl(note.id)} durationSec={note.durationSec} /></div>
      )}

      {pending && !selectMode && (
        <div className={grid ? 'px-4 pb-3' : 'pl-5 pr-4 pb-3 sm:pl-6 sm:pr-5'}><AskPrompt note={note} compact onResolved={() => onReload()} /></div>
      )}
      {note.possibleMatch && !note.undone && !selectMode && (
        <div className={`${grid ? 'px-4' : 'pl-5 pr-4 sm:pl-6 sm:pr-5'} pb-3 flex flex-wrap items-center gap-2`}>
          <span className="badge badge-gold">Possible match: {note.possibleMatch.title}</span>
          <button className="btn-ghost text-xs" onClick={() => onAction('mergePossible', note)}><Merge size={13} /> Merge</button>
        </div>
      )}

      {/* Expand in place: the whole note inside the card */}
      {inline && expanded && !selectMode && (
        <div className="pl-5 pr-4 sm:pl-6 sm:pr-5 pb-1 animate-fade-in">
          <NoteContent note={note} onChanged={onChanged} projectName={projectName} arrivalReady={arrivalReady} />
          <div className="quick-card-divider pt-1.5 pb-1"><NoteToolbar note={note} onAction={onAction} busy={busy} /></div>
        </div>
      )}
    </article>
  );
}
