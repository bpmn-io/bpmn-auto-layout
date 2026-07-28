import { is } from '../di/DiUtil.js';
import {
  EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE,
  MAX_ARTIFACT_SEARCH_OFFSET,
  SUB_PROCESS_PADDING,
  VERTICAL_GAP
} from './Constants.js';
import { isArtifact, isExteriorArtifact } from './BpmnUtil.js';
import {
  bounds,
  getExpandedChildEdges,
  getExpandedChildShapes,
  getShapeExtents
} from './LayoutUtil.js';
import {
  artifactSizeCandidates,
  findArtifactPlacement,
  findContainingArtifactContainers,
  routeArtifactAssociation
} from './ArtifactLayouter.js';

export function placeArtifacts({
  records,
  associations,
  layout,
  additionalBoundaryContainers = [],
  reservedVerticalEndpointDirections = new Map(),
  avoidParticipantInterior = false,
  preferParticipantSides = true
}) {
  const artifactRecords = records.filter(record => record.isArtifact);
  const graphShapes = new Map([
    ...layout.shapes,
    ...getExpandedChildShapes(layout)
  ]);
  const graphElements = new Set(graphShapes.keys());
  const owners = new Map();
  const graphObstacles = [ ...graphShapes.entries() ].filter(([ element ]) => {
    return !is(element, 'bpmn:Lane') &&
      !is(element, 'bpmn:Participant') &&
      !isArtifact(element);
  }).map(([ element, rect ]) => ({ element, rect }));
  const graphExtents = getShapeExtents(graphObstacles);
  const placementExtents = getShapeExtents([ ...graphShapes.entries() ]
    .filter(([ element ]) => !isArtifact(element))
    .map(([ element, rect ]) => ({ element, rect })));
  const currentArtifacts = new Set(artifactRecords.map(record => record.element));
  const annotatedMessageEndpoints = new Map();

  for (const association of associations) {
    const endpoints = [
      ...(Array.isArray(association.sourceRef)
        ? association.sourceRef
        : [ association.sourceRef ]),
      association.targetRef
    ];
    const annotation = endpoints.find(endpoint => {
      return currentArtifacts.has(endpoint) &&
        is(endpoint, 'bpmn:TextAnnotation');
    });
    const owner = endpoints.find(endpoint => endpoint !== annotation);

    if (annotation && reservedVerticalEndpointDirections.has(owner)) {
      annotatedMessageEndpoints.set(
        owner,
        reservedVerticalEndpointDirections.get(owner)
      );
    }
  }

  const graphRoutes = collectArtifactObstacleRoutes(
    layout,
    annotatedMessageEndpoints,
    graphShapes
  );
  const placedArtifacts = [ ...graphShapes.entries() ]
    .filter(([ element ]) => {
      return isArtifact(element) && !currentArtifacts.has(element);
    })
    .map(([ element, rect ]) => ({
      element,
      rect,
      annotationClearance: 0
    }));

  for (const association of associations) {
    const endpoints = [
      ...(Array.isArray(association.sourceRef) ? association.sourceRef : [ association.sourceRef ]),
      association.targetRef
    ];
    const artifact = endpoints.find(endpoint => artifactRecords.some(record => record.element === endpoint));
    const owner = is(association, 'bpmn:DataAssociation')
      ? association.$parent
      : endpoints.find(endpoint => endpoint !== artifact && graphElements.has(endpoint));

    if (!artifact || !owner || !graphElements.has(owner)) {
      continue;
    }

    if (!owners.has(artifact)) {
      owners.set(artifact, []);
    }

    owners.get(artifact).push({
      association,
      owner,
      ownerBounds: graphShapes.get(owner)
    });
  }

  for (const references of owners.values()) {
    const counts = new Map();
    const indices = new Map();

    for (const reference of references) {
      counts.set(reference.owner, (counts.get(reference.owner) || 0) + 1);
    }

    for (const reference of references) {
      const index = indices.get(reference.owner) || 0;

      reference.ownerConnectionIndex = index;
      reference.ownerConnectionCount = counts.get(reference.owner);
      indices.set(reference.owner, index + 1);
    }
  }

  artifactRecords.sort((a, b) => {
    const aReferences = owners.get(a.element)?.length || 0;
    const bReferences = owners.get(b.element)?.length || 0;
    const aArea = artifactSizeCandidates(a.element)[0];
    const bArea = artifactSizeCandidates(b.element)[0];

    return bReferences - aReferences ||
      bArea.width * bArea.height - aArea.width * aArea.height ||
      a.index - b.index;
  });

  for (const record of artifactRecords) {
    const references = owners.get(record.element) || [];
    const ownerBounds = references.length
      ? graphShapes.get(references[0].owner)
      : null;
    const owner = references[0]?.owner;
    const enclosingSubProcesses = ownerBounds
      ? [ ...graphShapes.entries() ].filter(([ element, rect ]) => {
        const centerX = ownerBounds.x + ownerBounds.width / 2;
        const centerY = ownerBounds.y + ownerBounds.height / 2;

        return element !== owner &&
          is(element, 'bpmn:SubProcess') &&
          centerX >= rect.x &&
          centerX <= rect.x + rect.width &&
          centerY >= rect.y &&
          centerY <= rect.y + rect.height;
      })
      : [];
    const subProcessContainer = enclosingSubProcesses
      .map(([ , rect ]) => rect)
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    const containingContainers = ownerBounds
      ? findContainingArtifactContainers(ownerBounds, graphShapes)
      : [];
    const container = containingContainers[0];
    const boundaryContainers = [
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
    const processContainer = subProcessContainer || (
      !container && isExteriorArtifact(record.element)
        ? bounds(
          graphExtents.minX - SUB_PROCESS_PADDING,
          graphExtents.minY - SUB_PROCESS_PADDING,
          graphExtents.width + 2 * SUB_PROCESS_PADDING,
          graphExtents.height + 2 * SUB_PROCESS_PADDING
        )
        : null
    );
    const annotationClearance = subProcessContainer &&
      is(record.element, 'bpmn:TextAnnotation')
      ? EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE
      : 0;
    const obstacles = graphObstacles.filter(({ element }) => {
      return !enclosingSubProcesses.some(([ subProcess ]) => subProcess === element);
    });
    record.associationObstacles = obstacles;
    const placement = findArtifactPlacement(
      record.element,
      {
        ownerBounds,
        references,
        sizes: artifactSizeCandidates(record.element),
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
          isExteriorArtifact(record.element) &&
          references.some(({ owner }) => {
            return reservedVerticalEndpointDirections.has(owner);
          })
        ) ? VERTICAL_GAP : 0
      }
    );

    record.size = { width: placement.width, height: placement.height };
    layout.shapes.set(record.element, placement);
    placedArtifacts.push({
      element: record.element,
      rect: placement,
      annotationClearance
    });
  }

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
        record.associationObstacles,
        graphRoutes
      ));
    }
  }
}

export function collectArtifactObstacleRoutes(
    layout,
    annotatedMessageEndpoints,
    graphShapes) {
  const routes = [
    ...layout.edges.entries(),
    ...getExpandedChildEdges(layout)
  ]
    .filter(([ element ]) => {
      return is(element, 'bpmn:SequenceFlow') || is(element, 'bpmn:MessageFlow');
    })
    .map(([ element, points ]) => ({ element, points }));
  const reservedRoutes = [ ...annotatedMessageEndpoints ].flatMap(([
    element,
    directions
  ]) => {
    const rect = graphShapes.get(element);

    if (!rect) {
      return [];
    }

    const centerX = rect.x + rect.width / 2;

    return [
      directions.has('incoming') && {
        element,
        points: [
          { x: centerX, y: rect.y },
          { x: centerX, y: rect.y - MAX_ARTIFACT_SEARCH_OFFSET }
        ]
      },
      directions.has('outgoing') && {
        element,
        points: [
          { x: centerX, y: rect.y + rect.height },
          {
            x: centerX,
            y: rect.y + rect.height + MAX_ARTIFACT_SEARCH_OFFSET
          }
        ]
      }
    ].filter(Boolean);
  });

  return [ ...routes, ...reservedRoutes ];
}
