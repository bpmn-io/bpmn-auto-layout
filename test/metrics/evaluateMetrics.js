import { analyzeMetrics } from './computeMetrics.js';

export const METRIC_KEYS = [
  'crossings',
  'bendCount',
  'overlaps',
  'edgeShapeIntersections',
  'wrongWayDockings',
  'averageEdgeLength',
  'edgeSegmentLengthDeviation',
  'labelShapeOverlaps',
  'labelEdgeOverlaps',
  'compactness',
  'gridAlignment',
  'branchSymmetry'
];

export async function evaluateMetrics(xml, baseline = null) {
  try {
    const { metrics, findings } = await analyzeMetrics(xml);
    const current = pick(metrics, METRIC_KEYS);

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
      error: error.message
    };
  }
}

export function hasBandADefect(metrics) {
  return !metrics.error && (
    metrics.current.overlaps !== 0 ||
    metrics.current.edgeShapeIntersections !== 0 ||
    metrics.current.wrongWayDockings !== 0
  );
}

function pick(metrics, keys) {
  return keys.reduce((result, key) => ({ ...result, [ key ]: metrics[key] }), {});
}

function delta(current, baseline) {
  return METRIC_KEYS.reduce((result, key) => ({
    ...result,
    [ key ]: current[key] - (baseline[key] ?? 0)
  }), {});
}