import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { getRecordings } from '../lib/api';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const today = new Date();

  const [year, setYear]           = useState(today.getFullYear());
  const [month, setMonth]         = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const [recordings, setRecordings]   = useState([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    getRecordings()
      .then(setRecordings)
      .finally(() => setLoading(false));
  }, []);

  const byDate = useMemo(() => {
    const map = {};
    for (const rec of recordings) {
      if (!map[rec.date]) map[rec.date] = [];
      map[rec.date].push(rec);
    }
    return map;
  }, [recordings]);

  function dateStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay    = getFirstDayOfMonth(year, month);

  const cells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isToday = day =>
    year === today.getFullYear() && month === today.getMonth() && day === today.getDate();

  const selectedRecs = selectedDay ? (byDate[dateStr(selectedDay)] ?? []) : [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Calendar</h1>
        <p className="text-sm text-navy-600 dark:text-white/60 mt-1">Browse recordings by date</p>
      </div>

      <div className="glass-panel p-6 mb-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-6">
          <button className="btn-ghost" onClick={prevMonth}>
            <ChevronLeft size={18} />
          </button>
          <h2 className="font-bold text-navy-900 dark:text-white text-lg">
            {MONTH_NAMES[month]} {year}
          </h2>
          <button className="btn-ghost" onClick={nextMonth}>
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {DAY_NAMES.map(d => (
            <div key={d} className="text-center text-xs font-bold text-navy-400 dark:text-white/40 py-2">
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }, (_, i) => (
              <div key={i} className="h-12 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const ds    = dateStr(day);
              const count = byDate[ds]?.length ?? 0;
              const sel   = selectedDay === day;
              const tod   = isToday(day);

              return (
                <button
                  key={i}
                  className={[
                    'relative h-12 rounded-xl flex flex-col items-center justify-center transition-all text-sm font-medium',
                    sel
                      ? 'bg-gold-gradient text-white shadow-gold'
                      : tod
                        ? 'ring-2 ring-gold-400 text-navy-900 dark:text-white'
                        : count > 0
                          ? 'bg-amber-50 dark:bg-yellow-900/20 text-navy-900 dark:text-white hover:bg-amber-100 dark:hover:bg-yellow-900/30'
                          : 'text-navy-500 dark:text-white/40 hover:bg-navy-50 dark:hover:bg-white/5',
                  ].join(' ')}
                  onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                >
                  {day}
                  {count > 0 && (
                    <span className={`absolute bottom-1 text-[9px] font-bold leading-none ${sel ? 'text-white/80' : 'text-gold-500'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected day */}
      {selectedDay && (
        <div>
          <p className="text-sm font-semibold text-navy-700 dark:text-white/70 mb-3">
            {MONTH_NAMES[month]} {selectedDay}, {year}
            {' — '}
            <span className="text-navy-500 dark:text-white/50 font-normal">
              {selectedRecs.length} recording{selectedRecs.length !== 1 ? 's' : ''}
            </span>
          </p>

          {selectedRecs.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <Calendar size={28} className="mx-auto mb-2 text-navy-200 dark:text-white/20" />
              <p className="text-sm text-navy-500 dark:text-white/40">No recordings on this day</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {selectedRecs.map(rec => (
                <div
                  key={rec.id}
                  className="glass-card px-5 py-4 cursor-pointer flex items-center gap-4 animate-fade-in"
                  style={{ borderRadius: 12 }}
                  onClick={() => navigate(`/recordings/${rec.id}`)}
                >
                  <p className="font-medium text-navy-900 dark:text-white text-sm flex-1">{rec.title}</p>
                  <div className="flex gap-1.5 shrink-0">
                    {rec.hasAudio      && <span className="badge badge-green text-xs">Audio</span>}
                    {rec.hasAiNotes    && <span className="badge badge-blue text-xs">AI</span>}
                    {rec.hasTranscript && <span className="badge badge-slate text-xs">Txt</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
