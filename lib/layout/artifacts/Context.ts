import { is } from '../../di/DiUtil.js';
import { isArtifact } from '../bpmn/Predicates.js';
import {
  getExpandedChildShapes,
  getShapeExtents
} from '../geometry/index.js';
import { collectArtifactObstacleRoutes } from './ObstacleRoutes.js';
import { isBpmnElement } from '../bpmn/Types.js';

import type {
  BpmnElementFor
} from '../bpmn/Types.js';
import type {
  BpmnElement,
  Bounds,
  LayoutRecord,
  LayoutState,
  Waypoint
} from '../Types.js';
import type { Extents } from '../geometry/Geometry.js';

type ArtifactAssociation =
  | BpmnElementFor<'bpmn:Association'>
  | BpmnElementFor<'bpmn:DataAssociation'>;

type ArtifactObstacle = {
  element: BpmnElement;
  rect: Bounds;
};

type ArtifactRoute = {
  element: BpmnElement;
  points: Waypoint[];
};

type ArtifactPlacement = {
  element: BpmnElement;
  rect: Bounds;
  annotationClearance: number;
};

type ArtifactOwnerReference = {
  association: ArtifactAssociation;
  owner: BpmnElement;
  ownerBounds: Bounds | undefined;
  ownerConnectionIndex?: number;
  ownerConnectionCount?: number;
};

type BoundaryContainer = {
  rect: Bounds;
  containsOwner: boolean;
  participant: boolean;
};

type ArtifactLayoutContextOptions = {
  records: LayoutRecord[];
  associations: ArtifactAssociation[];
  layout: LayoutState;
  additionalBoundaryContainers?: BoundaryContainer[];
  reservedVerticalEndpointDirections?: Map<BpmnElement, Set<string>>;
  avoidParticipantInterior?: boolean;
  preferParticipantSides?: boolean;
};

type ArtifactLayoutContext = {
  artifactRecords: LayoutRecord[];
  associations: ArtifactAssociation[];
  layout: LayoutState;
  additionalBoundaryContainers: BoundaryContainer[];
  reservedVerticalEndpointDirections: Map<BpmnElement, Set<string>>;
  avoidParticipantInterior: boolean;
  preferParticipantSides: boolean;
  graphShapes: Map<BpmnElement, Bounds>;
  graphElements: Set<BpmnElement>;
  graphObstacles: ArtifactObstacle[];
  graphExtents: Extents;
  placementExtents: Extents;
  graphRoutes: ArtifactRoute[];
  placedArtifacts: ArtifactPlacement[];
  owners: Map<BpmnElement, ArtifactOwnerReference[]>;
  obstaclesByArtifact: Map<BpmnElement, ArtifactObstacle[]>;
};

export function createArtifactLayoutContext({
  records,
  associations,
  layout,
  additionalBoundaryContainers = [],
  reservedVerticalEndpointDirections = new Map(),
  avoidParticipantInterior = false,
  preferParticipantSides = true
}: ArtifactLayoutContextOptions): ArtifactLayoutContext {
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
  const annotatedMessageEndpoints = new Map<BpmnElement, Set<string>>();

  for (const association of associations) {
    const endpoints = associationEndpoints(association);
    const annotation = endpoints.find(endpoint => {
      return currentArtifacts.has(endpoint) &&
        is(endpoint, 'bpmn:TextAnnotation');
    });
    const owner = endpoints.find(endpoint => endpoint !== annotation);

    const directions = owner
      ? reservedVerticalEndpointDirections.get(owner)
      : undefined;

    if (annotation && owner && directions) {
      annotatedMessageEndpoints.set(
        owner,
        directions
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

function associationEndpoints(association: ArtifactAssociation): BpmnElement[] {
  return [
    ...(Array.isArray(association.sourceRef)
      ? association.sourceRef
      : [ association.sourceRef ]),
    association.targetRef
  ].filter(isBpmnElement);
}
