import { ROUTING_MARGIN } from '../Constants.js';
import { compareScores, routeLength } from '../geometry/index.js';

export function compareArtifactPlacementScores(a, b) {
  return compareScores(a, b);
}

export function createArtifactPlacementScore({
  participantInteriorViolation,
  dataCrossings,
  congestionViolation,
  missesOwnerAlignment,
  alignedOwnerReward,
  associationBends,
  weightedLength,
  associationLength,
  annotationSize,
  annotationCrossings,
  containmentViolation,
  expansion,
  sideRank,
  offset,
  gap,
  y,
  x
}) {
  return [
    participantInteriorViolation,
    dataCrossings,
    congestionViolation,
    missesOwnerAlignment,
    alignedOwnerReward,
    associationBends,
    weightedLength,
    associationLength,
    annotationSize,
    annotationCrossings,
    containmentViolation,
    expansion,
    sideRank,
    offset,
    gap,
    y,
    x
  ];
}

export function artifactIsAligned(artifact, owner) {
  return artifact.x + artifact.width / 2 === owner.x + owner.width / 2 ||
    artifact.y + artifact.height / 2 === owner.y + owner.height / 2;
}

export function ownerBalancedRouteLength(routedReferences) {
  const ownerRoutes = new Map();

  for (const { owner, points } of routedReferences) {
    const lengths = ownerRoutes.get(owner) || [];

    lengths.push(routeLength(points));
    ownerRoutes.set(owner, lengths);
  }

  return [ ...ownerRoutes.values() ].reduce((total, lengths) => {
    return total + lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  }, 0);
}

export function artifactCongestionPenalty(rect, obstacles) {
  const nearestDistance = obstacles.reduce((nearest, obstacle) => {
    return Math.min(nearest, rectangleDistance(rect, obstacle));
  }, Infinity);

  return Math.max(0, 2 * ROUTING_MARGIN - nearestDistance);
}

function rectangleDistance(a, b) {
  const horizontal = Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0);
  const vertical = Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0);

  return Math.hypot(horizontal, vertical);
}

export function artifactExpansion(rect, extents) {
  return Math.max(0, extents.minX - rect.x) +
    Math.max(0, extents.minY - rect.y) +
    Math.max(0, rect.x + rect.width - extents.maxX) +
    Math.max(0, rect.y + rect.height - extents.maxY);
}

export function isStraightOrthogonalRoute(points) {
  return points.every(({ x }) => x === points[0].x) ||
    points.every(({ y }) => y === points[0].y);
}
