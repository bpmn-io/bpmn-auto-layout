export interface BenchmarkStatistics {
  averageMs: number;
  p50Ms: number;
  p90Ms: number;
}

export function parseIterationCount(value: string | undefined): number {
  const iterations = Number(value);

  if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error('Iteration count must be a positive integer.');
  }

  return iterations;
}

export function calculateStatistics(times: readonly number[]): BenchmarkStatistics {
  if (!times.length) {
    throw new Error('At least one timing is required.');
  }

  const sortedTimes = [ ...times ].sort((a, b) => a - b);
  const averageMs = times.reduce((total, time) => total + time, 0) / times.length;

  return {
    averageMs,
    p50Ms: percentile(sortedTimes, 0.5),
    p90Ms: percentile(sortedTimes, 0.9)
  };
}

function percentile(sortedTimes: readonly number[], quantile: number): number {
  const index = (sortedTimes.length - 1) * quantile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const fraction = index - lowerIndex;

  return sortedTimes[lowerIndex] +
    (sortedTimes[upperIndex] - sortedTimes[lowerIndex]) * fraction;
}
