import { BpmnModdle } from 'bpmn-moddle';

import { is } from '../di/DiUtil.js';
import { LayoutError } from '../LayoutError.js';
import { LayoutWarning } from '../LayoutWarning.js';
import { generateDiagrams } from './DiagramGeneration.js';
import { getExpectedDiElements } from './bpmn/ExpectedDiElements.js';
import {
  isSupportedVisualElement,
  getExpandedIds
} from './bpmn/Predicates.js';
import {
  validateInputVisuals,
  validateParseWarnings
} from './bpmn/Validation.js';
import { layoutCollaboration } from './collaboration/index.js';
import { layoutProcessScope } from './process/index.js';

/**
 * Orchestrates greenfield BPMN layout across semantic analysis, placement,
 * routing, and DI emission.
 */
class LayoutEngine {
  constructor() {
    this.moddle = new BpmnModdle();
    this.expandedIds = new Set();
    this.warnings = [];
  }

  async layoutProcess(xml) {
    this.warnings = [];
    const parsed = await this.moddle.fromXML(xml);
    const definitions = parsed.rootElement;
    validateParseWarnings(parsed.warnings || [], xml);
    const root = this.selectRoot(definitions);

    if (!root) {
      return {
        xml: (await this.moddle.toXML(definitions, { format: true })).xml,
        warnings: this.warnings
      };
    }

    this.expandedIds = getExpandedIds(definitions, root);
    validateInputVisuals(definitions, root);
    definitions.diagrams = [];
    let layout;

    if (is(root, 'bpmn:Collaboration')) {
      const result = layoutCollaboration(root, {
        expandedIds: this.expandedIds
      });

      layout = result.layout;
      this.warnings.push(...result.warnings);
    } else {
      const result = layoutProcessScope(root, { expandedIds: this.expandedIds });

      layout = result.layout;
      this.warnings.push(...result.warnings);
    }

    definitions.diagrams = generateDiagrams(this.moddle, layout);
    this.warnForMissingDi(root, definitions);

    return {
      xml: (await this.moddle.toXML(definitions, { format: true })).xml,
      warnings: this.warnings
    };
  }

  selectRoot(definitions) {
    const roots = definitions.rootElements || [];
    const collaboration = roots.find(element => is(element, 'bpmn:Collaboration'));

    if (collaboration) {
      const participants = collaboration.participants || [];

      if (!participants.some(participant => participant.processRef)) {
        const invalidParticipant = participants.find(participant => participant.$attrs.processRef);

        if (invalidParticipant) {
          throw new LayoutError(
            'INVALID_PARTICIPANT_PROCESS_REFERENCE',
            invalidParticipant.id,
            'A participant processRef must reference a declared process.'
          );
        }

        throw new LayoutError(
          'UNSUPPORTED_COLLABORATION',
          collaboration.id,
          'A collaboration needs at least one participant with a processRef.'
        );
      }

      return collaboration;
    }

    return roots.find(element => is(element, 'bpmn:Process')) || null;
  }

  warnForMissingDi(root, definitions) {
    const shapeElements = new Set();
    const edgeElements = new Set();

    for (const diagram of definitions.diagrams) {
      for (const di of diagram.plane.planeElement) {
        if (di.$instanceOf('bpmndi:BPMNShape')) {
          shapeElements.add(di.bpmnElement);
        } else if (di.$instanceOf('bpmndi:BPMNEdge')) {
          edgeElements.add(di.bpmnElement);
        }
      }
    }

    for (const element of getExpectedDiElements(root)) {
      const isShape = isSupportedVisualElement(element);
      const emitted = isShape
        ? shapeElements.has(element)
        : edgeElements.has(element);

      if (emitted || this.warnings.some(warning => warning.elementId === element.id)) {
        continue;
      }

      this.warnings.push(new LayoutWarning(
        'DI_NOT_CREATED',
        element.id,
        `No BPMN DI was created for visual BPMN element "${ element.$type }".`
      ));
    }
  }
}

export function layoutProcess(xml) {
  return new LayoutEngine().layoutProcess(xml);
}
