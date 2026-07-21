import { LayoutWarning } from '../LayoutWarning.js';
import { GROUP_PADDING } from './Constants.js';
import {
  bounds,
  getExpandedChildEdges,
  getExpandedChildShapes
} from './LayoutUtil.js';

export function layoutGroups(groups, layout) {
  const warnings = [];
  const shapes = [
    ...layout.shapes.entries(),
    ...getExpandedChildShapes(layout)
  ];
  const edges = [
    ...layout.edges.entries(),
    ...getExpandedChildEdges(layout)
  ];

  for (const group of groups) {
    const categoryValue = group.categoryValueRef;
    const memberShapes = shapes.filter(([ element ]) => {
      return referencesCategoryValue(element, categoryValue);
    });
    const memberEdges = edges.filter(([ element ]) => {
      return referencesCategoryValue(element, categoryValue);
    });
    const points = [
      ...memberShapes.flatMap(([ , rect ]) => [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height }
      ]),
      ...memberEdges.flatMap(([ , waypoints ]) => waypoints)
    ];

    if (!points.length) {
      warnings.push(new LayoutWarning(
        'GROUP_MEMBERS_NOT_FOUND',
        group.id,
        `Group ${ group.id } has no visible explicitly referenced members and was omitted.`
      ));
      continue;
    }

    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));

    layout.shapes.set(group, bounds(
      minX - GROUP_PADDING,
      minY - GROUP_PADDING,
      maxX - minX + 2 * GROUP_PADDING,
      maxY - minY + 2 * GROUP_PADDING
    ));
  }

  return warnings;
}

function referencesCategoryValue(element, categoryValue) {
  if (!categoryValue) {
    return false;
  }

  const references = Array.isArray(element.categoryValueRef)
    ? element.categoryValueRef
    : [];

  return references.some(reference => {
    return reference === categoryValue ||
      reference.id === categoryValue.id;
  });
}
