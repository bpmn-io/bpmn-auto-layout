import { Layouter } from './Layouter';

export function layoutProcess(xml) {
  return new Layouter().layoutProcess(xml);
}
