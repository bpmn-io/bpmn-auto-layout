import { is } from '../../../di/DiUtil.js';
import { isArtifact } from '../../bpmn/Predicates.js';
import { createLayoutRecord } from '../Context.js';

/**
 * @typedef {import('../../Types.js').ProcessLayoutContext} ProcessLayoutContext
 */

/**
 * @param {ProcessLayoutContext} context
 * @returns {ProcessLayoutContext}
 */
export function extractElements(context) {
  const { scope } = context;
  const { expandedIds } = context.options;
  const flowElements = scope.flowElements || [];
  const artifacts = scope.artifacts || [];
  const groups = artifacts.filter(element => is(element, 'bpmn:Group'));
  const sequenceFlows = flowElements.filter(element => {
    return is(element, 'bpmn:SequenceFlow');
  });
  const dataAssociations = flowElements.flatMap(element => [
    ...(element.dataInputAssociations || []),
    ...(element.dataOutputAssociations || [])
  ]);
  const associations = [ ...flowElements, ...artifacts ]
    .filter(element => is(element, 'bpmn:Association'))
    .concat(dataAssociations);
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
