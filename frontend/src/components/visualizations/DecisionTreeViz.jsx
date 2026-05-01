export default function DecisionTreeViz({ data }) {
  const { title, branches = [] } = data;
  if (!branches.length) return null;

  return (
    <div className="glass-card p-5 my-4 animate-slide-up">
      <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-1">Decision Analysis</p>
      <h4 className="font-bold text-navy-900 text-base mb-5">{title}</h4>

      <div className="space-y-0">
        {branches.map((branch, i) => (
          <div key={i} className="flex gap-3">
            {/* Left: number + connector */}
            <div className="flex flex-col items-center shrink-0">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-gold"
                style={{ background: 'linear-gradient(135deg, #F59E0B, #D97706)' }}
              >
                {i + 1}
              </div>
              {i < branches.length - 1 && (
                <div className="w-0.5 flex-1 my-1" style={{ background: 'rgba(245,158,11,0.25)', minHeight: 16 }} />
              )}
            </div>

            {/* Right: content */}
            <div className="pb-4 flex-1 pt-1">
              <p className="font-semibold text-navy-900 text-sm leading-snug">{branch.condition}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-gold-500 font-bold text-sm">→</span>
                <span className="text-sm font-semibold text-gold-700">{branch.result}</span>
              </div>
              {branch.details && (
                <p className="text-xs text-navy-500 mt-1.5 leading-relaxed">{branch.details}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
