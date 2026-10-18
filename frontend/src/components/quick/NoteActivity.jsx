import { useState } from 'react';
import { History } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { isSharedNote, usePeople } from '../../lib/sharing';
import { timeAgo } from './quickMeta';
import { PersonDot } from './SharedBadge';

const VERB = {
  added: 'added', removed: 'removed', checked: 'checked off', unchecked: 'unchecked', edited: 'edited',
  renamed: 'renamed it to', 'edited the text': 'edited the text', 'shared with': 'shared it with',
  'at-store': 'is at', done: 'marked it done', reopened: 'reopened it',
};

/** "Jane added Eggs · 2 min ago" — on shared notes only */
export default function NoteActivity({ note }) {
  const { user } = useApp();
  const people = usePeople();
  const [all, setAll] = useState(false);
  const list = [...(note.activity || [])].reverse();
  if (!isSharedNote(note) || !list.length) return null;
  const shown = all ? list : list.slice(0, 5);
  const personFor = id => (id === user?.id ? { id, name: 'You', initials: user.initials, color: user.color } : people[id] || (note.sharedFrom?.ownerId === id ? note.sharedFrom : null));

  return (
    <section className="quick-card-divider pt-3 mt-3" aria-label="Activity">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-2">
        <History size={12} /> Activity
      </p>
      <ul className="space-y-1.5">
        {shown.map((a, i) => {
          const p = personFor(a.by);
          const name = a.by === user?.id ? 'You' : a.byName || p?.name || 'Someone';
          return (
            <li key={`${a.at}-${i}`} className="flex items-start gap-2 text-sm text-navy-700 dark:text-white/75">
              <PersonDot person={p || { name, initials: name[0] }} size={20} className="mt-px" />
              <span className="min-w-0 break-words">
                <span className="font-semibold">{name}</span> {VERB[a.action] || a.action}{a.text ? <> <span className="font-medium">{a.text}</span></> : null}
                <span className="text-xs text-navy-400 dark:text-white/40"> · {timeAgo(a.at)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {list.length > 5 && (
        <button className="mt-1.5 text-xs font-semibold text-gold-600 dark:text-gold-400" onClick={() => setAll(a => !a)}>
          {all ? 'Show less' : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}
