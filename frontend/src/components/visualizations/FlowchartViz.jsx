const STEP_CONFIG = {
  start:    { bg: 'linear-gradient(135deg,#F59E0B,#D97706)', color: '#fff',     radius: 99,  label: 'START'    },
  end:      { bg: 'linear-gradient(135deg,#1E293B,#0F172A)', color: '#fff',     radius: 99,  label: 'END'      },
  process:  { bg: '#fff',                                    color: '#1E293B',  radius: 12,  border: '2px solid #E2E8F0' },
  decision: { bg: 'rgba(245,158,11,0.08)',                   color: '#92400E',  radius: 12,  border: '2px solid #FCD34D' },
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
      <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-1">Process Flow</p>
      <h4 className="font-bold text-navy-900 text-base mb-5">{title}</h4>

      <div className="flex flex-col items-center">
        {steps.map((step, i) => {
          const cfg = STEP_CONFIG[step.type] || STEP_CONFIG.process;
          const isDecision = step.type === 'decision';
          return (
            <div key={i} className="flex flex-col items-center w-full max-w-xs">
              <div
                style={{
                  background: cfg.bg,
                  color: cfg.color,
                  borderRadius: cfg.radius,
                  border: cfg.border,
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
