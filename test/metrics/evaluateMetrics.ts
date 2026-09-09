import { analyzeMetrics } from './computeMetrics.js';

type MetricAnalysis = Awaited<ReturnType<typeof analyzeMetrics>>;

export const METRIC_KEYS = [
  'crossings',
  'parallelEdgeOverlaps',
  'bendCount',
  'overlaps',
  'edgeShapeIntersections',
  'detachedDockings',
  'wrongWayDockings',
  'nonOrthogonalConnections',
  'backtrackingConnections',
  'averageEdgeLength',
  'edgeSegmentLengthDeviation',
  'labelShapeOverlaps',
  'labelEdgeOverlaps',
  'compactness',
  'gridAlignment',
  'branchSymmetry'
] as const;

type MetricKey = typeof METRIC_KEYS[number];
type MetricValues = Pick<MetricAnalysis['metrics'], MetricKey>;
type MetricBaseline = Partial<MetricValues>;
type MetricEvaluation = {
  baseline: MetricBaseline | null;
  current: MetricValues;
  delta: MetricValues | null;
  findings: MetricAnalysis['findings'];
  error: null;
} | {
  baseline: MetricBaseline | null;
  current: null;
  delta: null;
  findings: null;
  error: string;
};

export async function evaluateMetrics(
    xml: string,
    baseline: MetricBaseline | null = null
): Promise<MetricEvaluation> {
  try {
    const { metrics, findings } = await analyzeMetrics(xml);
    const current = pick(metrics);

    return {
      baseline,
      current,
      delta: baseline ? delta(current, baseline) : null,
      findings,
      error: null
    };
  } catch (error) {
    return {
      baseline,
      current: null,
      delta: null,
      findings: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function hasBandADefect(metrics: MetricEvaluation): boolean {
  if (!metrics.current) {
    return false;
  }

  const { current } = metrics;

  return current.overlaps !== 0 ||
    current.edgeShapeIntersections !== 0 ||
    current.detachedDockings !== 0 ||
    current.wrongWayDockings !== 0 ||
    current.nonOrthogonalConnections !== 0 ||
    current.backtrackingConnections !== 0;
}

function pick(metrics: MetricAnalysis['metrics']): MetricValues {
  return {
    crossings: metrics.crossings, bendCount: metrics.bendCount, overlaps: metrics.overlaps,
    parallelEdgeOverlaps: metrics.parallelEdgeOverlaps,
    edgeShapeIntersections: metrics.edgeShapeIntersections, detachedDockings: metrics.detachedDockings,
    wrongWayDockings: metrics.wrongWayDockings, nonOrthogonalConnections: metrics.nonOrthogonalConnections,
    backtrackingConnections: metrics.backtrackingConnections, averageEdgeLength: metrics.averageEdgeLength,
    edgeSegmentLengthDeviation: metrics.edgeSegmentLengthDeviation, labelShapeOverlaps: metrics.labelShapeOverlaps,
    labelEdgeOverlaps: metrics.labelEdgeOverlaps, compactness: metrics.compactness,
    gridAlignment: metrics.gridAlignment, branchSymmetry: metrics.branchSymmetry
  };
}

function delta(current: MetricValues, baseline: MetricBaseline): MetricValues {
  return {
    crossings: current.crossings - (baseline.crossings ?? 0), bendCount: current.bendCount - (baseline.bendCount ?? 0),
    parallelEdgeOverlaps: current.parallelEdgeOverlaps - (baseline.parallelEdgeOverlaps ?? 0),
    overlaps: current.overlaps - (baseline.overlaps ?? 0), edgeShapeIntersections: current.edgeShapeIntersections - (baseline.edgeShapeIntersections ?? 0),
    detachedDockings: current.detachedDockings - (baseline.detachedDockings ?? 0), wrongWayDockings: current.wrongWayDockings - (baseline.wrongWayDockings ?? 0),
    nonOrthogonalConnections: current.nonOrthogonalConnections - (baseline.nonOrthogonalConnections ?? 0), backtrackingConnections: current.backtrackingConnections - (baseline.backtrackingConnections ?? 0),
    averageEdgeLength: current.averageEdgeLength - (baseline.averageEdgeLength ?? 0), edgeSegmentLengthDeviation: current.edgeSegmentLengthDeviation - (baseline.edgeSegmentLengthDeviation ?? 0),
    labelShapeOverlaps: current.labelShapeOverlaps - (baseline.labelShapeOverlaps ?? 0), labelEdgeOverlaps: current.labelEdgeOverlaps - (baseline.labelEdgeOverlaps ?? 0),
    compactness: current.compactness - (baseline.compactness ?? 0), gridAlignment: current.gridAlignment - (baseline.gridAlignment ?? 0),
    branchSymmetry: current.branchSymmetry - (baseline.branchSymmetry ?? 0)
  };
}
