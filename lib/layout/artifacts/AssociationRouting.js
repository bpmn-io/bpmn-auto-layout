import { is } from '../../di/DiUtil.js';
import { ROUTING_MARGIN } from '../Constants.js';
import {
  compareScores,
  point,
  routeLength,
  segmentEntersRect,
  segmentsProperlyCross,
  toSegments
} from '../geometry/index.js';
import {
  createBpmnOrthogonalRouter
} from '../routing/BpmnOrthogonalRouting.js';

const ASSOCIATION_OBSTACLE_CLEARANCE = 1;

export function artifactAssociationConnection(
    association,
    owner,
    ownerBounds,
    artifact,
    artifactBounds,
    connectionIndex = 0,
    connectionCount = 1,
    obstacles = [],
    routeSegments = []) {
  const artifactIsSource = is(association, 'bpmn:DataInputAssociation') ||
    association.sourceRef === artifact ||
    (Array.isArray(association.sourceRef) && association.sourceRef.includes(artifact));
  const dataArtifact = is(artifact, 'bpmn:DataObjectReference') ||
    is(artifact, 'bpmn:DataStoreReference');

  if (dataArtifact) {
    const points = orthogonalAssociationRoute(
      owner,
      ownerBounds,
      artifact,
      artifactBounds,
      obstacles,
      routeSegments,
      connectionIndex,
      connectionCount
    );

    return artifactIsSource ? points : points.reverse();
  }

  let ownerPoint;
  let artifactPoint;

  if (artifactBounds.y + artifactBounds.height <= ownerBounds.y) {
    const offset = associationDockOffset(
      ownerBounds.width,
      artifactBounds.width,
      connectionIndex,
      connectionCount
    );
    ownerPoint = point(ownerBounds.x + ownerBounds.width / 2 + offset, ownerBounds.y);
    artifactPoint = point(
      artifactBounds.x + artifactBounds.width / 2 + offset,
      artifactBounds.y + artifactBounds.height
    );
  } else if (ownerBounds.y + ownerBounds.height <= artifactBounds.y) {
    const offset = associationDockOffset(
      ownerBounds.width,
      artifactBounds.width,
      connectionIndex,
      connectionCount
    );
    ownerPoint = point(
      ownerBounds.x + ownerBounds.width / 2 + offset,
      ownerBounds.y + ownerBounds.height
    );
    artifactPoint = point(
      artifactBounds.x + artifactBounds.width / 2 + offset,
      artifactBounds.y
    );
  } else if (artifactBounds.x + artifactBounds.width <= ownerBounds.x) {
    const offset = associationDockOffset(
      ownerBounds.height,
      artifactBounds.height,
      connectionIndex,
      connectionCount
    );
    ownerPoint = point(ownerBounds.x, ownerBounds.y + ownerBounds.height / 2 + offset);
    artifactPoint = point(
      artifactBounds.x + artifactBounds.width,
      artifactBounds.y + artifactBounds.height / 2 + offset
    );
  } else if (ownerBounds.x + ownerBounds.width <= artifactBounds.x) {
    const offset = associationDockOffset(
      ownerBounds.height,
      artifactBounds.height,
      connectionIndex,
      connectionCount
    );
    ownerPoint = point(
      ownerBounds.x + ownerBounds.width,
      ownerBounds.y + ownerBounds.height / 2 + offset
    );
    artifactPoint = point(
      artifactBounds.x,
      artifactBounds.y + artifactBounds.height / 2 + offset
    );
  } else {
    const artifactAbove = artifactBounds.y + artifactBounds.height / 2 <
      ownerBounds.y + ownerBounds.height / 2;
    const offset = associationDockOffset(
      ownerBounds.width,
      artifactBounds.width,
      connectionIndex,
      connectionCount
    );
    ownerPoint = point(
      ownerBounds.x + ownerBounds.width / 2 + offset,
      artifactAbove ? ownerBounds.y : ownerBounds.y + ownerBounds.height
    );
    artifactPoint = point(
      artifactBounds.x + artifactBounds.width / 2 + offset,
      artifactAbove ? artifactBounds.y + artifactBounds.height : artifactBounds.y
    );
  }

  return artifactIsSource
    ? [ artifactPoint, ownerPoint ]
    : [ ownerPoint, artifactPoint ];
}

function associationDockOffset(ownerSpan, artifactSpan, index, count) {
  if (count < 2) {
    return 0;
  }

  const span = Math.min(ownerSpan, artifactSpan);

  return (index + 1) * span / (count + 1) - span / 2;
}

function orthogonalAssociationRoute(
    owner,
    ownerBounds,
    artifact,
    artifactBounds,
    obstacles,
    routeSegments,
    connectionIndex,
    connectionCount) {
  const horizontal = horizontalAssociationDocks(
    artifactBounds,
    ownerBounds,
    connectionIndex,
    connectionCount
  );
  const vertical = verticalAssociationDocks(
    artifactBounds,
    ownerBounds,
    connectionIndex,
    connectionCount
  );
  const centeredIndex = connectionIndex - (connectionCount - 1) / 2;
  const channelOffset = centeredIndex * ROUTING_MARGIN;
  const candidates = [
    {
      points: [
        horizontal.artifact,
        point(vertical.owner.x, horizontal.artifact.y),
        vertical.owner
      ],
      artifactAxis: 'horizontal',
      ownerAxis: 'vertical'
    },
    {
      points: [
        vertical.artifact,
        point(vertical.artifact.x, horizontal.owner.y),
        horizontal.owner
      ],
      artifactAxis: 'vertical',
      ownerAxis: 'horizontal'
    },
    {
      points: [
        horizontal.artifact,
        point(
          (horizontal.artifact.x + horizontal.owner.x) / 2 + channelOffset,
          horizontal.artifact.y
        ),
        point(
          (horizontal.artifact.x + horizontal.owner.x) / 2 + channelOffset,
          horizontal.owner.y
        ),
        horizontal.owner
      ],
      artifactAxis: 'horizontal',
      ownerAxis: 'horizontal'
    },
    {
      points: [
        vertical.artifact,
        point(
          vertical.artifact.x,
          (vertical.artifact.y + vertical.owner.y) / 2 + channelOffset
        ),
        point(
          vertical.owner.x,
          (vertical.artifact.y + vertical.owner.y) / 2 + channelOffset
        ),
        vertical.owner
      ],
      artifactAxis: 'vertical',
      ownerAxis: 'vertical'
    }
  ].map(candidate => ({
    ...candidate,
    points: simplifyOrthogonalRoute(candidate.points)
  })).filter(({ points, artifactAxis, ownerAxis }) => {
    return routeHasDockDirections(points, artifactAxis, ownerAxis);
  });
  const router = createBpmnOrthogonalRouter({
    shapes: obstacles,
    sourceElement: owner,
    targetElement: artifact,
    obstacleInset: -ASSOCIATION_OBSTACLE_CLEARANCE
  });

  return candidates.map(({ points }, index) => {
    const clear = routeAvoidsEndpointInteriors(
      points,
      artifactBounds,
      ownerBounds
    ) && router.isClear(points);

    return {
      points,
      score: [
        clear ? 0 : 1,
        routeCrossings(points, routeSegments),
        points.length - 2,
        index,
        routeLength(points)
      ]
    };
  }).sort((a, b) => compareScores(a.score, b.score))[0].points;
}

function routeAvoidsEndpointInteriors(points, artifactBounds, ownerBounds) {
  return toSegments(points).every(([ start, end ]) => {
    return !segmentEntersRect(start, end, artifactBounds) &&
      !segmentEntersRect(start, end, ownerBounds);
  });
}

function routeHasDockDirections(points, artifactAxis, ownerAxis) {
  const first = points[0];
  const second = points[1];
  const penultimate = points.at(-2);
  const last = points.at(-1);
  const firstAxis = first.y === second.y ? 'horizontal' : 'vertical';
  const lastAxis = penultimate.y === last.y ? 'horizontal' : 'vertical';

  return firstAxis === artifactAxis && lastAxis === ownerAxis;
}

function horizontalAssociationDocks(
    artifactBounds,
    ownerBounds,
    connectionIndex,
    connectionCount) {
  const artifactLeft = artifactBounds.x + artifactBounds.width / 2 <
    ownerBounds.x + ownerBounds.width / 2;
  const offset = associationDockOffset(
    ownerBounds.height,
    artifactBounds.height,
    connectionIndex,
    connectionCount
  );

  return {
    artifact: point(
      artifactLeft
        ? artifactBounds.x + artifactBounds.width
        : artifactBounds.x,
      artifactBounds.y + artifactBounds.height / 2 + offset
    ),
    owner: point(
      artifactLeft
        ? ownerBounds.x
        : ownerBounds.x + ownerBounds.width,
      ownerBounds.y + ownerBounds.height / 2 + offset
    )
  };
}

function verticalAssociationDocks(
    artifactBounds,
    ownerBounds,
    connectionIndex,
    connectionCount) {
  const artifactAbove = artifactBounds.y + artifactBounds.height / 2 <
    ownerBounds.y + ownerBounds.height / 2;
  const offset = associationDockOffset(
    ownerBounds.width,
    artifactBounds.width,
    connectionIndex,
    connectionCount
  );

  return {
    artifact: point(
      artifactBounds.x + artifactBounds.width / 2 + offset,
      artifactAbove
        ? artifactBounds.y + artifactBounds.height
        : artifactBounds.y
    ),
    owner: point(
      ownerBounds.x + ownerBounds.width / 2 + offset,
      artifactAbove
        ? ownerBounds.y
        : ownerBounds.y + ownerBounds.height
    )
  };
}

function simplifyOrthogonalRoute(points) {
  const deduplicated = points.filter((candidate, index) => {
    const previous = points[index - 1];

    return !previous ||
      candidate.x !== previous.x ||
      candidate.y !== previous.y;
  });

  return deduplicated.filter((candidate, index) => {
    const previous = deduplicated[index - 1];
    const next = deduplicated[index + 1];

    return !previous || !next || !(
      (previous.x === candidate.x && candidate.x === next.x) ||
      (previous.y === candidate.y && candidate.y === next.y)
    );
  });
}

export function routeCrossings(points, routeSegments) {
  return toSegments(points).reduce((total, [ start, end ]) => {
    return total + routeSegments.filter(([ a, b ]) => {
      return segmentsProperlyCross(start, end, a, b);
    }).length;
  }, 0);
}

export function routePlacedArtifactAssociations(context) {
  const {
    artifactRecords,
    graphRoutes,
    graphShapes,
    layout,
    obstaclesByArtifact,
    owners
  } = context;

  for (const record of artifactRecords) {
    const artifactBounds = layout.shapes.get(record.element);
    const references = owners.get(record.element) || [];

    for (const {
      association,
      owner,
      ownerConnectionIndex,
      ownerConnectionCount
    } of references) {
      layout.edges.set(association, routeArtifactAssociation(
        association,
        owner,
        graphShapes.get(owner),
        record.element,
        artifactBounds,
        ownerConnectionIndex,
        ownerConnectionCount,
        obstaclesByArtifact.get(record.element),
        graphRoutes
      ));
    }
  }
}

function routeArtifactAssociation(
    association,
    owner,
    ownerBounds,
    artifact,
    artifactBounds,
    connectionIndex,
    connectionCount,
    obstacles = [],
    routes = []) {
  return artifactAssociationConnection(
    association,
    owner,
    ownerBounds,
    artifact,
    artifactBounds,
    connectionIndex,
    connectionCount,
    obstacles,
    routes.flatMap(route => toSegments(route.points))
  );
}
