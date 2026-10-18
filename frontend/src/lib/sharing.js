import { useEffect, useState } from 'react';
import { getSharePeople } from './api';

// Sharing helpers: who's who (initials + color for badges) and what this person may do with a note.

let peoplePromise = null;
let peopleCache = null;

/** Everyone you could share with (not you), cached for the session */
export function loadPeople(force = false) {
  if (!peoplePromise || force) {
    peoplePromise = getSharePeople()
      .then(list => { peopleCache = Object.fromEntries(list.map(p => [p.id, p])); return peopleCache; })
      .catch(() => { peoplePromise = null; return peopleCache || {}; });
  }
  return peoplePromise;
}

/** { [userId]: { id, name, initials, color } } */
export function usePeople() {
  const [people, setPeople] = useState(peopleCache || {});
  useEffect(() => {
    let alive = true;
    loadPeople().then(p => { if (alive) setPeople(p); });
    return () => { alive = false; };
  }, []);
  return people;
}

/** 'owner' | 'edit' | 'view' */
export const noteRole = note => note?.sharedFrom?.role || 'owner';
export const canEdit = note => noteRole(note) !== 'view';
export const isOwner = note => noteRole(note) === 'owner';
/** Shared either way: someone shared it with me, or I shared it */
export const isSharedNote = note => !!(note?.sharedFrom || note?.sharedWith?.length);
