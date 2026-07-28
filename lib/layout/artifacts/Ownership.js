import { is } from '../../di/DiUtil.js';

export function discoverArtifactOwnership(context) {
  const {
    artifactRecords,
    associations,
    graphElements,
    graphShapes,
    owners
  } = context;

  for (const association of associations) {
    const endpoints = [
      ...(Array.isArray(association.sourceRef)
        ? association.sourceRef
        : [ association.sourceRef ]),
      association.targetRef
    ];
    const artifact = endpoints.find(endpoint => {
      return artifactRecords.some(record => record.element === endpoint);
    });
    const owner = is(association, 'bpmn:DataAssociation')
      ? association.$parent
      : endpoints.find(endpoint => {
        return endpoint !== artifact && graphElements.has(endpoint);
      });

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
    assignOwnerConnectionSlots(references);
  }
}

function assignOwnerConnectionSlots(references) {
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

export function findContainingArtifactContainers(elementBounds, shapes) {
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
