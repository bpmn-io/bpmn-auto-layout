// AUTO-GENERATED from bpmndi.json by @bpmn-io/moddle-types-generator — do not edit.

import type { ModdleElement } from 'moddle';
import type { BpmnBaseElement } from './bpmn.js';
import type { DcFont } from './dc.js';
import type { DiDiagram, DiDiagramElement, DiLabel, DiLabeledEdge, DiLabeledShape, DiPlane, DiStyle } from './di.js';

export type BpmndiParticipantBandKind = 'top_initiating' | 'middle_initiating' | 'bottom_initiating' | 'top_non_initiating' | 'middle_non_initiating' | 'bottom_non_initiating';
export type BpmndiMessageVisibleKind = 'initiating' | 'non_initiating';

export interface BpmndiBPMNDiagram extends DiDiagram {
  plane?: ModdleElement<BpmndiBPMNPlane>;
  labelStyle?: ModdleElement<BpmndiBPMNLabelStyle>[];
}

export interface BpmndiBPMNPlane extends DiPlane {
  bpmnElement?: ModdleElement<BpmnBaseElement>;
}

export interface BpmndiBPMNShape extends DiLabeledShape {
  bpmnElement?: ModdleElement<BpmnBaseElement>;
  isHorizontal?: boolean;
  isExpanded?: boolean;
  isMarkerVisible?: boolean;
  label?: ModdleElement<BpmndiBPMNLabel>;
  isMessageVisible?: boolean;
  participantBandKind?: BpmndiParticipantBandKind;
  choreographyActivityShape?: ModdleElement<BpmndiBPMNShape>;
}

export interface BpmndiBPMNEdge extends DiLabeledEdge {
  label?: ModdleElement<BpmndiBPMNLabel>;
  bpmnElement?: ModdleElement<BpmnBaseElement>;
  sourceElement?: ModdleElement<DiDiagramElement>;
  targetElement?: ModdleElement<DiDiagramElement>;
  messageVisibleKind?: BpmndiMessageVisibleKind;
}

export interface BpmndiBPMNLabel extends DiLabel {
  labelStyle?: ModdleElement<BpmndiBPMNLabelStyle>;
}

export interface BpmndiBPMNLabelStyle extends DiStyle {
  font?: ModdleElement<DcFont>;
}

export interface BpmndiModdleTypeMap {
  'bpmndi:BPMNDiagram': ModdleElement<BpmndiBPMNDiagram> & { $type: 'bpmndi:BPMNDiagram' };
  'bpmndi:BPMNPlane': ModdleElement<BpmndiBPMNPlane> & { $type: 'bpmndi:BPMNPlane' };
  'bpmndi:BPMNShape': ModdleElement<BpmndiBPMNShape> & { $type: 'bpmndi:BPMNShape' };
  'bpmndi:BPMNEdge': ModdleElement<BpmndiBPMNEdge> & { $type: 'bpmndi:BPMNEdge' };
  'bpmndi:BPMNLabel': ModdleElement<BpmndiBPMNLabel> & { $type: 'bpmndi:BPMNLabel' };
  'bpmndi:BPMNLabelStyle': ModdleElement<BpmndiBPMNLabelStyle> & { $type: 'bpmndi:BPMNLabelStyle' };
}

declare module 'moddle' {
  interface ModdleTypeMap extends BpmndiModdleTypeMap {}
}
