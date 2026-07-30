import { is } from '../../../di/DiUtil.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import { createLayoutRecord } from '../LayoutRecord.js';

import type { BpmnElement, ProcessLayoutContext } from '../../Types.js';

export function extractElements(context: ProcessLayoutContext): ProcessLayoutContext {
  const { scope } = context;
  const { expandedIds } = context.options;
  const isFlowElementsContainer = is(scope, 'bpmn:Process') ||
    is(scope, 'bpmn:SubProcess');
  const flowElements = isFlowElementsContainer ? scope.flowElements || [] : [];
  const artifacts = isFlowElementsContainer && 'artifacts' in scope
    ? scope.artifacts || []
    : [];
  const groups = artifacts.filter(element => is(element, 'bpmn:Group'));
  const sequenceFlows = flowElements.filter(element => {
    return is(element, 'bpmn:SequenceFlow');
  });
  const dataAssociations = flowElements.flatMap(element => {
    if (!is(element, 'bpmn:Activity')) {
      return [];
    }

    return [
      ...(element.dataInputAssociations || []),
      ...(element.dataOutputAssociations || [])
    ];
  });
  const associations: BpmnElement[] = [ ...flowElements, ...artifacts ]
    .filter(element => is(element, 'bpmn:Association'));

  associations.push(...dataAssociations);
  const nodeElements = [ ...new Set([
    ...flowElements.filter(element => {
      return !is(element, 'bpmn:SequenceFlow') &&
        !is(element, 'bpmn:Association') &&
        !is(element, 'bpmn:Group') &&
        !is(element, 'bpmn:DataObject');
    }),
    ...artifacts.filter(element => {
      return isArtifact(element) && !is(element, 'bpmn:Group');
    })
  ]) ];
  const records = nodeElements.map((element, index) => {
    return createLayoutRecord(element, index, expandedIds);
  });

  return {
    ...context,
    elements: {
      groups,
      sequenceFlows,
      associations
    },
    placement: {
      records,
      recordsByElement: new Map(records.map(record => [ record.element, record ]))
    }
  };
}
