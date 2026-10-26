import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Navigation, CalendarDays, BellRing, Check, Plus, Pencil, Trash2, X, CloudOff, Eye } from 'lucide-react';
import { queueOps, newItemId, withPendingOps, useOpsQueue, pendingOps, OPS_REJECTED } from '../../lib/opsQueue';
import { canEdit, isSharedNote, usePeople } from '../../lib/sharing';
import { useApp } from '../../context/AppContext';
import { PersonDot } from './SharedBadge';
import { isNative } from '../../lib/platform';
import { syncErrands } from '../../native/errands';
import { errandChips, errandHasArrival, errandPlaceName, errandProgress, directionsUrl } from './quickMeta';

/**
 * Errand body: place + Directions, trigger chips, and a checkable list
 * (open items first, checked ones struck through at the bottom).
 * Changes are item-level operations (lib/opsQueue): shown at once, kept on this device while
 * offline and sent when the connection is back. Two people editing the same list never lose items.
 * The saved note comes back through NOTE_UPDATED (open lists replace their copy).
 */
export default function ErrandPanel({ note, arrivalReady = true }) {
  const [error, setError]     = useState(null);
  const [editing, setEditing] = useState(false);
  const [newItem, setNewItem] = useState('');
  const { user } = useApp();
  const people = usePeople();
  useOpsQueue(); // re-render when queued changes are sent

  const items = withPendingOps(note).items || [];
  const waiting = pendingOps(note.id).length > 0;
  const viewOnly = !canEdit(note);
  const readOnly = note.undone || viewOnly;
  const shared = isSharedNote(note);
  // Who added an item (shared lists; not shown for your own)
  const adder = item => {
    if (!shared || !item.addedBy || item.addedBy === user?.id) return null;
    return people[item.addedBy] || (note.sharedFrom?.ownerId === item.addedBy ? note.sharedFrom : null);
  };

  useEffect(() => {
    const onRejected = e => { if (e.detail?.noteId === note.id) setError(e.detail.message); };
    window.addEventListener(OPS_REJECTED, onRejected);
    return () => window.removeEventListener(OPS_REJECTED, onRejected);
  }, [note.id]);
  const place = note.place;
  const placeName = errandPlaceName(note);
  const { done, total } = errandProgress({ items });
  const directions = place?.resolved ? directionsUrl(place) : null;

  // Open items keep their order; checked items move to the bottom
  const ordered = [...items.filter(i => !i.done), ...items.filter(i => i.done)];

  function send(ops) {
    setError(null);
    queueOps(note.id, ops).then(() => syncErrands()); // arrival notification shows the current list
  }

  const toggle = item => send([{ op: 'toggleItem', itemId: item.id, done: !item.done }]);
  const remove = item => send([{ op: 'removeItem', itemId: item.id }]);

  function rename(item, text) {
    const clean = text.trim();
    if (!clean || clean === item.text) return;
    send([{ op: 'editItem', itemId: item.id, text: clean }]);
  }

  function add(e) {
    e.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    setNewItem('');
    send([{ op: 'addItem', itemId: newItemId(), text }]);
  }

  const chips = errandChips(note);

  return (
    <div className="pl-5 pr-4 pb-3 sm:pl-6 sm:pr-5">
      {/* Place */}
      {placeName && (
        <div className="flex items-start gap-2.5 mb-2.5">
          <MapPin size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-navy-900 dark:text-white break-words">
              {place?.resolved ? place.name : placeName}
            </p>
            {place?.resolved && place.address && (
              <p className="text-xs text-navy-500 dark:text-white/50 break-words">{place.address}</p>
            )}
            {place && !place.resolved && place.error && (
              <p className="text-xs text-amber-700 dark:text-amber-300 break-words">
                {place.error}
                {/home location/i.test(place.error) && (
                  <> · <Link to="/settings/places" className="font-semibold underline">Settings</Link></>
                )}
              </p>
            )}
          </div>
          {directions && (
            <a
              href={directions}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
            >
              <Navigation size={13} /> Directions
            </a>
          )}
        </div>
      )}

      {/* Trigger chips + progress */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {chips.map(c => {
          const off = c.key === 'arrival' && isNative && !arrivalReady;
          return (
            <span
              key={c.key}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${off
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : 'bg-navy-100 dark:bg-white/10 text-navy-700 dark:text-white/75'}`}
            >
              {c.key === 'time' ? <CalendarDays size={12} /> : <BellRing size={12} />}
              {c.label}{off ? ' · off' : ''}
            </span>
          );
        })}
        {note.errandDone && <span className="badge badge-green"><Check size={11} /> Done</span>}
        {total > 0 && (
          <span className="ml-auto text-xs font-semibold tabular-nums text-navy-500 dark:text-white/50" aria-label={`${done} of ${total} done`}>
            {done}/{total}
          </span>
        )}
      </div>
      {errandHasArrival(note) && !isNative && !note.errandDone && (
        <p className="text-xs text-navy-500 dark:text-white/45 mb-2">
          Arrival reminders pop up on your phone in the Pocket Archive Android app.
        </p>
      )}

      {/* Checklist */}
      {ordered.length > 0 && (
        <ul className="rounded-xl overflow-hidden border border-navy-100 dark:border-white/10 divide-y divide-navy-100 dark:divide-white/10">
          {ordered.map(item => (
            <li key={item.id} className="flex items-center">
              {editing && !readOnly ? (
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5">
                  <input
                    className="flex-1 min-w-0 bg-transparent text-[0.95rem] text-navy-900 dark:text-white outline-none py-2 border-b border-transparent focus:border-gold-400"
                    defaultValue={item.text}
                    aria-label={`Edit ${item.text}`}
                    onBlur={e => rename(item, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  />
                  <button
                    type="button"
                    className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-red-500 dark:text-red-400 hover:bg-red-500/10"
                    onClick={() => remove(item)}
                    aria-label={`Remove ${item.text}`}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={item.done}
                  disabled={readOnly}
                  onClick={() => toggle(item)}
                  className="flex-1 min-h-[3rem] flex items-center gap-3 px-3 py-2 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors"
                >
                  <span
                    className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${item.done
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-navy-300 dark:border-white/30'}`}
                    aria-hidden="true"
                  >
                    {item.done && <Check size={15} strokeWidth={3} />}
                  </span>
                  <span className={`text-[0.95rem] break-words ${item.done
                    ? 'line-through text-navy-400 dark:text-white/35'
                    : 'text-navy-900 dark:text-white'}`}
                  >
                    {item.text}
                  </span>
                  {adder(item) && (
                    <span className="ml-auto pl-2 flex items-center" title={`Added by ${adder(item).name}`}>
                      <PersonDot person={adder(item)} size={18} />
                      <span className="sr-only">added by {adder(item).name}</span>
                    </span>
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add / edit */}
      {!readOnly && (
        <div className="mt-2 flex items-center gap-2">
          <form onSubmit={add} className="flex-1 flex items-center gap-2 min-w-0">
            <input
              className="flex-1 min-w-0 h-11 rounded-xl px-3 text-sm bg-black/[0.03] dark:bg-white/5 border border-navy-100 dark:border-white/10 text-navy-900 dark:text-white placeholder-navy-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-gold-400/50"
              placeholder="Add item"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              aria-label="Add item"
            />
            <button type="submit" className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center bg-emerald-500 text-white disabled:opacity-40" disabled={!newItem.trim()} aria-label="Add">
              <Plus size={18} />
            </button>
          </form>
          {items.length > 0 && (
            <button
              type="button"
              className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-navy-500 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => setEditing(e => !e)}
              aria-label={editing ? 'Finish editing' : 'Edit list'}
              aria-pressed={editing}
            >
              {editing ? <X size={18} /> : <Pencil size={17} />}
            </button>
          )}
        </div>
      )}
      {viewOnly && !note.undone && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-navy-500 dark:text-white/50"><Eye size={13} /> View only — {note.sharedFrom?.name} can give you edit access.</p>
      )}
      {waiting && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300" role="status"><CloudOff size={13} /> Saved on this device — syncs when you’re back online.</p>
      )}
      {error && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}
