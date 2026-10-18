import { Users } from 'lucide-react';
import { usePeople } from '../../lib/sharing';

/** A person's initials in their color */
export function PersonDot({ person, size = 20, className = '' }) {
  if (!person) return null;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold text-white shrink-0 ring-2 ring-white dark:ring-neutral-900 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: person.color || '#64748B' }}
      title={person.name}
      aria-hidden="true"
    >
      {person.initials || person.name?.[0] || '?'}
    </span>
  );
}

/**
 * On cards and the note header:
 * shared with me → owner's initials + "Name's" (view: "· view only"),
 * shared by me → the people's initials + "Shared".
 */
export default function SharedBadge({ note, compact = false }) {
  const people = usePeople();
  const from = note.sharedFrom;
  if (from) {
    const label = `Shared by ${from.name}${from.role === 'view' ? ' · view only' : ''}`;
    return (
      <span className="badge badge-slate !pl-0.5 gap-1" title={label}>
        <PersonDot person={from} size={18} />
        {compact ? <span className="sr-only">{label}</span> : <span>{from.name}’s{from.role === 'view' ? ' · view' : ''}</span>}
      </span>
    );
  }
  const shared = (note.sharedWith || []).map(s => people[s.userId]).filter(Boolean);
  if (!note.sharedWith?.length) return null;
  const label = `Shared with ${shared.map(p => p.name).join(', ') || `${note.sharedWith.length} people`}`;
  return (
    <span className="badge badge-slate gap-1" title={label}>
      <Users size={11} />
      {shared.length > 0 && (
        <span className="flex -space-x-1.5">
          {shared.slice(0, 3).map(p => <PersonDot key={p.id} person={p} size={16} />)}
        </span>
      )}
      {compact ? <span className="sr-only">{label}</span> : <span>Shared</span>}
    </span>
  );
}
