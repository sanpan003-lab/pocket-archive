import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, X, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useLayout } from '../lib/layout';
import { isNative } from '../lib/platform';
import { offlineCapable } from '../lib/offline/native';
import { SECTIONS, visibleEntries, searchSettings } from '../lib/settingsIndex';
import { CATEGORY_NAME, categoryOf } from '../lib/settingsCategories';
import Highlight from './Highlight';

const termsOf = q => String(q || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Settings → "Search settings…" (pinned at the top). Results: the setting with its category › section path; choosing
 * one opens that category's screen, scrolls to the setting, opens what it's in and flashes it (SettingsPage does that). "/" focuses (web), Esc clears, ↑/↓ + Enter pick.
 */
export default function SettingsSearch({ categories = [] }) {
  const navigate = useNavigate();
  const { category } = useParams();
  const { isAdmin } = useApp();
  const { lite, archive } = useLayout();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [missing, setMissing] = useState('');
  const input = useRef(null);
  const entries = useMemo(() => visibleEntries({ lite, archive, isAdmin, isNative, offline: offlineCapable() }), [lite, archive, isAdmin]);
  // Only settings in a category this account / device has
  const results = useMemo(() => searchSettings(entries, q, 30).filter(e => categories.includes(categoryOf(e.section))).slice(0, 12), [entries, q, categories]);
  const terms = termsOf(q);

  // "/" focuses the box (not while typing somewhere else)
  useEffect(() => {
    const onKey = e => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    // A setting that hides itself here (e.g. no fingerprint sensor) never shows up after opening its category
    const onMissing = e => setMissing(`${e.detail?.title || 'That setting'} isn’t available here`);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pa:settings-missing', onMissing);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pa:settings-missing', onMissing); };
  }, []);

  function pick(e) {
    setQ('');
    setActive(0);
    input.current?.blur();
    const cat = categoryOf(e.section);
    navigate(`/settings/${cat}`, { state: { reveal: e.key }, replace: cat === category });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (q) setQ(''); else input.current?.blur();
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault(); setActive(a => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault(); setActive(a => (a - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault(); pick(results[active]);
    }
  }

  const open = q.trim().length > 0;
  return (
    <div className="sticky top-14 z-20 -mx-2 px-2 pt-2 pb-3 mb-3 settings-search-bar" data-settings-search="">
      <div className="relative">
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 dark:text-white/40 pointer-events-none" />
        <input
          ref={input}
          type="search"
          className="search-input pl-10 pr-11 text-base"
          placeholder="Search settings…"
          aria-label="Search settings"
          role="combobox"
          aria-expanded={open}
          aria-controls="settings-search-results"
          aria-activedescendant={open && results[active] ? `ss-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          value={q}
          onChange={e => { setQ(e.target.value); setActive(0); setMissing(''); }}
          onKeyDown={onKeyDown}
        />
        {q ? (
          <button type="button" className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-navy-400 hover:text-navy-700 dark:text-white/50 dark:hover:text-white"
            onClick={() => { setQ(''); input.current?.focus(); }} aria-label="Clear search"><X size={17} /></button>
        ) : (
          !isNative && <kbd className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 items-center justify-center w-6 h-6 rounded-md border border-navy-200 dark:border-white/15 text-xs text-navy-400 dark:text-white/40" aria-hidden="true">/</kbd>
        )}
        {open && (
          <ul id="settings-search-results" role="listbox" aria-label="Matching settings"
            className="absolute left-0 right-0 top-full mt-1.5 max-h-[60vh] overflow-y-auto rounded-2xl note-surface shadow-2xl border border-navy-100 dark:border-white/10 py-1.5">
            {results.length === 0 && <li className="px-4 py-3 text-sm text-navy-500 dark:text-white/55">No settings match “{q.trim()}”</li>}
            {results.map((e, i) => (
              <li key={`${e.section}-${e.title}`} id={`ss-${i}`} role="option" aria-selected={i === active}>
                <button type="button" className={`w-full min-h-[48px] flex items-center gap-3 px-4 py-2 text-left ${i === active ? 'bg-gold-500/10' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                  onMouseEnter={() => setActive(i)} onClick={() => pick(e)} data-setting-result="">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-navy-900 dark:text-white"><Highlight text={e.title} terms={terms} /></span>
                    <span className="block text-xs text-navy-500 dark:text-white/50 truncate">
                      {CATEGORY_NAME[categoryOf(e.section)]}{e.title === SECTIONS[e.section] || SECTIONS[e.section] === CATEGORY_NAME[categoryOf(e.section)] ? '' : ` › ${SECTIONS[e.section]}`}
                      {e.desc ? ` · ${e.desc}` : ''}
                    </span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-navy-300 dark:text-white/30" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {missing && <p className="text-xs text-navy-500 dark:text-white/55 mt-1.5" role="status">{missing}</p>}
    </div>
  );
}
