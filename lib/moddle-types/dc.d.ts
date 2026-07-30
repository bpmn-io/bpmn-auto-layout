// AUTO-GENERATED from dc.json by @bpmn-io/moddle-types-generator — do not edit.

import type { ModdleElement } from 'moddle';

export interface DcBoolean {
}

export interface DcInteger {
}

export interface DcReal {
}

export interface DcString {
}

export interface DcFont {
  name?: string;
  size?: number;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  isStrikeThrough?: boolean;
}

export interface DcPoint {
  x?: number;
  y?: number;
}

export interface DcBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface DcModdleTypeMap {
  'dc:Boolean': ModdleElement<DcBoolean> & { $type: 'dc:Boolean' };
  'dc:Integer': ModdleElement<DcInteger> & { $type: 'dc:Integer' };
  'dc:Real': ModdleElement<DcReal> & { $type: 'dc:Real' };
  'dc:String': ModdleElement<DcString> & { $type: 'dc:String' };
  'dc:Font': ModdleElement<DcFont> & { $type: 'dc:Font' };
  'dc:Point': ModdleElement<DcPoint> & { $type: 'dc:Point' };
  'dc:Bounds': ModdleElement<DcBounds> & { $type: 'dc:Bounds' };
}

declare module 'moddle' {
  interface ModdleTypeMap extends DcModdleTypeMap {}
}
