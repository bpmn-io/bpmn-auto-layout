import { Layouter } from './Layouter.js';

export function layoutProcess(xml) {
  return new Layouter().layoutProcess(xml);
}
