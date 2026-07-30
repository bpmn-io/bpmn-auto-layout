import {
  LayoutError,
  LayoutWarning,
  layoutProcess
} from 'bpmn-auto-layout';

const result = layoutProcess('<bpmn:definitions />');

void result.then(({ warnings }) => {
  const warning: LayoutWarning | undefined = warnings[0];

  return warning;
});

const error: LayoutError = new LayoutError(
  'UNSUPPORTED_ELEMENT',
  'Task_1',
  'Unsupported element'
);

void error;
