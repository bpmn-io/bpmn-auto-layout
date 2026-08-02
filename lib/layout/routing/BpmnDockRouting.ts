import { ROUTING_MARGIN } from '../Constants.js';
import { point } from '../geometry/index.js';

import type { Point, Rect } from 'diagram-js/lib/util/Types.js';

export type DockSide = 'north' | 'east' | 'south' | 'west';

export type DockCandidate = {
  dock: Point;
  order: number;
  semanticPenalty: number;
  side: DockSide;
  stub: Point;
};

export type DockPair = {
  order: number;
  semanticPenalty: number;
  source: DockCandidate;
  target: DockCandidate;
};

type DockCandidateOptions = {
  allowedSides?: readonly DockSide[];
  preferredDock: Point;
  rect: Rect;
};

const DOCK_SIDE_ORDER: readonly DockSide[] = [
  'north',
  'east',
  'south',
  'west'
];

export function createDockCandidates({
  allowedSides = DOCK_SIDE_ORDER,
  preferredDock,
  rect
}: DockCandidateOptions): DockCandidate[] {
  const preferredSide = getDockSide(preferredDock, rect);
  const sides = new Set(allowedSides);

  if (!sides.has(preferredSide)) {
    throw new TypeError('preferred dock side must be allowed');
  }

  const candidates = [
    createDockCandidate(preferredDock, preferredSide, 0, rect),
    ...DOCK_SIDE_ORDER
      .filter(side => sides.has(side))
      .map(side => {
        const semanticPenalty = side === preferredSide
          ? 0
          : side === oppositeSide(preferredSide)
            ? 2
            : 1;

        return createDockCandidate(
          getSideCenter(rect, side),
          side,
          semanticPenalty,
          rect
        );
      })
  ].filter((candidate, index, all) => {
    return all.findIndex(other => {
      return other.dock.x === candidate.dock.x &&
        other.dock.y === candidate.dock.y;
    }) === index;
  });

  candidates.sort((a, b) => {
    return a.semanticPenalty - b.semanticPenalty ||
      a.order - b.order;
  });

  return candidates;
}

export function createDockPairs(
    sourceCandidates: DockCandidate[],
    targetCandidates: DockCandidate[]
): DockPair[] {
  const pairs = sourceCandidates.flatMap(source => {
    return targetCandidates.map(target => ({
      order: source.order * DOCK_SIDE_ORDER.length + target.order,
      semanticPenalty: source.semanticPenalty + target.semanticPenalty,
      source,
      target
    }));
  });

  pairs.sort((a, b) => {
    return a.semanticPenalty - b.semanticPenalty ||
      a.source.order - b.source.order ||
      a.target.order - b.target.order ||
      a.order - b.order;
  });

  return pairs;
}

function createDockCandidate(
    dock: Point,
    side: DockSide,
    semanticPenalty: number,
    rect: Rect
): DockCandidate {
  const order = DOCK_SIDE_ORDER.indexOf(side);
  const stub = side === 'north'
    ? point(dock.x, rect.y - ROUTING_MARGIN)
    : side === 'east'
      ? point(rect.x + rect.width + ROUTING_MARGIN, dock.y)
      : side === 'south'
        ? point(dock.x, rect.y + rect.height + ROUTING_MARGIN)
        : point(rect.x - ROUTING_MARGIN, dock.y);

  return {
    dock,
    order,
    semanticPenalty,
    side,
    stub
  };
}

export function getDockSide(dock: Point, rect: Rect): DockSide {
  if (dock.y === rect.y && dock.x >= rect.x && dock.x <= rect.x + rect.width) {
    return 'north';
  }

  if (
    dock.x === rect.x + rect.width &&
    dock.y >= rect.y &&
    dock.y <= rect.y + rect.height
  ) {
    return 'east';
  }

  if (
    dock.y === rect.y + rect.height &&
    dock.x >= rect.x &&
    dock.x <= rect.x + rect.width
  ) {
    return 'south';
  }

  if (dock.x === rect.x && dock.y >= rect.y && dock.y <= rect.y + rect.height) {
    return 'west';
  }

  throw new TypeError('preferred dock must lie on the rectangle boundary');
}

export function getSideCenter(rect: Rect, side: DockSide): Point {
  if (side === 'north') {
    return point(rect.x + rect.width / 2, rect.y);
  }

  if (side === 'east') {
    return point(rect.x + rect.width, rect.y + rect.height / 2);
  }

  if (side === 'south') {
    return point(rect.x + rect.width / 2, rect.y + rect.height);
  }

  return point(rect.x, rect.y + rect.height / 2);
}

function oppositeSide(side: DockSide): DockSide {
  return side === 'north'
    ? 'south'
    : side === 'east'
      ? 'west'
      : side === 'south'
        ? 'north'
        : 'east';
}
