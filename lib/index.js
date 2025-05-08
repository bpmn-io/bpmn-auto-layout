import { Layouter } from './Layouter.js';

export function layoutProcess(xml, customModdle) {
  return new Layouter(customModdle).layoutProcess(xml);
}
