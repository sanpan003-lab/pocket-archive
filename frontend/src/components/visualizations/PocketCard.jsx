// Fallback for Hey Pocket <pocket:*> tags we can't chart — a titled bullet list
export default function PocketCard({ title, kind, items = [] }) {
  return (
    <div className="glass-card p-5 my-4 animate-slide-up">
      <p className="text-xs font-semibold text-navy-400 dark:text-white/40 uppercase tracking-wider mb-1">{kind}</p>
      <h4 className="font-bold text-navy-900 dark:text-white text-base mb-3 break-words">{title}</h4>
      {items.length > 0 && (
        <ul className="list-disc list-outside ml-5 space-y-1 text-sm">
          {items.map((item, i) => (
            <li key={i} className="text-navy-700 dark:text-white/80 leading-relaxed break-words">{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
