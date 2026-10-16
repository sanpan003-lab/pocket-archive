import { useRef, useState } from 'react';
import { GripVertical, X, Plus, Square, CheckSquare, Eye, PenLine } from 'lucide-react';
import { createTextNote } from '../../lib/api';
import MarkdownRenderer from '../MarkdownRenderer';
import ComposerShell, { AiToggle } from './ComposerShell';

const newClientId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
const uid = () => `tmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const INPUT = 'w-full bg-transparent outline-none text-navy-900 dark:text-white placeholder:text-navy-300 dark:placeholder:text-white/30';

/**
 * Checklist editor: type + Enter adds, drag the handle to reorder (mouse,
 * touch or pen), tick off, remove.
 */
function ChecklistEditor({ items, setItems, draft, setDraft }) {
  const [dragId, setDragId] = useState(null);
  const rows = useRef(new Map());
  const inputs = useRef(new Map());

  function add(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setItems(list => [...list, { id: uid(), text, done: false }]);
    setDraft('');
  }

  const update = (id, patch) => setItems(list => list.map(i => (i.id === id ? { ...i, ...patch } : i)));
  const remove = id => setItems(list => list.filter(i => i.id !== id));

  // Pointer drag: move the item to the row under the pointer
  function startDrag(e, id) {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragId(id);
  }
  function moveDrag(e) {
    if (!dragId) return;
    const y = e.clientY;
    let target = null;
    for (const [id, el] of rows.current) {
      const r = el?.getBoundingClientRect();
      if (r && y >= r.top && y <= r.bottom) { target = id; break; }
    }
    if (!target || target === dragId) return;
    setItems(list => {
      const from = list.findIndex(i => i.id === dragId);
      const to = list.findIndex(i => i.id === target);
      if (from < 0 || to < 0) return list;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  return (
    <div>
      <ul className="space-y-1" onPointerMove={moveDrag} onPointerUp={() => setDragId(null)} onPointerCancel={() => setDragId(null)}>
        {items.map(item => (
          <li
            key={item.id}
            ref={el => { if (el) rows.current.set(item.id, el); else rows.current.delete(item.id); }}
            className={`flex items-center gap-1.5 rounded-xl px-1 py-0.5 ${dragId === item.id ? 'bg-gold-500/10 shadow-sm' : ''}`}
          >
            <button
              type="button"
              className="w-8 h-9 flex items-center justify-center text-navy-300 dark:text-white/30 cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={e => startDrag(e, item.id)}
              aria-label={`Drag to reorder ${item.text}`}
            >
              <GripVertical size={16} />
            </button>
            <button type="button" className="w-8 h-9 flex items-center justify-center" onClick={() => update(item.id, { done: !item.done })} aria-label={item.done ? `Uncheck ${item.text}` : `Check ${item.text}`}>
              {item.done ? <CheckSquare size={19} className="text-gold-500" /> : <Square size={19} className="text-navy-400 dark:text-white/40" />}
            </button>
            <input
              ref={el => { if (el) inputs.current.set(item.id, el); else inputs.current.delete(item.id); }}
              className={`${INPUT} flex-1 min-w-0 py-1.5 text-[0.95rem] ${item.done ? 'line-through text-navy-400 dark:text-white/40' : ''}`}
              value={item.text}
              onChange={e => update(item.id, { text: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); document.getElementById('composer-new-item')?.focus(); }
                if (e.key === 'Backspace' && !item.text) { e.preventDefault(); remove(item.id); }
              }}
              aria-label="List item"
            />
            <button type="button" className="w-8 h-9 flex items-center justify-center text-navy-400 dark:text-white/40 hover:text-red-500" onClick={() => remove(item.id)} aria-label={`Remove ${item.text}`}>
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex items-center gap-1.5 px-1 mt-1">
        <span className="w-8 h-9 flex items-center justify-center text-navy-400 dark:text-white/40"><Plus size={18} /></span>
        <input
          id="composer-new-item"
          className={`${INPUT} flex-1 py-2 text-[0.95rem]`}
          placeholder="List item"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          enterKeyHint="next"
        />
      </form>
    </div>
  );
}

/** Text note (title + markdown body) or checklist — mode: 'text' | 'list' */
export default function NoteComposer({ mode: initialMode = 'text', onClose, onSaved }) {
  const [mode, setMode] = useState(initialMode);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');           // the "List item" line not added yet
  const [preview, setPreview] = useState(false);
  const [ai, setAi] = useState(true);
  const [color, setColor] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const clientId = useRef(newClientId());

  const list = mode === 'list';
  const cleanItems = [...items, ...(draft.trim() ? [{ id: 'draft', text: draft, done: false }] : [])].filter(i => i.text.trim());
  const hasContent = !!(title.trim() || (list ? cleanItems.length : body.trim()));

  function close() {
    if (hasContent && !saving && !window.confirm('Discard this note?')) return;
    onClose();
  }

  async function save() {
    if (!hasContent || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createTextNote({
        title: title.trim(),
        body: list ? '' : body,
        items: list ? cleanItems.map(i => ({ text: i.text.trim(), done: i.done })) : undefined,
        aiOrganize: ai,
        color: color || undefined,
        pinned,
        clientId: clientId.current,
      });
      onSaved(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not save — check your connection');
      setSaving(false);
    }
  }

  function switchMode() {
    if (list) {
      setBody(b => [b, ...cleanItems.map(i => `- ${i.text}`)].filter(Boolean).join('\n'));
      setItems([]);
      setDraft('');
      setMode('text');
    } else {
      const lines = body.split('\n').map(l => l.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/, '').trim()).filter(Boolean);
      setItems(lines.map(text => ({ id: uid(), text, done: false })));
      setBody('');
      setMode('list');
    }
  }

  return (
    <ComposerShell
      title={list ? 'New list' : 'New note'}
      onClose={close}
      onSave={save}
      saving={saving}
      savingLabel={ai ? 'Organizing…' : 'Saving…'}
      canSave={hasContent}
      color={color}
      onColor={c => setColor(c === 'default' ? null : c)}
      pinned={pinned}
      onPin={setPinned}
      error={error}
      footer={(
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <AiToggle value={ai} onChange={setAi} />
          <button type="button" className="btn-ghost text-xs" onClick={switchMode}>
            {list ? <PenLine size={14} /> : <CheckSquare size={14} />}
            {list ? 'Switch to text' : 'Switch to checklist'}
          </button>
        </div>
      )}
    >
      <input
        className={`${INPUT} text-xl font-semibold mb-3`}
        placeholder="Title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        aria-label="Title"
        autoFocus={!list}
      />
      {list ? (
        <ChecklistEditor items={items} setItems={setItems} draft={draft} setDraft={setDraft} />
      ) : (
        <>
          <div className="flex justify-end -mt-1 mb-1">
            <button type="button" className="btn-ghost text-xs py-1" onClick={() => setPreview(p => !p)} aria-pressed={preview}>
              {preview ? <PenLine size={13} /> : <Eye size={13} />} {preview ? 'Write' : 'Preview'}
            </button>
          </div>
          {preview ? (
            <div className="quick-summary min-h-[40vh] break-words">{body.trim() ? <MarkdownRenderer content={body} /> : <p className="text-sm text-navy-400">Nothing to preview</p>}</div>
          ) : (
            <textarea
              className={`${INPUT} min-h-[40vh] resize-none text-[0.95rem] leading-relaxed`}
              placeholder={'Note — markdown works: **bold**, - lists, ## headings'}
              value={body}
              onChange={e => setBody(e.target.value)}
              aria-label="Note"
            />
          )}
        </>
      )}
    </ComposerShell>
  );
}
