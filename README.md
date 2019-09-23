> :warning: __This project is not officially maintained.__ You are still welcome to contribute, e.g. by fixing issues or creating enhancements.


# bpmn-moddle-auto-layout

Get a layouted diagram of a bpmn-process without graphical representation.

__bpmn-moddle-auto-layout__  is built on top of [bpmn-moddle](https://github.com/bpmn-io/bpmn-moddle).


## Usage

__Preconditions:__ The diagram has to have __exactly one single startevent__.

```javascript
var AutoLayout = require('./index');

var xmlWithoutDi = '<?xml version="1.0" encoding="UTF-8"?>' +
                      '<bpmn:definitions>' +
                          /*
                          see example.js for closer look at the
                          passed in xml
                          */
                      '</bpmn:definitions>';

var autoLayout = new AutoLayout();

autoLayout.layoutProcess(xmlWithoutDi, function (error, bpmnXml) {
  if (error) {
    console.error(error)
    return
  }
  // entire bpmn process and diagram contained in bpmnXml 
});

```


## Resources

*   [Issues](https://github.com/bpmn-io/bpmn-moddle-auto-layout/issues)


## License

Use under the terms of the [MIT license](http://opensource.org/licenses/MIT).
