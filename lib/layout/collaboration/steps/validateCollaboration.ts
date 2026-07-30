import { LayoutError } from '../../../LayoutError.js';
import { isBpmnType } from '../../bpmn/Types.js';

import type { CollaborationLayoutContext } from '../../Types.js';

export function validateCollaboration(
    context: CollaborationLayoutContext
): CollaborationLayoutContext {
  const { collaboration } = context;

  if (!isBpmnType(collaboration, 'bpmn:Collaboration')) {
    throw new LayoutError(
      'INVALID_COLLABORATION',
      collaboration.id,
      'Expected a BPMN collaboration.'
    );
  }

  for (const flow of collaboration.messageFlows || []) {
    if (!flow.sourceRef || !flow.targetRef) {
      throw new LayoutError(
        'INVALID_MESSAGE_FLOW_ENDPOINT',
        flow.id,
        'A message flow must reference source and target interaction nodes.'
      );
    }
  }

  return context;
}
