import { artifactSizeCandidates } from './PlacementCandidates.js';
import {
  createArtifactPlacementProblem,
  findArtifactPlacement
} from './PlacementSearch.js';

export function placeArtifactRecords(context) {
  const {
    artifactRecords,
    layout,
    obstaclesByArtifact,
    owners,
    placedArtifacts
  } = context;
  const orderedRecords = orderArtifactRecords(artifactRecords, owners);

  for (const record of orderedRecords) {
    const problem = createArtifactPlacementProblem(context, record);

    obstaclesByArtifact.set(record.element, problem.obstacles);
    const placement = findArtifactPlacement(problem);

    layout.shapes.set(record.element, placement);
    placedArtifacts.push({
      element: record.element,
      rect: placement,
      annotationClearance: problem.annotationClearance
    });
  }
}

function orderArtifactRecords(records, owners) {
  return records.sort((a, b) => {
    const aReferences = owners.get(a.element)?.length || 0;
    const bReferences = owners.get(b.element)?.length || 0;
    const aArea = artifactSizeCandidates(a.element)[0];
    const bArea = artifactSizeCandidates(b.element)[0];

    return bReferences - aReferences ||
      bArea.width * bArea.height - aArea.width * aArea.height ||
      a.index - b.index;
  });
}
