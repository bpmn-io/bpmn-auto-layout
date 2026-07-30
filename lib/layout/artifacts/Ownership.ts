import { is } from '../../di/DiUtil.js';
import { isBpmnElement } from '../bpmn/Types.js';

import type { BpmnElementFor } from '../bpmn/Types.js';
import type {
  BpmnElement,
  Bounds,
  LayoutRecord
} from '../Types.js';

type ArtifactAssociation =
  | BpmnElementFor<'bpmn:Association'>
  | BpmnElementFor<'bpmn:DataAssociation'>;

type ArtifactOwnerReference = {
  association: ArtifactAssociation;
  owner: BpmnElement;
  ownerBounds: Bounds | undefined;
  ownerConnectionIndex?: number;
  ownerConnectionCount?: number;
};

type ArtifactOwnershipContext = {
  artifactRecords: LayoutRecord[];
  associations: ArtifactAssociation[];
  graphElements: Set<BpmnElement>;
  graphShapes: Map<BpmnElement, Bounds>;
  owners: Map<BpmnElement, ArtifactOwnerReference[]>;
};

export function discoverArtifactOwnership(
    context: ArtifactOwnershipContext
): void {
  const {
    artifactRecords,
    associations,
    graphElements,
    graphShapes,
    owners
  } = context;

  for (const association of associations) {
    const endpoints = associationEndpoints(association);
    const artifact = endpoints.find(endpoint => {
      return artifactRecords.some(record => record.element === endpoint);
    });
    const candidateOwner = is(association, 'bpmn:DataAssociation')
      ? association.$parent
      : endpoints.find(endpoint => {
        return endpoint !== artifact && graphElements.has(endpoint);
      });
    const owner = isBpmnElement(candidateOwner)
      ? candidateOwner
      : undefined;

    if (!artifact || !owner || !graphElements.has(owner)) {
      continue;
    }

    const references = owners.get(artifact);

    if (references) {
      references.push({
        association,
        owner,
        ownerBounds: graphShapes.get(owner)
      });
    } else {
      owners.set(artifact, [ {
        association,
        owner,
        ownerBounds: graphShapes.get(owner)
      } ]);
    }
  }

  for (const references of owners.values()) {
    assignOwnerConnectionSlots(references);
  }
}

function associationEndpoints(association: ArtifactAssociation): BpmnElement[] {
  return [
    ...(Array.isArray(association.sourceRef)
      ? association.sourceRef
      : [ association.sourceRef ]),
    association.targetRef
  ].filter(isBpmnElement);
}

function assignOwnerConnectionSlots(
    references: ArtifactOwnerReference[]
): void {
  const counts = new Map<BpmnElement, number>();
  const indices = new Map<BpmnElement, number>();

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

export function findContainingArtifactContainers(
    elementBounds: Bounds,
    shapes: Map<BpmnElement, Bounds>
): Bounds[] {
  const center = {
    x: elementBounds.x + elementBounds.width / 2,
    y: elementBounds.y + elementBounds.height / 2
  };

  return [ ...shapes.entries() ]
    .filter(([ element, rect ]) => {
      return (
        is(element, 'bpmn:Lane') ||
        is(element, 'bpmn:Participant') ||
        is(element, 'bpmn:SubProcess')
      ) &&
      center.x >= rect.x &&
      center.x <= rect.x + rect.width &&
      center.y >= rect.y &&
      center.y <= rect.y + rect.height;
    })
    .map(([ , rect ]) => rect)
    .sort((a, b) => a.width * a.height - b.width * b.height);
}
