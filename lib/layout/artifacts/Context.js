import { is } from '../../di/DiUtil.js';
import { isArtifact } from '../bpmn/Predicates.js';
import {
  getExpandedChildShapes,
  getShapeExtents
} from '../geometry/index.js';
import { collectArtifactObstacleRoutes } from './ObstacleRoutes.js';

export function createArtifactLayoutContext({
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

  return {
    artifactRecords,
    associations,
    layout,
    additionalBoundaryContainers,
    reservedVerticalEndpointDirections,
    avoidParticipantInterior,
    preferParticipantSides,
    graphShapes,
    graphElements,
    graphObstacles,
    graphExtents,
    placementExtents,
    graphRoutes,
    placedArtifacts,
    owners: new Map(),
    obstaclesByArtifact: new Map()
  };
}
