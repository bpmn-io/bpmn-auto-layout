// AUTO-GENERATED from di.json by @bpmn-io/moddle-types-generator — do not edit.

import type { ModdleElement } from 'moddle';
import type { DcBounds, DcPoint } from './dc.js';

export interface DiDiagramElement {
  id?: string;
  extension?: ModdleElement<DiExtension>;
  owningDiagram?: ModdleElement<DiDiagram>;
  owningElement?: ModdleElement<DiDiagramElement>;
  modelElement?: ModdleElement;
  style?: ModdleElement<DiStyle>;
  ownedElement?: ModdleElement<DiDiagramElement>[];
}

export interface DiNode extends DiDiagramElement {
}

export interface DiEdge extends DiDiagramElement {
  source?: ModdleElement<DiDiagramElement>;
  target?: ModdleElement<DiDiagramElement>;
  waypoint?: ModdleElement<DcPoint>[];
}

export interface DiDiagram {
  id?: string;
  rootElement?: ModdleElement<DiDiagramElement>;
  name?: string;
  documentation?: string;
  resolution?: number;
  ownedStyle?: ModdleElement<DiStyle>[];
}

export interface DiShape extends DiNode {
  bounds?: ModdleElement<DcBounds>;
}

export interface DiPlane extends DiNode {
  planeElement?: ModdleElement<DiDiagramElement>[];
}

export interface DiLabeledEdge extends DiEdge {
  ownedLabel?: ModdleElement<DiLabel>[];
}

export interface DiLabeledShape extends DiShape {
  ownedLabel?: ModdleElement<DiLabel>[];
}

export interface DiLabel extends DiNode {
  bounds?: ModdleElement<DcBounds>;
}

export interface DiStyle {
  id?: string;
}

export interface DiExtension {
  values?: ModdleElement[];
}

export interface DiModdleTypeMap {
  'di:DiagramElement': ModdleElement<DiDiagramElement> & { $type: 'di:DiagramElement' };
  'di:Node': ModdleElement<DiNode> & { $type: 'di:Node' };
  'di:Edge': ModdleElement<DiEdge> & { $type: 'di:Edge' };
  'di:Diagram': ModdleElement<DiDiagram> & { $type: 'di:Diagram' };
  'di:Shape': ModdleElement<DiShape> & { $type: 'di:Shape' };
  'di:Plane': ModdleElement<DiPlane> & { $type: 'di:Plane' };
  'di:LabeledEdge': ModdleElement<DiLabeledEdge> & { $type: 'di:LabeledEdge' };
  'di:LabeledShape': ModdleElement<DiLabeledShape> & { $type: 'di:LabeledShape' };
  'di:Label': ModdleElement<DiLabel> & { $type: 'di:Label' };
  'di:Style': ModdleElement<DiStyle> & { $type: 'di:Style' };
  'di:Extension': ModdleElement<DiExtension> & { $type: 'di:Extension' };
}

declare module 'moddle' {
  interface ModdleTypeMap extends DiModdleTypeMap {}
}
