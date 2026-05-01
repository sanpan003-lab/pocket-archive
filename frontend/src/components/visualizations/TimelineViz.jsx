export default function TimelineViz({ data }) {
  const { title, events = [] } = data;
  if (!events.length) return null;

  return (
    <div className="glass-card p-5 my-4 animate-slide-up">
      <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-4">Timeline</p>
      <h4 className="font-bold text-navy-900 text-base mb-5">{title}</h4>

      <div className="relative pl-8">
        {/* Vertical line */}
        <div
          className="absolute left-3 top-1 bottom-4 w-0.5 rounded-full"
          style={{ background: 'linear-gradient(180deg, #F59E0B 0%, rgba(245,158,11,0.15) 100%)' }}
        />

        <div className="flex flex-col gap-5">
          {events.map((ev, i) => (
            <div key={i} className="relative">
              {/* Dot */}
              <div
                className="absolute -left-5 top-1 w-3 h-3 rounded-full border-2 border-white"
                style={{ background: i === 0 ? '#F59E0B' : '#FCD34D', boxShadow: '0 0 0 3px rgba(245,158,11,0.2)' }}
              />
              <div>
                {ev.date && (
                  <span className="text-xs font-bold text-gold-600 block mb-0.5">{ev.date}</span>
                )}
                <p className="font-semibold text-navy-900 text-sm leading-snug">{ev.title}</p>
                {ev.description && (
                  <p className="text-xs text-navy-500 mt-1 leading-relaxed">{ev.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
