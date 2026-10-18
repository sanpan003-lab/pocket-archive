import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { LIVE_EVENT } from '../lib/liveEvents';
import QuickToast from './quick/QuickToast';

const VERB = {
  added: 'added', removed: 'removed', checked: 'checked off', unchecked: 'unchecked', edited: 'edited',
  renamed: 'renamed a list to', 'edited the text': 'edited', 'at-store': 'is at', done: 'finished', reopened: 'reopened',
};

/** "Jane added Eggs · Publix list" while the app is open (someone else's change on a shared note) */
export default function LiveToast() {
  const { user } = useApp();
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    const onLive = e => {
      const d = e.detail || {};
      if (document.visibilityState !== 'visible') return;
      if (d.type === 'share' && !d.removed && d.byName) {
        setToast({ id: Date.now(), icon: '👥', text: `${d.byName} shared something with you`, tone: 'success', duration: 6000,
          actions: [{ label: 'Open', onClick: () => navigate('/shared') }] });
        return;
      }
      if (d.type !== 'note' || !d.by || d.by === user?.id || !d.action || d.action === 'shared with') return;
      const what = d.action === 'edited the text' || d.action === 'done' || d.action === 'reopened' ? d.title : d.text;
      setToast({
        id: Date.now(), icon: d.action === 'at-store' ? '📍' : '✏️', tone: 'queued', duration: 5000,
        text: `${d.byName} ${VERB[d.action] || d.action}${what ? ` ${what}` : ''}`,
        detail: d.action === 'at-store' || d.action === 'edited the text' || d.action === 'done' || d.action === 'reopened' ? null : d.title,
        actions: [{ label: 'Open', onClick: () => navigate(`/quick/${d.id}`) }],
      });
    };
    window.addEventListener(LIVE_EVENT, onLive);
    return () => window.removeEventListener(LIVE_EVENT, onLive);
  }, [user?.id, navigate]);

  return <QuickToast toast={toast} onDismiss={dismiss} />;
}
