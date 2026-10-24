import { useLayout } from '../lib/layout';
import NoteSearch from '../components/search/NoteSearch';

/** Search (sidebar): everything you can see — notes, lists, documents, projects, shared with you; recordings (archive) */
export default function SearchPage() {
  const { archive } = useLayout();
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-28">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Search</h1>
        <p className="text-sm text-navy-600 dark:text-white/60 mt-1">
          Titles, AI summaries, transcripts, typed text, lists, documents, attachments and photo text{archive ? ', and your recordings' : ''} — yours and what’s shared with you.
        </p>
      </div>
      <NoteSearch variant="page" autoFocus placeholder={archive ? 'Search notes and recordings…' : 'Search notes, lists, documents…'} />
    </div>
  );
}
