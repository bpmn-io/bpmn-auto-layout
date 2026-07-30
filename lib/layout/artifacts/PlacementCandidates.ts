import { getDefaultSize, is } from '../../di/DiUtil.js';
import {
  ANNOTATION_ASPECT_RATIO_PENALTY_SCALE,
  ANNOTATION_CHARACTER_WIDTH,
  ANNOTATION_LINE_HEIGHT,
  ANNOTATION_MAX_WIDTH,
  ANNOTATION_MIN_HEIGHT,
  ANNOTATION_MIN_WIDTH,
  ANNOTATION_PADDING,
  ANNOTATION_TARGET_ASPECT_RATIO,
  ANNOTATION_WIDTH_STEP,
  MAX_ARTIFACT_GAP_STEPS,
  MAX_ARTIFACT_SEARCH_OFFSET,
  ROUTING_MARGIN,
  VERTICAL_GAP
} from '../Constants.js';
import { bounds } from '../geometry/index.js';

import type { ElementSize } from '../../di/DiUtil.js';
import type {
  BpmnElement,
  Bounds
} from '../Types.js';
import type { Extents } from '../geometry/Geometry.js';

type ArtifactPlacementCandidate = {
  rect: Bounds;
  sideRank: number;
  offset: number;
  gap: number;
};

type BoundaryContainer = {
  rect: Bounds;
  containsOwner: boolean;
  participant: boolean;
};

type ArtifactSide = 'above' | 'below' | 'left' | 'right';

export function artifactSizeCandidates(
    element: BpmnElement
): Array<ElementSize | null> {
  if (!is(element, 'bpmn:TextAnnotation')) {
    return [ getDefaultSize(element) ];
  }

  const text = element.text || '';
  const candidates = [];

  for (
    let width = ANNOTATION_MIN_WIDTH;
    width <= ANNOTATION_MAX_WIDTH;
    width += ANNOTATION_WIDTH_STEP
  ) {
    const lineCount = wrappedTextLineCount(text, width);
    const height = Math.max(
      ANNOTATION_MIN_HEIGHT,
      lineCount * ANNOTATION_LINE_HEIGHT + 2 * ANNOTATION_PADDING
    );

    candidates.push({ width, height });
  }

  return candidates.sort((a, b) => {
    return annotationSizePenalty(a) - annotationSizePenalty(b) ||
      a.width * a.height - b.width * b.height ||
      a.width - b.width;
  });
}

function wrappedTextLineCount(text: string, width: number): number {
  const capacity = Math.max(
    1,
    Math.floor((width - 2 * ANNOTATION_PADDING) / ANNOTATION_CHARACTER_WIDTH)
  );

  return String(text || '').split(/\r?\n/).reduce((total, paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);

    if (!words.length) {
      return total + 1;
    }

    let lines = 1;
    let lineLength = 0;

    for (const word of words) {
      const wordLength = word.length;

      if (!lineLength) {
        lines += Math.max(0, Math.ceil(wordLength / capacity) - 1);
        lineLength = wordLength % capacity || Math.min(wordLength, capacity);
      } else if (lineLength + 1 + wordLength <= capacity) {
        lineLength += 1 + wordLength;
      } else {
        lines += Math.max(1, Math.ceil(wordLength / capacity));
        lineLength = wordLength % capacity || Math.min(wordLength, capacity);
      }
    }

    return total + lines;
  }, 0);
}

export function annotationSizePenalty(size: ElementSize): number {
  return Math.round(
    Math.abs(size.width / size.height - ANNOTATION_TARGET_ASPECT_RATIO) *
    ANNOTATION_ASPECT_RATIO_PENALTY_SCALE
  );
}

export function createArtifactPlacementCandidates(
    artifact: BpmnElement,
    ownerBounds: Bounds | null,
    referenceOwnerBounds: Bounds[],
    sizes: ElementSize[],
    boundaryContainers: BoundaryContainer[],
    annotationClearance: number,
    extents: Extents
): ArtifactPlacementCandidate[] {
  const localCandidates = ownerBounds
    ? referenceOwnerBounds.flatMap(referenceBounds => {
      return ownedArtifactCandidates(artifact, referenceBounds, sizes);
    })
    : unownedArtifactCandidates(sizes, extents);

  return is(artifact, 'bpmn:TextAnnotation')
    ? [
      ...localCandidates,
      ...participantExteriorArtifactCandidates(
        sizes,
        ownerBounds,
        boundaryContainers,
        annotationClearance
      ),
      ...outerScopeArtifactCandidates(sizes, extents)
    ]
    : localCandidates;
}

function ownedArtifactCandidates(
    artifact: BpmnElement,
    owner: Bounds,
    sizes: ElementSize[]
): ArtifactPlacementCandidate[] {
  const candidates: ArtifactPlacementCandidate[] = [];
  const preferredSides: ArtifactSide[] = is(artifact, 'bpmn:DataObjectReference')
    ? [ 'below', 'right', 'left', 'above' ]
    : [ 'above', 'left', 'right', 'below' ];
  const offsets = [ 0 ];

  for (
    let distance = ROUTING_MARGIN;
    distance <= MAX_ARTIFACT_SEARCH_OFFSET;
    distance += ROUTING_MARGIN
  ) {
    offsets.push(distance, -distance);
  }

  for (const size of sizes) {
    for (let sideRank = 0; sideRank < preferredSides.length; sideRank++) {
      const side = preferredSides[sideRank];

      for (
        let gap = ROUTING_MARGIN;
        gap <= MAX_ARTIFACT_GAP_STEPS * ROUTING_MARGIN;
        gap += ROUTING_MARGIN
      ) {
        for (const offset of offsets) {
          candidates.push({
            rect: artifactBoundsAt(owner, size, side, gap, offset),
            sideRank,
            offset,
            gap
          });
        }
      }
    }
  }

  return candidates;
}

function artifactBoundsAt(
    owner: Bounds,
    size: ElementSize,
    side: ArtifactSide,
    gap: number,
    offset: number
): Bounds {
  if (side === 'above') {
    return bounds(
      owner.x + (owner.width - size.width) / 2 + offset,
      owner.y - gap - size.height,
      size.width,
      size.height
    );
  }
  if (side === 'below') {
    return bounds(
      owner.x + (owner.width - size.width) / 2 + offset,
      owner.y + owner.height + gap,
      size.width,
      size.height
    );
  }
  if (side === 'left') {
    return bounds(
      owner.x - gap - size.width,
      owner.y + (owner.height - size.height) / 2 + offset,
      size.width,
      size.height
    );
  }

  return bounds(
    owner.x + owner.width + gap,
    owner.y + (owner.height - size.height) / 2 + offset,
    size.width,
    size.height
  );
}

export function artifactClearanceBounds(
    artifact: BpmnElement,
    rect: Bounds,
    clearance: number
): Bounds {
  if (!clearance || !is(artifact, 'bpmn:TextAnnotation')) {
    return rect;
  }

  return bounds(
    rect.x - clearance,
    rect.y - clearance,
    rect.width + 2 * clearance,
    rect.height + 2 * clearance
  );
}

function unownedArtifactCandidates(
    sizes: ElementSize[],
    extents: Extents
): ArtifactPlacementCandidate[] {
  const candidates: ArtifactPlacementCandidate[] = [];

  for (const size of sizes) {
    for (
      let offset = 0;
      offset <= extents.width + size.width;
      offset += ROUTING_MARGIN
    ) {
      candidates.push({
        rect: bounds(
          extents.minX + offset,
          extents.minY - VERTICAL_GAP - size.height,
          size.width,
          size.height
        ),
        sideRank: 0,
        offset,
        gap: VERTICAL_GAP
      });
    }
  }

  return candidates;
}

function participantExteriorArtifactCandidates(
    sizes: ElementSize[],
    ownerBounds: Bounds | null,
    boundaryContainers: BoundaryContainer[],
    annotationClearance: number
): ArtifactPlacementCandidate[] {
  if (!ownerBounds) {
    return [];
  }

  const participants = boundaryContainers.filter(({
    containsOwner,
    participant
  }) => {
    return containsOwner && participant;
  });

  return participants.flatMap(({ rect }) => {
    return sizes.flatMap(size => {
      const x = ownerBounds.x + (ownerBounds.width - size.width) / 2;
      const gap = Math.max(ROUTING_MARGIN, annotationClearance);

      return [
        {
          rect: bounds(
            x,
            rect.y - gap - size.height,
            size.width,
            size.height
          ),
          sideRank: 4,
          offset: 0,
          gap
        },
        {
          rect: bounds(
            x,
            rect.y + rect.height + gap,
            size.width,
            size.height
          ),
          sideRank: 4,
          offset: 0,
          gap
        }
      ];
    });
  });
}

function outerScopeArtifactCandidates(
    sizes: ElementSize[],
    extents: Extents
): ArtifactPlacementCandidate[] {
  const candidates: ArtifactPlacementCandidate[] = [];

  for (const size of sizes) {
    const horizontalPositions = axisPositions(
      extents.minX,
      extents.maxX - size.width
    );
    const verticalPositions = axisPositions(
      extents.minY,
      extents.maxY - size.height
    );

    for (const x of horizontalPositions) {
      candidates.push({
        rect: bounds(
          x,
          extents.minY - ROUTING_MARGIN - size.height,
          size.width,
          size.height
        ),
        sideRank: 4,
        offset: 0,
        gap: ROUTING_MARGIN
      });
      candidates.push({
        rect: bounds(
          x,
          extents.maxY + ROUTING_MARGIN,
          size.width,
          size.height
        ),
        sideRank: 4,
        offset: 0,
        gap: ROUTING_MARGIN
      });
    }

    for (const y of verticalPositions) {
      candidates.push({
        rect: bounds(
          extents.minX - ROUTING_MARGIN - size.width,
          y,
          size.width,
          size.height
        ),
        sideRank: 4,
        offset: 0,
        gap: ROUTING_MARGIN
      });
      candidates.push({
        rect: bounds(
          extents.maxX + ROUTING_MARGIN,
          y,
          size.width,
          size.height
        ),
        sideRank: 4,
        offset: 0,
        gap: ROUTING_MARGIN
      });
    }
  }

  return candidates;
}

function axisPositions(min: number, max: number): number[] {
  if (max <= min) {
    return [ Math.round((min + max) / 2) ];
  }

  const positions = [];

  for (let position = min; position <= max; position += ROUTING_MARGIN) {
    positions.push(position);
  }

  if (positions.at(-1) !== max) {
    positions.push(max);
  }

  return positions;
}
