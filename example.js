var AutoLayout = require('./index');

var xmlWithoutDi = '<?xml version="1.0" encoding="UTF-8"?>' +
                      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="0.7.0-dev">' +
                        '<bpmn:process id="Process_1" isExecutable="false">'+
                          '<bpmn:startEvent id="StartEvent_1">' +
                            '<bpmn:outgoing>SequenceFlow_1e8q2t2</bpmn:outgoing>' +
                            '<bpmn:outgoing>SequenceFlow_1taw05v</bpmn:outgoing>' +
                          '</bpmn:startEvent>' +
                          '<bpmn:task id="Task_13vu0q1">' +
                            '<bpmn:incoming>SequenceFlow_1e8q2t2</bpmn:incoming>' +
                            '<bpmn:outgoing>SequenceFlow_1gi0q3c</bpmn:outgoing>' +
                          '</bpmn:task>' +
                          '<bpmn:sequenceFlow id="SequenceFlow_1e8q2t2" sourceRef="StartEvent_1" targetRef="Task_13vu0q1" />' +
                          '<bpmn:endEvent id="EndEvent_0ei7qv4">' +
                            '<bpmn:incoming>SequenceFlow_1gi0q3c</bpmn:incoming>' +
                          '</bpmn:endEvent>' +
                          '<bpmn:sequenceFlow id="SequenceFlow_1gi0q3c" sourceRef="Task_13vu0q1" targetRef="EndEvent_0ei7qv4" />' +
                          '<bpmn:endEvent id="EndEvent_15m6igf">' +
                            '<bpmn:incoming>SequenceFlow_1taw05v</bpmn:incoming>' +
                          '</bpmn:endEvent>' +
                          '<bpmn:sequenceFlow id="SequenceFlow_1taw05v" sourceRef="StartEvent_1" targetRef="EndEvent_15m6igf" />' +
                        '</bpmn:process>' +
                      '</bpmn:definitions>';

var autoLayout = new AutoLayout();

autoLayout.layoutProcess(xmlWithoutDi);
