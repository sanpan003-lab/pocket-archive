import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { VIZ_COLORS } from './palette';

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
  const height = Math.max(180, chartData.length * 44 + 40);

  return (
    <div className="glass-card p-5 my-4 animate-slide-up">
      <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-1">Metrics</p>
      <h4 className="font-bold text-navy-900 text-base mb-4">{title}</h4>

      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
        >
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#94A3B8' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fontSize: 12, fill: '#475569' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<TooltipContent />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} label={{ position: 'right', fontSize: 11, fill: '#64748B' }}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={VIZ_COLORS[i % VIZ_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
