import { is } from '../../di/DiUtil.js';
import { MAX_ARTIFACT_SEARCH_OFFSET } from '../Constants.js';
import { getExpandedChildEdges } from '../geometry/index.js';

import type {
  BpmnElement,
  Bounds,
  LayoutState,
  Waypoint
} from '../Types.js';

type ArtifactRoute = {
  element: BpmnElement;
  points: Waypoint[];
};

export function collectArtifactObstacleRoutes(
    layout: LayoutState,
    annotatedMessageEndpoints: Map<BpmnElement, Set<string>>,
    graphShapes: Map<BpmnElement, Bounds>
): ArtifactRoute[] {
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
    ].filter((route): route is ArtifactRoute => !!route);
  });

  return [ ...routes, ...reservedRoutes ];
}
