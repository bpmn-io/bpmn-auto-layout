var AutoLayout = require('./index');

var autoLayout = new AutoLayout();
const fs = require('fs')

// get input
fs.readFile(`./test.bpmn`, 'utf8', function (err, inBpmnXml) {
  if (err) {
    console.error(err)
    return
  }
  autoLayout.layoutProcess(inBpmnXml, function (error, outBpmnXml) {
    if (error) {
      console.error(error)
      return
    }
    // write output
    fs.writeFile(`./output.bpmn`, outBpmnXml, function (err, done) {
      if (err) {
        console.error(err)
        return
      }
    })
  })
})


