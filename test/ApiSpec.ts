import assert from 'node:assert';
import { createRequire } from 'node:module';
import { describe, it } from 'mocha';

import {
  layoutProcess,
  LayoutWarning
} from 'bpmn-auto-layout';

const require = createRequire(import.meta.url);

describe('API', function() {

  it('should return XML and warnings', async function() {
    const result = await layoutProcess(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" />'
    );

    assert.strictEqual(typeof result.xml, 'string');
    assert.deepStrictEqual(result.warnings, []);
  });

  it('should expose structured layout warnings', function() {
    const warning = new LayoutWarning(
      'EXAMPLE_WARNING',
      'Element_1',
      'Example warning.',
      [ 'Element_2' ]
    );

    assert.ok(warning instanceof Error);
    assert.strictEqual(warning.name, 'LayoutWarning');
    assert.strictEqual(warning.code, 'EXAMPLE_WARNING');
    assert.strictEqual(warning.elementId, 'Element_1');
    assert.strictEqual(warning.message, 'Example warning.');
    assert.deepStrictEqual(warning.relatedElementIds, [ 'Element_2' ]);
  });

  it('should expose the CommonJS entry point', function() {
    const commonJsApi: typeof import('bpmn-auto-layout') = require('bpmn-auto-layout');

    assert.strictEqual(commonJsApi.layoutProcess, layoutProcess);
    assert.strictEqual(commonJsApi.LayoutWarning, LayoutWarning);
  });
});
