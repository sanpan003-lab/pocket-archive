import { LayoutTemplate, Compass } from 'lucide-react';
import { useLayout, setLiteOnDevice } from '../../lib/layout';
import { openWelcome } from '../../lib/uiBus';

/** Admin: the Lite layout on this one device (Settings › Appearance & app icon) */
export function LayoutOnDevice() {
  const { liteOnDevice } = useLayout();
  return (
    <div id="layout" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <LayoutTemplate size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Layout on this device</h2>
      </div>
      <label className="flex items-start gap-3 mt-2 cursor-pointer">
        <input type="checkbox" className="accent-amber-500 w-4 h-4 mt-0.5" checked={liteOnDevice} onChange={e => setLiteOnDevice(e.target.checked)} />
        <span>
          <span className="block text-sm font-semibold text-navy-900 dark:text-white">Use Lite layout on this device</span>
          <span className="block text-xs text-navy-500 dark:text-white/50">
            Pocket Notes: Capture, Inbox, Lists, Projects, Shared with me, Calendar and Search. The archive, sync and admin settings are hidden here until you turn this off. Other devices keep their layout.
          </span>
        </span>
      </label>
    </div>
  );
}

/** Settings › About & updates › Advanced */
export function WelcomeTour() {
  return (
    <div id="welcome" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Compass size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Welcome tour</h2>
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-3">Password, two-step verification, home, permissions, calendar and a quick tour.</p>
      <button className="btn-white text-sm" onClick={openWelcome}>Show the welcome tour</button>
    </div>
  );
}

/** A collapsible "Advanced" group at the bottom of a category */
export function Advanced({ children }) {
  return (
    <details className="settings-advanced mt-2" data-advanced="">
      <summary className="cursor-pointer select-none text-sm font-semibold text-navy-600 dark:text-white/70 min-h-[44px] flex items-center px-1">Advanced</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
