import { is } from '../../di/DiUtil.js';
import { MAX_ARTIFACT_SEARCH_OFFSET } from '../Constants.js';
import { getExpandedChildEdges } from '../geometry/index.js';

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
