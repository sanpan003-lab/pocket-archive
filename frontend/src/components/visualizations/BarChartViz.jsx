import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const GOLD_SHADES = ['#F59E0B', '#FBBF24', '#D97706', '#FCD34D', '#B45309', '#FDE68A'];

const TooltipContent = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(255,255,255,0.97)',
      border: 'none',
      borderRadius: 12,
      boxShadow: '0 4px 24px rgba(15,23,42,0.12)',
      padding: '8px 14px',
      fontSize: 13,
    }}>
      <p style={{ color: '#64748B', marginBottom: 2 }}>{label}</p>
      <p style={{ color: '#0F172A', fontWeight: 700 }}>{payload[0].value}</p>
    </div>
  );
};

export default function BarChartViz({ data }) {
  const { title, data: raw = [] } = data;
  if (!raw.length) return null;

  const chartData = raw.map(d => ({ name: d.label, value: Number(d.value) || 0 }));

  return (
    <div className="glass-card p-5 my-4 animate-slide-up">
      <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-1">Chart</p>
      <h4 className="font-bold text-navy-900 text-base mb-5">{title}</h4>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 16, left: -8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: '#94A3B8' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#94A3B8' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<TooltipContent />} cursor={{ fill: 'rgba(245,158,11,0.06)' }} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={64}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={GOLD_SHADES[i % GOLD_SHADES.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
