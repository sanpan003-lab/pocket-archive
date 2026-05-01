import TimelineViz from './TimelineViz';
import BarChartViz from './BarChartViz';
import PieChartViz from './PieChartViz';
import DecisionTreeViz from './DecisionTreeViz';
import FlowchartViz from './FlowchartViz';

const MAP = {
  timeline:      TimelineViz,
  bar_chart:     BarChartViz,
  pie_chart:     PieChartViz,
  decision_tree: DecisionTreeViz,
  flowchart:     FlowchartViz,
};

export default function VizRenderer({ data }) {
  if (!data || !data.type) return null;
  const Component = MAP[data.type];
  if (!Component) return null;
  try {
    return <Component data={data} />;
  } catch {
    return null;
  }
}
