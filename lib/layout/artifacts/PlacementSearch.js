import { is } from '../../di/DiUtil.js';
import { LayoutError } from '../../LayoutError.js';
import {
  BOUNDARY_EVENT_ARTIFACT_CLEARANCE,
  EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE,
  NON_STRAIGHT_ARTIFACT_ASSOCIATION_PENALTY,
  PARTICIPANT_HEADER_WIDTH,
  ROUTING_MARGIN,
  SUB_PROCESS_PADDING,
  VERTICAL_GAP
} from '../Constants.js';
import { isExteriorArtifact } from '../bpmn/Predicates.js';
import {
  bounds,
  rectanglesOverlap,
  routeLength,
  segmentEntersRect,
  toSegments
} from '../geometry/index.js';
import {
  createBpmnOrthogonalRouter
} from '../routing/BpmnOrthogonalRouting.js';
import {
  artifactAssociationConnection,
  routeCrossings
} from './AssociationRouting.js';
import { findContainingArtifactContainers } from './Ownership.js';
import {
  annotationSizePenalty,
  artifactClearanceBounds,
  artifactSizeCandidates,
  createArtifactPlacementCandidates
} from './PlacementCandidates.js';
import {
  artifactCongestionPenalty,
  artifactExpansion,
  artifactIsAligned,
  compareArtifactPlacementScores,
  createArtifactPlacementScore,
  isStraightOrthogonalRoute,
  ownerBalancedRouteLength
} from './PlacementScoring.js';

export function createArtifactPlacementProblem(context, record) {
  const {
    additionalBoundaryContainers,
    avoidParticipantInterior,
    graphExtents,
    graphObstacles,
    graphRoutes,
    graphShapes,
    owners,
    placedArtifacts,
    placementExtents,
    preferParticipantSides,
    reservedVerticalEndpointDirections
  } = context;
  const artifact = record.element;
  const references = owners.get(artifact) || [];
  const ownerBounds = references.length
    ? graphShapes.get(references[0].owner)
    : null;
  const owner = references[0]?.owner;
  const enclosingSubProcesses = findEnclosingSubProcesses(
    owner,
    ownerBounds,
    graphShapes
  );
  const subProcessContainer = enclosingSubProcesses
    .map(([ , rect ]) => rect)
    .sort((a, b) => a.width * a.height - b.width * b.height)[0];
  const containingContainers = ownerBounds
    ? findContainingArtifactContainers(ownerBounds, graphShapes)
    : [];
  const container = containingContainers[0];
  const boundaryContainers = createBoundaryContainers(
    additionalBoundaryContainers,
    graphShapes,
    containingContainers
  );
  const processContainer = subProcessContainer || (
    !container && isExteriorArtifact(artifact)
      ? bounds(
        graphExtents.minX - SUB_PROCESS_PADDING,
        graphExtents.minY - SUB_PROCESS_PADDING,
        graphExtents.width + 2 * SUB_PROCESS_PADDING,
        graphExtents.height + 2 * SUB_PROCESS_PADDING
      )
      : null
  );
  const annotationClearance = subProcessContainer &&
    is(artifact, 'bpmn:TextAnnotation')
    ? EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE
    : 0;
  const obstacles = graphObstacles.filter(({ element }) => {
    return !enclosingSubProcesses.some(([ subProcess ]) => {
      return subProcess === element;
    });
  });

  return {
    artifact,
    ownerBounds,
    references,
    sizes: artifactSizeCandidates(artifact),
    obstacles,
    routes: graphRoutes,
    occupied: placedArtifacts,
    container,
    processContainer,
    extents: placementExtents,
    annotationClearance,
    boundaryContainers,
    avoidParticipantInterior,
    preferParticipantSides,
    participantInteriorPreference: (
      isExteriorArtifact(artifact) &&
      references.some(({ owner }) => {
        return reservedVerticalEndpointDirections.has(owner);
      })
    ) ? VERTICAL_GAP : 0
  };
}

function findEnclosingSubProcesses(owner, ownerBounds, graphShapes) {
  if (!ownerBounds) {
    return [];
  }

  const centerX = ownerBounds.x + ownerBounds.width / 2;
  const centerY = ownerBounds.y + ownerBounds.height / 2;

  return [ ...graphShapes.entries() ].filter(([ element, rect ]) => {
    return element !== owner &&
      is(element, 'bpmn:SubProcess') &&
      centerX >= rect.x &&
      centerX <= rect.x + rect.width &&
      centerY >= rect.y &&
      centerY <= rect.y + rect.height;
  });
}

function createBoundaryContainers(
    additionalBoundaryContainers,
    graphShapes,
    containingContainers) {
  return [
    ...additionalBoundaryContainers,
    ...[ ...graphShapes.entries() ]
      .filter(([ element ]) => {
        return is(element, 'bpmn:Lane') ||
          is(element, 'bpmn:Participant') ||
          is(element, 'bpmn:SubProcess');
      })
      .map(([ element, rect ]) => ({
        rect,
        containsOwner: containingContainers.includes(rect),
        participant: is(element, 'bpmn:Participant')
      }))
  ];
}

export function findArtifactPlacement(problem) {
  const search = prepareArtifactPlacementSearch(problem);
  const rankedCandidates = rankArtifactPlacementCandidates(search);
  const best = selectArtifactPlacementCandidate(search, rankedCandidates);

  if (best) {
    return best;
  }

  throw new LayoutError(
    'ARTIFACT_PLACEMENT_FAILED',
    problem.artifact.id,
    `No collision-free artifact position could be found (${problem.artifact.id}).`
  );
}

function prepareArtifactPlacementSearch(problem) {
  const {
    artifact,
    ownerBounds,
    references,
    sizes,
    obstacles,
    occupied,
    boundaryContainers,
    annotationClearance,
    extents
  } = problem;
  const preparedBoundaryContainers = boundaryContainers.map(({
    rect,
    containsOwner,
    participant
  }) => {
    return {
      containsOwner,
      participant,
      rect,
      headerRect: participant && {
        x: rect.x,
        y: rect.y,
        width: PARTICIPANT_HEADER_WIDTH,
        height: rect.height
      }
    };
  });
  const referenceOwnerBounds = [ ...new Set(
    references.map(reference => reference.ownerBounds).filter(Boolean)
  ) ];
  const candidates = createArtifactPlacementCandidates(
    artifact,
    ownerBounds,
    referenceOwnerBounds,
    sizes,
    preparedBoundaryContainers,
    annotationClearance,
    extents
  );
  const obstacleBounds = obstacles.map(({ element, rect }) => {
    return is(element, 'bpmn:BoundaryEvent')
      ? artifactObstacleBounds(rect)
      : rect;
  });
  const occupiedBounds = occupied.map(({
    element,
    rect,
    annotationClearance
  }) => {
    return artifactClearanceBounds(element, rect, annotationClearance);
  });

  return {
    ...problem,
    preparedBoundaryContainers,
    referenceOwnerBounds,
    hasMultipleOwners: referenceOwnerBounds.length > 1,
    candidates,
    obstacleBounds,
    occupiedBounds,
    routeSegments: problem.routes.flatMap(route => toSegments(route.points)),
    dataArtifact: is(artifact, 'bpmn:DataObjectReference') ||
      is(artifact, 'bpmn:DataStoreReference'),
    requiresContainment: is(artifact, 'bpmn:DataObjectReference')
  };
}

function rankArtifactPlacementCandidates(search) {
  return search.candidates.map(candidate => {
    return rankArtifactPlacementCandidate(search, candidate);
  }).sort((a, b) => {
    return compareArtifactPlacementScores(a.lowerBound, b.lowerBound);
  });
}

function rankArtifactPlacementCandidate(search, candidate) {
  const routedReferences = routeCandidateReferences(search, candidate);
  const measures = measureArtifactPlacementCandidate(
    search,
    candidate,
    routedReferences
  );
  const lowerBound = createCandidateScore(
    search,
    candidate,
    measures,
    measures.directLength,
    0,
    {
      fitsContainer: true,
      fitsProcessContainer: true
    }
  );

  return {
    candidate,
    lowerBound,
    routedReferences,
    ...measures
  };
}

function routeCandidateReferences(search, candidate) {
  const {
    artifact,
    obstacles,
    references,
    routeSegments
  } = search;

  return references.map(({
    association,
    owner,
    ownerBounds,
    ownerConnectionIndex,
    ownerConnectionCount
  }) => {
    const points = ownerBounds && artifactAssociationConnection(
      association,
      owner,
      ownerBounds,
      artifact,
      candidate.rect,
      ownerConnectionIndex,
      ownerConnectionCount,
      obstacles,
      routeSegments
    );

    return points && { owner, points };
  }).filter(Boolean);
}

function measureArtifactPlacementCandidate(
    search,
    candidate,
    routedReferences) {
  const {
    artifact,
    dataArtifact,
    hasMultipleOwners,
    obstacleBounds,
    preparedBoundaryContainers,
    referenceOwnerBounds
  } = search;
  const directLength = dataArtifact
    ? ownerBalancedRouteLength(routedReferences)
    : routedReferences.reduce((total, { points }) => {
      return total + routeLength(points);
    }, 0);
  const associationCrossingCount = routedReferences.reduce((
      total,
      { points }
  ) => {
    return total + routeCrossings(points, search.routeSegments);
  }, 0);
  const associationBendCount = dataArtifact
    ? routedReferences.reduce((total, { points }) => {
      return total + Math.max(0, points.length - 2);
    }, 0)
    : 0;
  const alignedOwnerCount = dataArtifact
    ? referenceOwnerBounds.filter(referenceBounds => {
      return artifactIsAligned(candidate.rect, referenceBounds);
    }).length
    : 0;
  const missesOwnerAlignment = dataArtifact &&
    referenceOwnerBounds.length > 0 &&
    alignedOwnerCount === 0 ? 1 : 0;
  const congestionPenalty = hasMultipleOwners
    ? artifactCongestionPenalty(candidate.rect, obstacleBounds)
    : 0;
  const participantInteriorPenalty = (
    search.avoidParticipantInterior ||
    search.participantInteriorPreference
  ) ? artifactParticipantInteriorPenalty(
      artifact,
      candidate.rect,
      preparedBoundaryContainers
    ) : 0;
  const participantVerticalSidePenalty = search.preferParticipantSides
    ? artifactParticipantVerticalSidePenalty(
      artifact,
      candidate.rect,
      preparedBoundaryContainers
    )
    : 0;

  return {
    alignedOwnerCount,
    associationBendCount,
    associationCrossingCount,
    congestionPenalty,
    congestionViolation: congestionPenalty > 0 ? 1 : 0,
    directLength,
    missesOwnerAlignment,
    participantInteriorPenalty,
    participantVerticalSidePenalty
  };
}

function artifactParticipantInteriorPenalty(
    artifact,
    rect,
    boundaryContainers) {
  if (!is(artifact, 'bpmn:TextAnnotation')) {
    return 0;
  }

  return boundaryContainers.some(({
    rect: container,
    containsOwner,
    participant
  }) => {
    return participant &&
      containsOwner &&
      artifactFitsContainer(rect, container, 0);
  }) ? 1 : 0;
}

function artifactParticipantVerticalSidePenalty(
    artifact,
    rect,
    boundaryContainers) {
  if (!is(artifact, 'bpmn:TextAnnotation')) {
    return 0;
  }

  return boundaryContainers.some(({
    rect: container,
    containsOwner,
    participant
  }) => {
    return participant &&
      containsOwner &&
      (
        rect.y + rect.height <= container.y ||
        rect.y >= container.y + container.height
      );
  }) ? 1 : 0;
}

function selectArtifactPlacementCandidate(search, rankedCandidates) {
  let best;
  const clearanceRouters = new Map();

  for (const rankedCandidate of rankedCandidates) {
    if (
      best &&
      compareArtifactPlacementScores(
        rankedCandidate.lowerBound,
        best.score
      ) >= 0
    ) {
      break;
    }

    const validity = validateArtifactPlacementCandidate(
      search,
      rankedCandidate,
      clearanceRouters
    );

    if (!validity) {
      continue;
    }

    const associationLength = search.dataArtifact
      ? ownerBalancedRouteLength(rankedCandidate.routedReferences)
      : rankedCandidate.routedReferences.reduce((total, { points }) => {
        return total + routeLength(points);
      }, 0);
    const nonStraightPenalty = is(search.artifact, 'bpmn:TextAnnotation')
      ? rankedCandidate.routedReferences.reduce((total, { points }) => {
        return total + (
          isStraightOrthogonalRoute(points)
            ? 0
            : NON_STRAIGHT_ARTIFACT_ASSOCIATION_PENALTY
        );
      }, 0)
      : 0;
    const score = createCandidateScore(
      search,
      rankedCandidate.candidate,
      rankedCandidate,
      associationLength,
      nonStraightPenalty,
      validity
    );

    if (!best || compareArtifactPlacementScores(score, best.score) < 0) {
      best = {
        candidate: rankedCandidate.candidate.rect,
        score
      };
    }
  }

  return best?.candidate;
}

function validateArtifactPlacementCandidate(
    search,
    rankedCandidate,
    clearanceRouters) {
  const { candidate, routedReferences } = rankedCandidate;
  const candidateBounds = artifactClearanceBounds(
    search.artifact,
    candidate.rect,
    search.annotationClearance
  );
  const fitsContainer = artifactFitsContainer(
    candidateBounds,
    search.container,
    0
  );
  const fitsProcessContainer = artifactFitsContainer(
    candidateBounds,
    search.processContainer,
    0
  );

  if (
    artifactCandidateViolatesGeometry(
      search,
      candidate,
      candidateBounds,
      fitsContainer,
      fitsProcessContainer
    ) ||
    !routedReferences.every(({ owner, points }) => {
      let router = clearanceRouters.get(owner);

      if (!router) {
        router = createBpmnOrthogonalRouter({
          shapes: search.obstacles,
          sourceElement: owner,
          targetElement: search.artifact
        });
        clearanceRouters.set(owner, router);
      }

      return router.isClear(points);
    })
  ) {
    return null;
  }

  return {
    fitsContainer,
    fitsProcessContainer
  };
}

function artifactCandidateViolatesGeometry(
    search,
    candidate,
    candidateBounds,
    fitsContainer,
    fitsProcessContainer) {
  const straddlesContainer = search.container &&
    rectanglesOverlap(candidateBounds, search.container) &&
    !fitsContainer;
  const straddlesProcessContainer = search.processContainer &&
    rectanglesOverlap(candidateBounds, search.processContainer) &&
    !fitsProcessContainer;
  const violatesContainerBoundary = search.preparedBoundaryContainers.some(({
    rect,
    containsOwner,
    participant,
    headerRect
  }) => {
    if (participant && rectanglesOverlap(candidateBounds, headerRect)) {
      return true;
    }

    if (!rectanglesOverlap(candidateBounds, rect)) {
      return false;
    }

    return !containsOwner || !artifactFitsContainer(candidateBounds, rect, 0);
  });
  const overlapsParticipantHeader = search.container &&
    candidateBounds.y < search.container.y + search.container.height &&
    candidateBounds.y + candidateBounds.height > search.container.y &&
    candidateBounds.x < search.container.x &&
    candidateBounds.x + candidateBounds.width >
      search.container.x - PARTICIPANT_HEADER_WIDTH;

  return (search.requiresContainment && !fitsContainer) ||
    straddlesContainer ||
    straddlesProcessContainer ||
    violatesContainerBoundary ||
    overlapsParticipantHeader ||
    search.obstacleBounds.some(obstacle => {
      return rectanglesOverlap(candidateBounds, obstacle);
    }) ||
    search.occupiedBounds.some(occupied => {
      return rectanglesOverlap(candidateBounds, occupied);
    }) ||
    artifactIntersectsRoutes(candidate.rect, search.routeSegments);
}

function createCandidateScore(
    search,
    candidate,
    measures,
    associationLength,
    nonStraightPenalty,
    validity = {}) {
  const {
    alignedOwnerCount,
    associationBendCount,
    associationCrossingCount,
    congestionPenalty,
    congestionViolation,
    missesOwnerAlignment,
    participantInteriorPenalty,
    participantVerticalSidePenalty
  } = measures;

  return createArtifactPlacementScore({
    participantInteriorViolation:
      search.avoidParticipantInterior ? participantInteriorPenalty : 0,
    dataCrossings: search.dataArtifact ? associationCrossingCount : 0,
    congestionViolation,
    missesOwnerAlignment,
    alignedOwnerReward: -alignedOwnerCount,
    associationBends: associationBendCount,
    weightedLength: associationLength +
      congestionPenalty +
      nonStraightPenalty +
      participantInteriorPenalty * search.participantInteriorPreference +
      participantVerticalSidePenalty * 4 * VERTICAL_GAP,
    associationLength,
    annotationSize: is(search.artifact, 'bpmn:TextAnnotation')
      ? annotationSizePenalty(candidate.rect)
      : 0,
    annotationCrossings: search.dataArtifact ? 0 : associationCrossingCount,
    containmentViolation: !is(search.artifact, 'bpmn:TextAnnotation') && (
      (search.container && !validity.fitsContainer) ||
      (search.processContainer && !validity.fitsProcessContainer)
    ) ? 1 : 0,
    expansion: artifactExpansion(candidate.rect, search.extents),
    sideRank: candidate.sideRank,
    offset: Math.abs(candidate.offset),
    gap: candidate.gap,
    y: candidate.rect.y,
    x: candidate.rect.x
  });
}

function artifactFitsContainer(candidate, container, margin = ROUTING_MARGIN) {
  return !container ||
    candidate.x >= container.x + margin &&
    candidate.y >= container.y + margin &&
    candidate.x + candidate.width <=
      container.x + container.width - margin &&
    candidate.y + candidate.height <=
      container.y + container.height - margin;
}

function artifactObstacleBounds(rect) {
  return {
    x: rect.x - BOUNDARY_EVENT_ARTIFACT_CLEARANCE,
    y: rect.y - BOUNDARY_EVENT_ARTIFACT_CLEARANCE,
    width: rect.width + 2 * BOUNDARY_EVENT_ARTIFACT_CLEARANCE,
    height: rect.height + 2 * BOUNDARY_EVENT_ARTIFACT_CLEARANCE
  };
}

function artifactIntersectsRoutes(rect, routeSegments) {
  const clearance = {
    x: rect.x - ROUTING_MARGIN / 2,
    y: rect.y - ROUTING_MARGIN / 2,
    width: rect.width + ROUTING_MARGIN,
    height: rect.height + ROUTING_MARGIN
  };

  return routeSegments.some(([ start, end ]) => {
    return segmentEntersRect(start, end, clearance);
  });
}
