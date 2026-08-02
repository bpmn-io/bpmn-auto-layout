import { LayoutError } from '../../../LayoutError.js';
import { scorePlacementCandidate } from './LayoutScoring.js';

import type {
  SemanticPolicy
} from '../../Types.js';
import type { LayoutScore } from './LayoutScoring.js';
import type {
  PlacementCandidate
} from './PlacementCandidate.js';

export function evaluatePlacementCandidate({
  candidate,
  policy,
  reroute
}: {
  candidate: PlacementCandidate;
  policy: SemanticPolicy;
  reroute: () => void;
}): LayoutScore | null {
  try {
    reroute();
  } catch (error) {
    if (error instanceof LayoutError && error.code === 'ROUTING_FAILED') {
      return null;
    }

    throw error;
  }

  const score = scorePlacementCandidate(candidate, policy);

  return score;
}
