import { is } from '../../../di/DiUtil.js';
import { ROUTING_MARGIN } from '../../Constants.js';
import { translateLayout } from '../../geometry/index.js';

import type {
  BpmnElement,
  Bounds,
  FeedbackRegion,
  LayoutState,
  ProcessLayoutContext
} from '../../Types.js';
import type { ModdleElement } from 'moddle';
import type {
  BpmnFlowNode,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';
import {
  clonePlacementCandidate
} from './PlacementCandidate.js';
import type { PlacementCandidate } from './PlacementCandidate.js';

type FlowNode = ModdleElement<BpmnFlowNode>;
type ConnectedFlowNode = FlowNode & {
  incoming?: FlowEdge[];
};
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
};
type Movement = {
  dx: number;
  dy: number;
};
type AlignmentMove = {
  key: string;
  movements: Map<BpmnElement, Movement>;
};

export function createFeedbackMirrorCandidate(
    context: ProcessLayoutContext,
    candidate: PlacementCandidate,
    region: FeedbackRegion,
    moveKey: string
): PlacementCandidate | null {
  const split = candidate.layout.shapes.get(region.split);

  if (!split) {
    return null;
  }

  const next = clonePlacementCandidate(candidate, moveKey);
  const splitCenter = split.y + split.height / 2;
  const movements = new Map<BpmnElement, Movement>();

  for (const branch of region.branches) {
    const branchBounds = [ ...branch.nodes ]
      .map(element => candidate.layout.shapes.get(element))
      .filter((rect): rect is Bounds => !!rect);

    if (!branchBounds.length) {
      continue;
    }

    const branchCenter = branchBounds.reduce((total, rect) => {
      return total + rect.y + rect.height / 2;
    }, 0) / branchBounds.length;
    const dy = Math.round(2 * (splitCenter - branchCenter));

    if (!dy) {
      continue;
    }

    for (const element of branch.nodes) {
      const existing = movements.get(element);
      if (existing && existing.dy !== dy) {
        return null;
      }

      movements.set(element, { dx: 0, dy });
    }
  }

  return applyMovements(context, candidate, next, movements);
}

export function createFeedbackAlignmentCandidates(
    context: ProcessLayoutContext,
    candidate: PlacementCandidate,
    region: FeedbackRegion,
    moveKey: string
): PlacementCandidate[] {
  const candidates: PlacementCandidate[] = [];
  const alignmentMoves: AlignmentMove[] = [];
  const signatures = new Set<string>();
  const split = candidate.layout.shapes.get(region.split);

  region.branches.forEach((branch, branchIndex) => {
    const entry = candidate.layout.shapes.get(branch.entry);

    if (split && entry) {
      const dx = Math.round(
        split.x + split.width / 2 - entry.x - entry.width / 2
      );
      const dy = Math.round(
        split.y + split.height / 2 - entry.y - entry.height / 2
      );

      [
        [ 'entry-rank', { dx, dy: 0 } ],
        [ 'entry-band', { dx: 0, dy } ]
      ].forEach(([ type, movement ]) => {
        const typedMovement = movement as Movement;
        const movements = createMovementMap(
          [ branch.entry ],
          typedMovement
        );

        if (movements.size) {
          alignmentMoves.push({
            key: `branch-${ branchIndex }-${ type }`,
            movements
          });
        }
      });

      if (
        entry.y < split.y + split.height &&
        entry.y + entry.height > split.y
      ) {
        const clearOffsets = [
          split.y - ROUTING_MARGIN - entry.height - entry.y,
          split.y + split.height + ROUTING_MARGIN - entry.y
        ];

        clearOffsets.forEach((clearDy, sideIndex) => {
          alignmentMoves.push({
            key: `branch-${ branchIndex }-entry-rank-clear-${ sideIndex }`,
            movements: createMovementMap(
              [ branch.entry ],
              { dx, dy: Math.round(clearDy) }
            )
          });
        });
      }
    }

    [ ...branch.returnEdges ].forEach((element, returnIndex) => {
      if (!is(element, 'bpmn:SequenceFlow')) {
        return;
      }

      const edge = element as FlowEdge;
      const source = candidate.layout.shapes.get(edge.sourceRef);
      const target = candidate.layout.shapes.get(edge.targetRef);

      if (!source || !target) {
        return;
      }

      const alignment = {
        dx: Math.round(
          target.x + target.width / 2 - source.x - source.width / 2
        ),
        dy: Math.round(
          target.y + target.height / 2 - source.y - source.height / 2
        )
      };
      const movements = [
        [ 'source-rank', [ edge.sourceRef ], { dx: alignment.dx, dy: 0 } ],
        [ 'source-band', [ edge.sourceRef ], { dx: 0, dy: alignment.dy } ],
        [ 'branch-rank', [ ...branch.nodes ], { dx: alignment.dx, dy: 0 } ],
        [ 'branch-band', [ ...branch.nodes ], { dx: 0, dy: alignment.dy } ]
      ] as const;

      for (const [ type, elements, movement ] of movements) {
        const movementMap = createMovementMap(elements, movement);
        const signature = movementSignature(movementMap);

        if (!movementMap.size || signatures.has(signature)) {
          continue;
        }

        signatures.add(signature);
        alignmentMoves.push({
          key: `branch-${ branchIndex }-return-${ returnIndex }-${ edge.id }-${ type }`,
          movements: movementMap
        });
      }

      alignmentMoves.push(...createAlignedArmMoves(
        candidate,
        edge,
        alignment.dx,
        branchIndex,
        returnIndex
      ));
      alignmentMoves.push(...createAlignedCorridorMoves(
        candidate,
        edge,
        branch.nodes,
        branchIndex,
        returnIndex
      ));
    });
  });

  const combinedMoves = [
    ...alignmentMoves.filter(move => !isSupportMove(move)),
    ...createPairwiseAlignmentMoves(alignmentMoves)
  ];

  for (const move of combinedMoves) {
    const next = clonePlacementCandidate(
      candidate,
      `${ moveKey }/${ move.key }`
    );
    const moved = applyMovements(
      context,
      candidate,
      next,
      move.movements
    );

    if (moved && preservesRegionSides(candidate, moved, region)) {
      candidates.push(moved);
    }
  }

  return candidates;
}

function preservesRegionSides(
    candidate: PlacementCandidate,
    moved: PlacementCandidate,
    region: FeedbackRegion
): boolean {
  const split = candidate.layout.shapes.get(region.split);

  if (!split) {
    return false;
  }

  const splitCenterY = split.y + split.height / 2;

  for (const [ element, original ] of candidate.layout.shapes) {
    const next = moved.layout.shapes.get(element);

    if (!next || original.x === next.x && original.y === next.y) {
      continue;
    }

    const originalSide = Math.sign(
      original.y + original.height / 2 - splitCenterY
    );
    const nextSide = Math.sign(
      next.y + next.height / 2 - splitCenterY
    );

    if (originalSide && originalSide !== nextSide) {
      return false;
    }
  }

  return true;
}

export function flattenFeedbackRegions(
    regions: FeedbackRegion[]
): FeedbackRegion[] {
  return regions.flatMap(region => [
    region,
    ...flattenFeedbackRegions(region.children)
  ]);
}

function includeAttachedBoundaryEvents(
    layout: LayoutState,
    movements: Map<BpmnElement, Movement>
): void {
  for (const element of layout.shapes.keys()) {
    if (!is(element, 'bpmn:BoundaryEvent')) {
      continue;
    }

    const host = element.attachedToRef;

    if (!host) {
      continue;
    }

    const movement = movements.get(host);

    if (movement) {
      movements.set(element, movement);
    }
  }
}

function fitsOriginalContainers(
    layout: LayoutState,
    movements: Map<BpmnElement, Movement>
): boolean {
  const containers = [ ...layout.shapes ]
    .filter(([ element ]) => {
      return is(element, 'bpmn:Lane') || is(element, 'bpmn:Participant');
    })
    .map(([ , rect ]) => rect);

  for (const [ element, { dx, dy } ] of movements) {
    const rect = layout.shapes.get(element);

    if (!rect) {
      continue;
    }

    const memberships = containers.filter(container => {
      return containsCenter(container, rect);
    });
    const moved = {
      ...rect,
      x: rect.x + dx,
      y: rect.y + dy
    };

    if (memberships.some(container => !containsRect(container, moved))) {
      return false;
    }
  }

  return true;
}

function translateExpandedChild(
    context: ProcessLayoutContext,
    layout: LayoutState,
    element: BpmnElement,
    dx: number,
    dy: number
): void {
  const childScope = context.placement.recordsByElement.get(element)?.child?.scope;

  if (!childScope) {
    return;
  }

  const child = findChildLayout(layout, childScope);

  if (child) {
    translateLayout(child, dx, dy);
  }
}

function applyMovements(
    context: ProcessLayoutContext,
    candidate: PlacementCandidate,
    next: PlacementCandidate,
    movements: Map<BpmnElement, Movement>
): PlacementCandidate | null {
  if (!movements.size) {
    return null;
  }

  includeAttachedBoundaryEvents(candidate.layout, movements);

  if (!fitsOriginalContainers(candidate.layout, movements)) {
    return null;
  }

  for (const [ element, { dx, dy } ] of movements) {
    const rect = next.layout.shapes.get(element);

    if (!rect) {
      continue;
    }

    rect.x += dx;
    rect.y += dy;
    next.displacement += Math.abs(dx) + Math.abs(dy);
    translateExpandedChild(context, next.layout, element, dx, dy);
  }

  return next;
}

function createMovementMap(
    elements: readonly BpmnElement[],
    movement: Movement
): Map<BpmnElement, Movement> {
  if (!movement.dx && !movement.dy) {
    return new Map();
  }

  return new Map(elements.map(element => [ element, movement ]));
}

function movementSignature(movements: Map<BpmnElement, Movement>): string {
  return [ ...movements ]
    .map(([ element, { dx, dy } ]) => `${ element.id }:${ dx }:${ dy }`)
    .sort()
    .join('|');
}

function createPairwiseAlignmentMoves(
    moves: AlignmentMove[]
): AlignmentMove[] {
  const pairs: AlignmentMove[] = [];

  for (let first = 0; first < moves.length; first++) {
    for (let second = first + 1; second < moves.length; second++) {
      if (isSupportMove(moves[first]) && isSupportMove(moves[second])) {
        continue;
      }

      const movements = mergeMovements(
        moves[first].movements,
        moves[second].movements
      );

      if (!movements) {
        continue;
      }

      pairs.push({
        key: `${ moves[first].key }+${ moves[second].key }`,
        movements
      });
    }
  }

  return pairs.slice(0, 4);
}

function isSupportMove(move: AlignmentMove): boolean {
  return move.key.includes('entry-rank-clear-');
}

function createAlignedArmMoves(
    candidate: PlacementCandidate,
    edge: FlowEdge,
    dx: number,
    branchIndex: number,
    returnIndex: number
): AlignmentMove[] {
  if (!dx) {
    return [];
  }

  const source = candidate.layout.shapes.get(edge.sourceRef);
  const target = candidate.layout.shapes.get(edge.targetRef);

  if (!source || !target) {
    return [];
  }

  const sourceCenterY = source.y + source.height / 2;
  const alignedSourceCenterX = target.x + target.width / 2;
  const predecessors = ((edge.sourceRef as ConnectedFlowNode).incoming || [])
    .map(incoming => incoming.sourceRef)
    .filter((element): element is FlowNode => {
      return !!element && element !== edge.targetRef;
    });
  const moves: AlignmentMove[] = [];

  for (const predecessor of predecessors) {
    const predecessorBounds = candidate.layout.shapes.get(predecessor);

    if (!predecessorBounds) {
      continue;
    }

    const predecessorCenterX =
      predecessorBounds.x + predecessorBounds.width / 2;
    const minX = Math.min(alignedSourceCenterX, predecessorCenterX);
    const maxX = Math.max(alignedSourceCenterX, predecessorCenterX);
    const blockers = [ ...candidate.layout.shapes ]
      .filter(([ element, rect ]) => {
        return element !== edge.sourceRef &&
          element !== edge.targetRef &&
          element !== predecessor &&
          !is(element, 'bpmn:Lane') &&
          !is(element, 'bpmn:Participant') &&
          rect.x < maxX &&
          rect.x + rect.width > minX &&
          rect.y < sourceCenterY &&
          rect.y + rect.height > sourceCenterY;
      })
      .map(([ , rect ]) => rect);

    if (!blockers.length) {
      continue;
    }

    const halfHeight = Math.max(
      source.height / 2,
      predecessorBounds.height / 2
    );
    const rowCenters = [
      Math.min(...blockers.map(rect => rect.y)) -
        ROUTING_MARGIN - halfHeight,
      Math.max(...blockers.map(rect => rect.y + rect.height)) +
        ROUTING_MARGIN + halfHeight
    ];

    rowCenters.forEach((rowCenter, sideIndex) => {
      const dy = Math.round(rowCenter - sourceCenterY);
      const movements = new Map<BpmnElement, Movement>([
        [ edge.sourceRef, { dx, dy } ],
        [ predecessor, { dx: 0, dy } ]
      ]);

      moves.push({
        key: `branch-${ branchIndex }-return-${ returnIndex }-${ edge.id }-aligned-arm-${ sideIndex }`,
        movements
      });
    });
  }

  return moves;
}

function createAlignedCorridorMoves(
    candidate: PlacementCandidate,
    edge: FlowEdge,
    branchNodes: Set<BpmnElement>,
    branchIndex: number,
    returnIndex: number
): AlignmentMove[] {
  const source = candidate.layout.shapes.get(edge.sourceRef);
  const target = candidate.layout.shapes.get(edge.targetRef);

  if (!source || !target) {
    return [];
  }

  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const horizontal = sourceCenterY === targetCenterY;
  const vertical = sourceCenterX === targetCenterX;

  if (!horizontal && !vertical) {
    return [];
  }

  const min = horizontal
    ? Math.min(sourceCenterX, targetCenterX)
    : Math.min(sourceCenterY, targetCenterY);
  const max = horizontal
    ? Math.max(sourceCenterX, targetCenterX)
    : Math.max(sourceCenterY, targetCenterY);
  const blockers = [ ...branchNodes ]
    .filter(element => {
      return element !== edge.sourceRef && element !== edge.targetRef;
    })
    .map(element => ({
      element,
      rect: candidate.layout.shapes.get(element)
    }))
    .filter((entry): entry is { element: BpmnElement; rect: Bounds } => {
      if (!entry.rect) {
        return false;
      }

      return horizontal
        ? entry.rect.x < max &&
          entry.rect.x + entry.rect.width > min &&
          entry.rect.y < sourceCenterY &&
          entry.rect.y + entry.rect.height > sourceCenterY
        : entry.rect.y < max &&
          entry.rect.y + entry.rect.height > min &&
          entry.rect.x < sourceCenterX &&
          entry.rect.x + entry.rect.width > sourceCenterX;
    });

  if (!blockers.length) {
    return [];
  }

  const offsets = horizontal
    ? [
      sourceCenterY - ROUTING_MARGIN -
        Math.max(...blockers.map(({ rect }) => rect.y + rect.height)),
      sourceCenterY + ROUTING_MARGIN -
        Math.min(...blockers.map(({ rect }) => rect.y))
    ].map(dy => ({ dx: 0, dy: Math.round(dy) }))
    : [
      sourceCenterX - ROUTING_MARGIN -
        Math.max(...blockers.map(({ rect }) => rect.x + rect.width)),
      sourceCenterX + ROUTING_MARGIN -
        Math.min(...blockers.map(({ rect }) => rect.x))
    ].map(dx => ({ dx: Math.round(dx), dy: 0 }));

  return offsets.map((movement, sideIndex) => ({
    key: `branch-${ branchIndex }-return-${ returnIndex }-${ edge.id }-aligned-corridor-${ sideIndex }`,
    movements: new Map(blockers.map(({ element }) => [ element, movement ]))
  }));
}

function mergeMovements(
    first: Map<BpmnElement, Movement>,
    second: Map<BpmnElement, Movement>
): Map<BpmnElement, Movement> | null {
  const merged = new Map(first);

  for (const [ element, movement ] of second) {
    const existing = merged.get(element);

    if (
      existing &&
      (existing.dx !== movement.dx || existing.dy !== movement.dy)
    ) {
      return null;
    }

    merged.set(element, movement);
  }

  return merged;
}

function findChildLayout(
    layout: LayoutState,
    scope: BpmnElement
): LayoutState | null {
  for (const child of layout.children) {
    if (child.scope === scope) {
      return child;
    }

    const nested = findChildLayout(child, scope);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function containsCenter(container: Bounds, rect: Bounds): boolean {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;

  return x >= container.x && x <= container.x + container.width &&
    y >= container.y && y <= container.y + container.height;
}

function containsRect(container: Bounds, rect: Bounds): boolean {
  return rect.x >= container.x &&
    rect.y >= container.y &&
    rect.x + rect.width <= container.x + container.width &&
    rect.y + rect.height <= container.y + container.height;
}
