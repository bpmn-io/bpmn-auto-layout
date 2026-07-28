import { createLayout } from '../geometry/index.js';

/**
 * @typedef {import('../Types.js').CollaborationLayoutContext} CollaborationLayoutContext
 * @typedef {import('../Types.js').CollaborationLayoutOptions} CollaborationLayoutOptions
 */

/**
 * @param {Object} collaboration
 * @param {Partial<CollaborationLayoutOptions>} options
 * @returns {CollaborationLayoutContext}
 */
export function createCollaborationLayoutContext(
    collaboration,
    {
      expandedIds = new Set(),
      steps = []
    } = {}) {
  return {
    collaboration,
    options: {
      expandedIds,
      steps
    },
    participants: {
      layouts: new Map(),
      anchorPositioned: new Set(),
      expandable: new Set(),
      order: []
    },
    routing: {
      endpointDirections: new Map(),
      channelOffsets: new Map()
    },
    layout: createLayout(collaboration),
    warnings: []
  };
}
