import { NavLink, useLocation } from 'react-router-dom';
import { Mic, Inbox } from 'lucide-react';

// Capture | Inbox switcher shared by the two Quick Capture pages
export default function QuickTabs({ reviewCount = 0 }) {
  const { pathname } = useLocation();
  const noteOpen = /^\/quick\/qn_/.test(pathname); // /quick/:id is the inbox with a note open
  return (
    <div className="tab-bar w-max">
      <NavLink to="/quick" end className={({ isActive }) => `tab-item flex items-center gap-1.5 ${isActive ? 'active' : ''}`}>
        <Mic size={13} /> Capture
      </NavLink>
      <NavLink to="/quick/inbox" className={({ isActive }) => `tab-item flex items-center gap-1.5 ${isActive || noteOpen ? 'active' : ''}`}>
        <Inbox size={13} /> Inbox
        {reviewCount > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-gold-500 text-white text-[10px] font-bold">
            {reviewCount}
          </span>
        )}
      </NavLink>
    </div>
  );
}
