// What's new (Settings → About, and the one-time sheet after an app update).
// Source: the monorepo's CHANGELOG.md, copied by `npm run changelog` / prebuild.
import raw from '../generated/changelog.md?raw';

/** [{ version, date, note, groups: [{ title, items: [string] }] }], newest first */
export function parseChangelog(text) {
  const out = [];
  let cur = null;
  let group = null;
  for (const line of text.split(/\r?\n/)) {
    const v = line.match(/^## (\S+) — (.+?)(?: \((.+)\))?\s*$/);
    if (v) {
      cur = { version: v[1], date: v[2], note: v[3] || null, groups: [] };
      group = null;
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const g = line.match(/^### (.+)$/);
    if (g) { group = { title: g[1].trim(), items: [] }; cur.groups.push(group); continue; }
    const b = line.match(/^- (.+)$/);
    if (b) {
      if (!group) { group = { title: null, items: [] }; cur.groups.push(group); }
      group.items.push(b[1].trim());
    }
  }
  return out;
}

export const CHANGELOG = parseChangelog(raw);

/** The web app's version = the newest changelog entry */
export const WEB_VERSION = CHANGELOG[0]?.version || '0.0.0';

export const entryFor = version => CHANGELOG.find(e => e.version === version) || null;
