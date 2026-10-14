// Gradient start/end pills read well in both themes; process/decision steps
// use theme-aware classes so they don't glare white in dark mode.
const STEP_CONFIG = {
  start:    { bg: 'linear-gradient(135deg,#F59E0B,#D97706)', color: '#fff', radius: 99 },
  end:      { bg: 'linear-gradient(135deg,#1E293B,#0F172A)', color: '#fff', radius: 99, className: 'dark:ring-1 dark:ring-white/15' },
  process:  { radius: 12, className: 'bg-white dark:bg-white/10 text-navy-800 dark:text-white border-2 border-navy-200 dark:border-white/15' },
  decision: { radius: 12, className: 'bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-200 border-2 border-gold-300 dark:border-amber-400/40' },
};

function Arrow() {
  return (
    <div className="flex flex-col items-center my-0.5">
      <div className="w-px h-4" style={{ background: '#CBD5E1' }} />
      <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
        <path d="M0 0L5 6L10 0" fill="#CBD5E1" />
      </svg>
    </div>
  );
}

export default function FlowchartViz({ data }) {
  const { title, steps = [] } = data;
  if (!steps.length) return null;

  return (
    <div className="glass-card p-5 my-4 animate-slide-up">
      <p className="text-xs font-semibold text-navy-400 dark:text-white/40 uppercase tracking-wider mb-1">Process Flow</p>
      {title && <h4 className="font-bold text-navy-900 dark:text-white text-base mb-5 break-words">{title}</h4>}

      <div className="flex flex-col items-center">
        {steps.map((step, i) => {
          const cfg = STEP_CONFIG[step.type] || STEP_CONFIG.process;
          const isDecision = step.type === 'decision';
          return (
            <div key={i} className="flex flex-col items-center w-full max-w-xs">
              <div
                className={`break-words ${cfg.className || ''}`}
                style={{
                  background: cfg.bg,
                  color: cfg.color,
                  borderRadius: cfg.radius,
                  padding: isDecision ? '8px 18px' : '9px 20px',
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: 'center',
                  width: '100%',
                  boxShadow: step.type === 'start' || step.type === 'end'
                    ? '0 4px 12px rgba(245,158,11,0.25)'
                    : '0 1px 4px rgba(15,23,42,0.06)',
                  position: 'relative',
                }}
              >
                {isDecision && (
                  <span style={{ marginRight: 6, opacity: 0.6 }}>◇</span>
                )}
                {step.label}
              </div>
              {i < steps.length - 1 && <Arrow />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
