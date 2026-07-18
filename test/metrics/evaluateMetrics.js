import { computeMetrics } from './computeMetrics.js';

export const METRIC_KEYS = [
  'crossings',
  'overlaps',
  'edgeShapeIntersections',
  'wrongWayDockings',
  'edgeLength'
];

export async function evaluateMetrics(xml, baseline = null) {
  try {
    const computed = await computeMetrics(xml);
    const current = pick(computed, METRIC_KEYS);

    return {
      baseline,
      current,
      delta: baseline ? delta(current, baseline) : null,
      error: null
    };
  } catch (error) {
    return {
      baseline,
      current: null,
      delta: null,
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