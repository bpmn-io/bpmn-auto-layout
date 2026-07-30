export const INSPECTOR_LAYOUT_TIMING_RUNS = 5;

export function shouldMeasureLayoutTimings(environment = process.env) {
  return environment.INSPECTOR_TIMINGS === 'true';
}
