import { Link } from 'react-router-dom';

/**
 * "⏰ 3 PM", "⏲ 10 min", "📍 Publix": a note that also set something up on the phone.
 * Links to the entry in Quick Capture → Actions (plain text inside a card's button).
 */
export default function ActionChip({ note, link = false }) {
  const ref = note?.actionRef;
  if (!ref || ref.removed) return null;
  const cls = 'badge badge-slate whitespace-nowrap';
  return link
    ? <Link to={`/quick/actions?focus=${ref.id}`} className={`${cls} hover:underline`} title={ref.title}>{ref.chip}</Link>
    : <span className={cls} title={ref.title}>{ref.chip}</span>;
}
