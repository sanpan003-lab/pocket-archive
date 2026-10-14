// Where to go after signing in — the page that sent you to /login,
// including its query (e.g. /quick?autostart=1), else the dashboard
export function returnPath(location) {
  const from = location.state?.from;
  if (!from?.pathname || from.pathname === '/login') return '/';
  return `${from.pathname}${from.search || ''}`;
}
