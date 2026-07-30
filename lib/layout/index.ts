import {
  BpmnModdle,
  type BpmnModdleParseWarning,
  type BpmnModdleReferenceWarning
} from 'bpmn-moddle';

import { getDefaultSize, is } from '../di/DiUtil.js';
import { LayoutError } from '../LayoutError.js';
import { LayoutWarning } from '../LayoutWarning.js';
import { generateDiagrams } from './DiagramGeneration.js';
import { getExpectedDiElements } from './bpmn/ExpectedDiElements.js';
import {
  isSupportedVisualElement,
  getExpandedIds
} from './bpmn/Predicates.js';
import {
  type BpmnDiModdleElementFor,
  type BpmnElement,
  type BpmnElementFor
} from './bpmn/Types.js';
import { layoutCollaboration } from './collaboration/index.js';
import { layoutProcessScope } from './process/index.js';

type BpmnDefinitions = BpmnElementFor<'bpmn:Definitions'>;
type BpmnDiagram = BpmnDiModdleElementFor<'bpmndi:BPMNDiagram'>;
type BpmnPlaneElement = NonNullable<
  NonNullable<BpmnDiagram['plane']>['planeElement']
>[number];
type BpmnPlaneElementType = 'bpmndi:BPMNEdge' | 'bpmndi:BPMNShape';

/**
 * Orchestrates greenfield BPMN layout across semantic analysis, placement,
 * routing, and DI emission.
 */
class LayoutEngine {
  moddle: BpmnModdle;
  expandedIds: Set<string>;
  warnings: LayoutWarning[];

  constructor() {
    this.moddle = new BpmnModdle();
    this.expandedIds = new Set();
    this.warnings = [];
  }

  async layoutProcess(xml: string) {
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

    const diagrams = generateDiagrams(this.moddle, layout);

    definitions.diagrams = diagrams;
    this.warnForMissingDi(root, diagrams);

    return {
      xml: (await this.moddle.toXML(definitions, { format: true })).xml,
      warnings: this.warnings
    };
  }

  selectRoot(definitions: BpmnDefinitions): BpmnElement | null {
    const roots = definitions.rootElements || [];
    const collaboration = roots.find(element => is(element, 'bpmn:Collaboration'));

    if (collaboration) {
      const participants = collaboration.participants || [];

      if (!participants.some(participant => participant.processRef)) {
        const invalidParticipant = participants.find(participant => participant.$attrs?.processRef);

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

  warnForMissingDi(root: BpmnElement, diagrams: BpmnDiagram[]): void {
    const shapeElements = new Set<BpmnElement | undefined>();
    const edgeElements = new Set<BpmnElement | undefined>();

    for (const diagram of diagrams) {
      const plane = diagram.plane;

      if (!plane) {
        continue;
      }

      for (const di of plane.planeElement || []) {
        if (isBpmnPlaneElement(di, 'bpmndi:BPMNShape')) {
          shapeElements.add(di.bpmnElement);
        } else if (isBpmnPlaneElement(di, 'bpmndi:BPMNEdge')) {
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

export function layoutProcess(xml: string) {
  return new LayoutEngine().layoutProcess(xml);
}

function validateInputVisuals(
    definitions: BpmnDefinitions,
    root: BpmnElement
): void {
  const diagram = (definitions.diagrams || []).find(candidate => {
    return candidate.plane?.bpmnElement === root;
  });

  for (const di of diagram?.plane?.planeElement || []) {
    if (!isBpmnPlaneElement(di, 'bpmndi:BPMNShape')) {
      continue;
    }

    const element = di.bpmnElement;

    if (
      !element ||
      is(element, 'bpmn:Group') ||
      (getDefaultSize(element) && isSupportedVisualElement(element))
    ) {
      continue;
    }

    throw new LayoutError(
      'UNSUPPORTED_ELEMENT',
      element.id,
      `Cannot generate DI for visual BPMN element "${element.$type}".`
    );
  }
}

function validateParseWarnings(
    warnings: BpmnModdleParseWarning[],
    xml: string
): void {
  const invalidProcessRef = warnings.find(
    (warning): warning is BpmnModdleReferenceWarning => {
      return 'property' in warning &&
        warning.property === 'bpmn:processRef';
    }
  );

  if (invalidProcessRef) {
    throw new LayoutError(
      'INVALID_PARTICIPANT_PROCESS_REFERENCE',
      invalidProcessRef.element.id,
      'A participant processRef must reference a declared process.'
    );
  }

  const unknownType = warnings.find(warning => {
    return warning.message.includes('unknown type');
  });

  if (unknownType) {
    const elementId = /<bpmn:[^ >]+[^>]*\sid="([^"]+)"/.exec(xml)?.[1] || 'unknown';

    throw new LayoutError(
      'UNSUPPORTED_ELEMENT',
      elementId,
      'Cannot generate DI for an unknown BPMN visual element.'
    );
  }
}

function isBpmnPlaneElement<Type extends BpmnPlaneElementType>(
    element: BpmnPlaneElement,
    type: Type
): element is BpmnDiModdleElementFor<Type> {
  return element.$instanceOf(type);
}
