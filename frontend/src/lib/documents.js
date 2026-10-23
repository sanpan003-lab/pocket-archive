import { isNative } from './platform';
import { QuickRecorder } from '../native/quickRecorder';

// Smart documents (2.6.0): types, their fields, and the actions they offer (nothing happens without a tap).
// Keep the type keys in sync with the backend's documents.js.

export const DOC_TYPES = {
  receipt:       { label: 'Receipt',       category: 'Receipts',  icon: '🧾' },
  bill:          { label: 'Bill',          category: 'Bills',     icon: '💡' },
  medical:       { label: 'Medical',       category: 'Medical',   icon: '🩺' },
  school:        { label: 'School',        category: 'School',    icon: '🎒' },
  warranty:      { label: 'Warranty',      category: 'Warranty',  icon: '🛡️' },
  letter:        { label: 'Letter',        category: 'Documents', icon: '✉️' },
  business_card: { label: 'Business card', category: 'Contacts',  icon: '📇' },
  whiteboard:    { label: 'Notes / whiteboard', category: 'Notes', icon: '🖍️' },
  other:         { label: 'Other document', category: 'Documents', icon: '📄' },
};
export const CATEGORIES = ['Receipts', 'Bills', 'Medical', 'School', 'Warranty', 'Documents', 'Contacts', 'Notes'];

// [key, label, input kind]
export const DOC_FIELDS = {
  receipt: [['merchant', 'Store'], ['date', 'Date', 'date'], ['total', 'Total', 'money'], ['tax', 'Tax', 'money'], ['paymentMethod', 'Paid with'], ['items', 'Items', 'items']],
  bill: [['company', 'Company'], ['account', 'Account (last 4)'], ['amountDue', 'Amount due', 'money'], ['dueDate', 'Due date', 'date'], ['period', 'Period']],
  medical: [['provider', 'Provider'], ['date', 'Date', 'date'], ['visitType', 'Type'], ['instructions', 'Instructions', 'long']],
  school: [['school', 'School'], ['student', 'Student'], ['date', 'Date', 'date'], ['subject', 'Subject'], ['actionNeeded', 'To do', 'long']],
  warranty: [['product', 'Product'], ['store', 'Bought at'], ['purchaseDate', 'Purchased', 'date'], ['expiryDate', 'Warranty ends', 'date']],
  letter: [['sender', 'From'], ['date', 'Date', 'date'], ['subject', 'Subject'], ['actionNeeded', 'Action needed', 'long']],
  business_card: [['name', 'Name'], ['jobTitle', 'Title'], ['company', 'Company'], ['phone', 'Phone', 'tel'], ['email', 'Email', 'email'], ['website', 'Website'], ['address', 'Address', 'long']],
  whiteboard: [['topic', 'Topic']],
  other: [],
};

export const money = (v, cur) => (v ? `${!cur || cur === 'USD' ? '$' : `${cur} `}${v}` : '');
export const niceDate = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '')
  ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : d || '');

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

/** What a document offers: reminders (bill due date, warranty end − 30 days), Save to contacts */
export function documentActions(doc) {
  if (!doc || doc.status !== 'done') return [];
  const f = doc.fields || {};
  const out = [];
  if (doc.type === 'bill' && /^\d{4}-\d{2}-\d{2}$/.test(f.dueDate || '') && f.dueDate >= today()) {
    out.push({ kind: 'reminder', label: `Remind me ${niceDate(f.dueDate)}`, date: f.dueDate,
      title: `Pay ${f.company || 'the'} bill${f.amountDue ? ` — ${money(f.amountDue, f.currency)}` : ''}` });
  }
  if (doc.type === 'warranty' && /^\d{4}-\d{2}-\d{2}$/.test(f.expiryDate || '')) {
    const date = addDays(f.expiryDate, -30);
    if (date >= today()) out.push({ kind: 'reminder', label: `Remind me ${niceDate(date)} (30 days before it ends)`, date, title: `Warranty ends ${niceDate(f.expiryDate)}: ${f.product || 'product'}` });
  }
  if (doc.type === 'business_card' && (f.name || f.phone || f.email)) out.push({ kind: 'contact', label: 'Save to contacts' });
  return out;
}

const vEsc = s => String(s || '').replace(/[\\,;]/g, m => `\\${m}`).replace(/\n/g, '\\n');

/** "Save to contacts": the app opens Android's Contacts editor prefilled (you tap Save); the web downloads a vCard */
export async function saveContact(fields) {
  const f = fields || {};
  if (isNative) {
    await QuickRecorder.saveContact({ name: f.name || '', company: f.company || '', jobTitle: f.jobTitle || '', phone: f.phone || '', email: f.email || '', website: f.website || '', address: f.address || '' });
    return;
  }
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vEsc(f.name)}`, `N:${vEsc((f.name || '').split(' ').slice(-1)[0])};${vEsc((f.name || '').split(' ').slice(0, -1).join(' '))};;;`];
  if (f.company) lines.push(`ORG:${vEsc(f.company)}`);
  if (f.jobTitle) lines.push(`TITLE:${vEsc(f.jobTitle)}`);
  if (f.phone) lines.push(`TEL;TYPE=WORK:${vEsc(f.phone)}`);
  if (f.email) lines.push(`EMAIL;TYPE=WORK:${vEsc(f.email)}`);
  if (f.website) lines.push(`URL:${vEsc(f.website)}`);
  if (f.address) lines.push(`ADR;TYPE=WORK:;;${vEsc(f.address)};;;;`);
  lines.push('END:VCARD');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/vcard' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${(f.name || 'contact').replace(/[^\w ]+/g, '').trim() || 'contact'}.vcf` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** The cover image of a note (for cards): { att, page } or null */
export function coverOf(note) {
  const list = note?.attachments || [];
  if (!list.length) return null;
  const [aid, pid] = String(note.coverId || '').split('/');
  const pick = list.find(a => a.id === aid) || list.find(a => a.kind === 'image' && !/hei[cf]/.test(a.mime || '')) || list.find(a => a.pageList?.length);
  if (!pick) return null;
  if (pick.pageList?.length) return { att: pick, page: pick.pageList.find(p => p.id === pid) || pick.pageList[0] };
  return pick.kind === 'image' ? { att: pick, page: null } : null;
}
