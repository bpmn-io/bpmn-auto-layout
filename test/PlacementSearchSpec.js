import assert from 'node:assert';

import {
  findArtifactPlacement
} from '../lib/layout/artifacts/PlacementSearch.js';

describe('PlacementSearch', function() {

  it('should select the best valid artifact candidate', function() {
    const artifact = element('Annotation', 'bpmn:TextAnnotation');
    const problem = placementProblem(artifact);

    assert.deepStrictEqual(findArtifactPlacement(problem), {
      x: 0,
      y: -60,
      width: 100,
      height: 40
    });

    problem.obstacles.push({
      element: element('Obstacle', 'bpmn:Task'),
      rect: { x: 0, y: -60, width: 100, height: 40 }
    });

    assert.deepStrictEqual(findArtifactPlacement(problem), {
      x: 0,
      y: 100,
      width: 100,
      height: 40
    });
  });
});

function placementProblem(artifact) {
  return {
    artifact,
    ownerBounds: null,
    references: [],
    sizes: [ { width: 100, height: 40 } ],
    obstacles: [],
    routes: [],
    occupied: [],
    container: null,
    processContainer: null,
    extents: {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 80,
      width: 100,
      height: 80
    },
    annotationClearance: 0,
    boundaryContainers: [],
    avoidParticipantInterior: false,
    preferParticipantSides: true,
    participantInteriorPreference: 0
  };
}

function element(id, type) {
  return {
    id,
    $instanceOf(candidate) {
      return candidate === type;
    }
  };
}
