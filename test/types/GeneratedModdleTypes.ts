import type { BpmnSequenceFlow } from '../../lib/moddle-types/bpmn.js';
import type { ModdleElement } from 'moddle';

import { isBpmnType } from '../../lib/layout/bpmn/Types.js';

declare const element: unknown;

if (isBpmnType(element, 'bpmn:SequenceFlow')) {
  const sequenceFlow: ModdleElement<BpmnSequenceFlow> = element;

  void sequenceFlow.sourceRef?.id;
}
