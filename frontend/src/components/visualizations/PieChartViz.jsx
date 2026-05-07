import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { VIZ_COLORS } from './palette';

const TooltipContent = ({ active, payload }) => {
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
      <p style={{ color: '#64748B', marginBottom: 2 }}>{payload[0].name}</p>
      <p style={{ color: '#0F172A', fontWeight: 700 }}>{payload[0].value}</p>
    </div>
  );
};

const LegendEntry = ({ value, color }) => (
  <span className="inline-flex items-center gap-1.5 text-xs text-navy-600 mr-3">
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: color }} />
    {value}
  </span>
);

export default function PieChartViz({ data }) {
  const { title, data: raw = [] } = data;
  if (!raw.length) return null;

  const chartData = raw.map(d => ({ name: d.label, value: Number(d.value) || 0 }));

  return (
    <div className="glass-card p-5 my-4 animate-slide-up">
      <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-1">Distribution</p>
      <h4 className="font-bold text-navy-900 text-base mb-4">{title}</h4>

      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={95}
            dataKey="value"
            paddingAngle={3}
            strokeWidth={0}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={VIZ_COLORS[i % VIZ_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<TooltipContent />} />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value, entry) => (
              <span style={{ fontSize: 12, color: '#475569' }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
