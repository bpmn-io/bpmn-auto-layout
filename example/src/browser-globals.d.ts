import type { ImportXMLResult } from 'bpmn-js/lib/BaseViewer.js';

import type { LayoutWarning } from '../../dist/index.js';

type BpmnAutoLayoutWarning = LayoutWarning | ImportXMLResult['warnings'][number];

declare global {
  interface Window {
    __bpmnAutoLayoutPerformance: {
      layout(xml: string): Promise<{
        warnings: BpmnAutoLayoutWarning[];
      }>;
    };
  }
}

export {};
