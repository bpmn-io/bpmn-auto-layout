export function parseIterationCount(value) {
  const iterations = Number(value);

  if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error('Iteration count must be a positive integer.');
  }

  return iterations;
}

export function calculateStatistics(times) {
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

function percentile(sortedTimes, quantile) {
  const index = (sortedTimes.length - 1) * quantile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const fraction = index - lowerIndex;

  return sortedTimes[lowerIndex] +
    (sortedTimes[upperIndex] - sortedTimes[lowerIndex]) * fraction;
}
