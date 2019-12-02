var AutoLayout = require('bpmn-auto-layout');

var diagramXML = `
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_13fbzpq" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="1.16.2">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1">
      <bpmn:outgoing>SequenceFlow_1mszyzk</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="SequenceFlow_1mszyzk" sourceRef="StartEvent_1" targetRef="ExclusiveGateway_0sq3174" />
    <bpmn:parallelGateway id="ExclusiveGateway_0sq3174">
      <bpmn:incoming>SequenceFlow_1mszyzk</bpmn:incoming>
      <bpmn:outgoing>SequenceFlow_03esriq</bpmn:outgoing>
      <bpmn:outgoing>SequenceFlow_02hvcgf</bpmn:outgoing>
      <bpmn:outgoing>SequenceFlow_19h83er</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:task id="Task_0ld66b4">
      <bpmn:incoming>SequenceFlow_03esriq</bpmn:incoming>
      <bpmn:outgoing>SequenceFlow_0tg7drp</bpmn:outgoing>
    </bpmn:task>
    <bpmn:sequenceFlow id="SequenceFlow_03esriq" sourceRef="ExclusiveGateway_0sq3174" targetRef="Task_0ld66b4" />
    <bpmn:sequenceFlow id="SequenceFlow_0tg7drp" sourceRef="Task_0ld66b4" targetRef="ExclusiveGateway_0r8lvxp" />
    <bpmn:parallelGateway id="ExclusiveGateway_0r8lvxp">
      <bpmn:incoming>SequenceFlow_0tg7drp</bpmn:incoming>
      <bpmn:incoming>SequenceFlow_05dzfzs</bpmn:incoming>
      <bpmn:incoming>SequenceFlow_1islxlc</bpmn:incoming>
      <bpmn:outgoing>SequenceFlow_0t4pyqy</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:endEvent id="EndEvent_103kypw">
      <bpmn:incoming>SequenceFlow_0t4pyqy</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="SequenceFlow_0t4pyqy" sourceRef="ExclusiveGateway_0r8lvxp" targetRef="EndEvent_103kypw" />
    <bpmn:sequenceFlow id="SequenceFlow_02hvcgf" sourceRef="ExclusiveGateway_0sq3174" targetRef="Task_0zrq2vz" />
    <bpmn:sequenceFlow id="SequenceFlow_05dzfzs" sourceRef="Task_0zrq2vz" targetRef="ExclusiveGateway_0r8lvxp" />
    <bpmn:subProcess id="Task_0zrq2vz">
      <bpmn:incoming>SequenceFlow_02hvcgf</bpmn:incoming>
      <bpmn:outgoing>SequenceFlow_05dzfzs</bpmn:outgoing>
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="SequenceFlow_19h83er" sourceRef="ExclusiveGateway_0sq3174" targetRef="Task_01g18mq" />
    <bpmn:sequenceFlow id="SequenceFlow_1islxlc" sourceRef="Task_01g18mq" targetRef="ExclusiveGateway_0r8lvxp" />
    <bpmn:subProcess id="Task_01g18mq">
      <bpmn:incoming>SequenceFlow_19h83er</bpmn:incoming>
      <bpmn:outgoing>SequenceFlow_1islxlc</bpmn:outgoing>
      <bpmn:startEvent id="StartEvent_1y5wa2h">
        <bpmn:outgoing>SequenceFlow_0u8lxvr</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:task id="Task_0dbcp5s">
        <bpmn:incoming>SequenceFlow_0u8lxvr</bpmn:incoming>
        <bpmn:outgoing>SequenceFlow_1q664hi</bpmn:outgoing>
      </bpmn:task>
      <bpmn:sequenceFlow id="SequenceFlow_0u8lxvr" sourceRef="StartEvent_1y5wa2h" targetRef="Task_0dbcp5s" />
      <bpmn:endEvent id="EndEvent_1oe3ly7">
        <bpmn:incoming>SequenceFlow_1q664hi</bpmn:incoming>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="SequenceFlow_1q664hi" sourceRef="Task_0dbcp5s" targetRef="EndEvent_1oe3ly7" />
    </bpmn:subProcess>
  </bpmn:process>
</bpmn:definitions>
`;

var autoLayout = new AutoLayout();

var fs = require('fs').promises;


(async () => {

  var layoutedDiagramXML = autoLayout.layoutProcess(diagramXML);

  // print diagram XML
  console.log(layoutedDiagramXML);

  // or write to file
  await fs.writeFile('./layouted.bpmn', layoutedDiagramXML);
})();
