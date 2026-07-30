// AUTO-GENERATED from bpmn.json by @bpmn-io/moddle-types-generator — do not edit.

import type { ModdleElement } from 'moddle';
import type { BpmndiBPMNDiagram } from './bpmndi.js';

export type BpmnProcessType = 'None' | 'Public' | 'Private';
export type BpmnGatewayDirection = 'Unspecified' | 'Converging' | 'Diverging' | 'Mixed';
export type BpmnEventBasedGatewayType = 'Parallel' | 'Exclusive';
export type BpmnRelationshipDirection = 'None' | 'Forward' | 'Backward' | 'Both';
export type BpmnItemKind = 'Physical' | 'Information';
export type BpmnChoreographyLoopType = 'None' | 'Standard' | 'MultiInstanceSequential' | 'MultiInstanceParallel';
export type BpmnAssociationDirection = 'None' | 'One' | 'Both';
export type BpmnMultiInstanceBehavior = 'None' | 'One' | 'All' | 'Complex';
export type BpmnAdHocOrdering = 'Parallel' | 'Sequential';

export interface BpmnInterface extends BpmnRootElement {
  name?: string;
  operations?: ModdleElement<BpmnOperation>[];
  implementationRef?: string;
}

export interface BpmnOperation extends BpmnBaseElement {
  name?: string;
  inMessageRef?: ModdleElement<BpmnMessage>;
  outMessageRef?: ModdleElement<BpmnMessage>;
  errorRef?: ModdleElement<BpmnError>[];
  implementationRef?: string;
}

export interface BpmnEndPoint extends BpmnRootElement {
}

export interface BpmnAuditing extends BpmnBaseElement {
}

export interface BpmnGlobalTask extends BpmnCallableElement {
  resources?: ModdleElement<BpmnResourceRole>[];
}

export interface BpmnMonitoring extends BpmnBaseElement {
}

export interface BpmnPerformer extends BpmnResourceRole {
}

export interface BpmnProcess extends BpmnFlowElementsContainer, BpmnCallableElement {
  processType?: BpmnProcessType;
  isClosed?: boolean;
  auditing?: ModdleElement<BpmnAuditing>;
  monitoring?: ModdleElement<BpmnMonitoring>;
  properties?: ModdleElement<BpmnProperty>[];
  laneSets?: ModdleElement<BpmnLaneSet>[];
  flowElements?: ModdleElement<BpmnFlowElement>[];
  artifacts?: ModdleElement<BpmnArtifact>[];
  resources?: ModdleElement<BpmnResourceRole>[];
  correlationSubscriptions?: ModdleElement<BpmnCorrelationSubscription>[];
  supports?: ModdleElement<BpmnProcess>[];
  definitionalCollaborationRef?: ModdleElement<BpmnCollaboration>;
  isExecutable?: boolean;
}

export interface BpmnLaneSet extends BpmnBaseElement {
  lanes?: ModdleElement<BpmnLane>[];
  name?: string;
}

export interface BpmnLane extends BpmnBaseElement {
  name?: string;
  partitionElementRef?: ModdleElement<BpmnBaseElement>;
  partitionElement?: ModdleElement<BpmnBaseElement>;
  flowNodeRef?: ModdleElement<BpmnFlowNode>[];
  childLaneSet?: ModdleElement<BpmnLaneSet>;
}

export interface BpmnGlobalManualTask extends BpmnGlobalTask {
}

export interface BpmnManualTask extends BpmnTask {
}

export interface BpmnUserTask extends BpmnTask {
  renderings?: ModdleElement<BpmnRendering>[];
  implementation?: string;
}

export interface BpmnRendering extends BpmnBaseElement {
}

export interface BpmnHumanPerformer extends BpmnPerformer {
}

export interface BpmnPotentialOwner extends BpmnHumanPerformer {
}

export interface BpmnGlobalUserTask extends BpmnGlobalTask {
  implementation?: string;
  renderings?: ModdleElement<BpmnRendering>[];
}

export interface BpmnGateway extends BpmnFlowNode {
  gatewayDirection?: BpmnGatewayDirection;
}

export interface BpmnEventBasedGateway extends BpmnGateway {
  instantiate?: boolean;
  eventGatewayType?: BpmnEventBasedGatewayType;
}

export interface BpmnComplexGateway extends BpmnGateway {
  activationCondition?: ModdleElement<BpmnExpression>;
  default?: ModdleElement<BpmnSequenceFlow>;
}

export interface BpmnExclusiveGateway extends BpmnGateway {
  default?: ModdleElement<BpmnSequenceFlow>;
}

export interface BpmnInclusiveGateway extends BpmnGateway {
  default?: ModdleElement<BpmnSequenceFlow>;
}

export interface BpmnParallelGateway extends BpmnGateway {
}

export interface BpmnRootElement extends BpmnBaseElement {
}

export interface BpmnRelationship extends BpmnBaseElement {
  type?: string;
  direction?: BpmnRelationshipDirection;
  source?: ModdleElement[];
  target?: ModdleElement[];
}

export interface BpmnBaseElement {
  id?: string;
  documentation?: ModdleElement<BpmnDocumentation>[];
  extensionDefinitions?: ModdleElement<BpmnExtensionDefinition>[];
  extensionElements?: ModdleElement<BpmnExtensionElements>;
}

export interface BpmnExtension {
  mustUnderstand?: boolean;
  definition?: ModdleElement<BpmnExtensionDefinition>;
}

export interface BpmnExtensionDefinition {
  name?: string;
  extensionAttributeDefinitions?: ModdleElement<BpmnExtensionAttributeDefinition>[];
}

export interface BpmnExtensionAttributeDefinition {
  name?: string;
  type?: string;
  isReference?: boolean;
  extensionDefinition?: ModdleElement<BpmnExtensionDefinition>;
}

export interface BpmnExtensionElements {
  valueRef?: ModdleElement;
  values?: ModdleElement[];
  extensionAttributeDefinition?: ModdleElement<BpmnExtensionAttributeDefinition>;
}

export interface BpmnDocumentation extends BpmnBaseElement {
  text?: string;
  textFormat?: string;
}

export interface BpmnEvent extends BpmnFlowNode, BpmnInteractionNode {
  properties?: ModdleElement<BpmnProperty>[];
}

export interface BpmnIntermediateCatchEvent extends BpmnCatchEvent {
}

export interface BpmnIntermediateThrowEvent extends BpmnThrowEvent {
}

export interface BpmnEndEvent extends BpmnThrowEvent {
}

export interface BpmnStartEvent extends BpmnCatchEvent {
  isInterrupting?: boolean;
}

export interface BpmnThrowEvent extends BpmnEvent {
  dataInputs?: ModdleElement<BpmnDataInput>[];
  dataInputAssociations?: ModdleElement<BpmnDataInputAssociation>[];
  inputSet?: ModdleElement<BpmnInputSet>;
  eventDefinitions?: ModdleElement<BpmnEventDefinition>[];
  eventDefinitionRef?: ModdleElement<BpmnEventDefinition>[];
}

export interface BpmnCatchEvent extends BpmnEvent {
  parallelMultiple?: boolean;
  dataOutputs?: ModdleElement<BpmnDataOutput>[];
  dataOutputAssociations?: ModdleElement<BpmnDataOutputAssociation>[];
  outputSet?: ModdleElement<BpmnOutputSet>;
  eventDefinitions?: ModdleElement<BpmnEventDefinition>[];
  eventDefinitionRef?: ModdleElement<BpmnEventDefinition>[];
}

export interface BpmnBoundaryEvent extends BpmnCatchEvent {
  cancelActivity?: boolean;
  attachedToRef?: ModdleElement<BpmnActivity>;
}

export interface BpmnEventDefinition extends BpmnRootElement {
}

export interface BpmnCancelEventDefinition extends BpmnEventDefinition {
}

export interface BpmnErrorEventDefinition extends BpmnEventDefinition {
  errorRef?: ModdleElement<BpmnError>;
}

export interface BpmnTerminateEventDefinition extends BpmnEventDefinition {
}

export interface BpmnEscalationEventDefinition extends BpmnEventDefinition {
  escalationRef?: ModdleElement<BpmnEscalation>;
}

export interface BpmnEscalation extends BpmnRootElement {
  structureRef?: ModdleElement<BpmnItemDefinition>;
  name?: string;
  escalationCode?: string;
}

export interface BpmnCompensateEventDefinition extends BpmnEventDefinition {
  waitForCompletion?: boolean;
  activityRef?: ModdleElement<BpmnActivity>;
}

export interface BpmnTimerEventDefinition extends BpmnEventDefinition {
  timeDate?: ModdleElement<BpmnExpression>;
  timeCycle?: ModdleElement<BpmnExpression>;
  timeDuration?: ModdleElement<BpmnExpression>;
}

export interface BpmnLinkEventDefinition extends BpmnEventDefinition {
  name?: string;
  target?: ModdleElement<BpmnLinkEventDefinition>;
  source?: ModdleElement<BpmnLinkEventDefinition>[];
}

export interface BpmnMessageEventDefinition extends BpmnEventDefinition {
  messageRef?: ModdleElement<BpmnMessage>;
  operationRef?: ModdleElement<BpmnOperation>;
}

export interface BpmnConditionalEventDefinition extends BpmnEventDefinition {
  condition?: ModdleElement<BpmnExpression>;
}

export interface BpmnSignalEventDefinition extends BpmnEventDefinition {
  signalRef?: ModdleElement<BpmnSignal>;
}

export interface BpmnSignal extends BpmnRootElement {
  structureRef?: ModdleElement<BpmnItemDefinition>;
  name?: string;
}

export interface BpmnImplicitThrowEvent extends BpmnThrowEvent {
}

export interface BpmnDataState extends BpmnBaseElement {
  name?: string;
}

export interface BpmnItemAwareElement extends BpmnBaseElement {
  itemSubjectRef?: ModdleElement<BpmnItemDefinition>;
  dataState?: ModdleElement<BpmnDataState>;
}

export interface BpmnDataAssociation extends BpmnBaseElement {
  sourceRef?: ModdleElement<BpmnItemAwareElement>[];
  targetRef?: ModdleElement<BpmnItemAwareElement>;
  transformation?: ModdleElement<BpmnFormalExpression>;
  assignment?: ModdleElement<BpmnAssignment>[];
}

export interface BpmnDataInput extends BpmnItemAwareElement {
  name?: string;
  isCollection?: boolean;
  inputSetRef?: ModdleElement<BpmnInputSet>[];
  inputSetWithOptional?: ModdleElement<BpmnInputSet>[];
  inputSetWithWhileExecuting?: ModdleElement<BpmnInputSet>[];
}

export interface BpmnDataOutput extends BpmnItemAwareElement {
  name?: string;
  isCollection?: boolean;
  outputSetRef?: ModdleElement<BpmnOutputSet>[];
  outputSetWithOptional?: ModdleElement<BpmnOutputSet>[];
  outputSetWithWhileExecuting?: ModdleElement<BpmnOutputSet>[];
}

export interface BpmnInputSet extends BpmnBaseElement {
  name?: string;
  dataInputRefs?: ModdleElement<BpmnDataInput>[];
  optionalInputRefs?: ModdleElement<BpmnDataInput>[];
  whileExecutingInputRefs?: ModdleElement<BpmnDataInput>[];
  outputSetRefs?: ModdleElement<BpmnOutputSet>[];
}

export interface BpmnOutputSet extends BpmnBaseElement {
  dataOutputRefs?: ModdleElement<BpmnDataOutput>[];
  name?: string;
  inputSetRefs?: ModdleElement<BpmnInputSet>[];
  optionalOutputRefs?: ModdleElement<BpmnDataOutput>[];
  whileExecutingOutputRefs?: ModdleElement<BpmnDataOutput>[];
}

export interface BpmnProperty extends BpmnItemAwareElement {
  name?: string;
}

export interface BpmnDataInputAssociation extends BpmnDataAssociation {
}

export interface BpmnDataOutputAssociation extends BpmnDataAssociation {
}

export interface BpmnInputOutputSpecification extends BpmnBaseElement {
  dataInputs?: ModdleElement<BpmnDataInput>[];
  dataOutputs?: ModdleElement<BpmnDataOutput>[];
  inputSets?: ModdleElement<BpmnInputSet>[];
  outputSets?: ModdleElement<BpmnOutputSet>[];
}

export interface BpmnDataObject extends BpmnFlowElement, BpmnItemAwareElement {
  isCollection?: boolean;
}

export interface BpmnInputOutputBinding {
  inputDataRef?: ModdleElement<BpmnInputSet>;
  outputDataRef?: ModdleElement<BpmnOutputSet>;
  operationRef?: ModdleElement<BpmnOperation>;
}

export interface BpmnAssignment extends BpmnBaseElement {
  from?: ModdleElement<BpmnExpression>;
  to?: ModdleElement<BpmnExpression>;
}

export interface BpmnDataStore extends BpmnRootElement, BpmnItemAwareElement {
  name?: string;
  capacity?: number;
  isUnlimited?: boolean;
}

export interface BpmnDataStoreReference extends BpmnItemAwareElement, BpmnFlowElement {
  dataStoreRef?: ModdleElement<BpmnDataStore>;
}

export interface BpmnDataObjectReference extends BpmnItemAwareElement, BpmnFlowElement {
  dataObjectRef?: ModdleElement<BpmnDataObject>;
}

export interface BpmnConversationLink extends BpmnBaseElement {
  sourceRef?: ModdleElement<BpmnInteractionNode>;
  targetRef?: ModdleElement<BpmnInteractionNode>;
  name?: string;
}

export interface BpmnConversationAssociation extends BpmnBaseElement {
  innerConversationNodeRef?: ModdleElement<BpmnConversationNode>;
  outerConversationNodeRef?: ModdleElement<BpmnConversationNode>;
}

export interface BpmnCallConversation extends BpmnConversationNode {
  calledCollaborationRef?: ModdleElement<BpmnCollaboration>;
  participantAssociations?: ModdleElement<BpmnParticipantAssociation>[];
}

export interface BpmnConversation extends BpmnConversationNode {
}

export interface BpmnSubConversation extends BpmnConversationNode {
  conversationNodes?: ModdleElement<BpmnConversationNode>[];
}

export interface BpmnConversationNode extends BpmnInteractionNode, BpmnBaseElement {
  name?: string;
  participantRef?: ModdleElement<BpmnParticipant>[];
  messageFlowRefs?: ModdleElement<BpmnMessageFlow>[];
  correlationKeys?: ModdleElement<BpmnCorrelationKey>[];
}

export interface BpmnGlobalConversation extends BpmnCollaboration {
}

export interface BpmnPartnerEntity extends BpmnRootElement {
  name?: string;
  participantRef?: ModdleElement<BpmnParticipant>[];
}

export interface BpmnPartnerRole extends BpmnRootElement {
  name?: string;
  participantRef?: ModdleElement<BpmnParticipant>[];
}

export interface BpmnCorrelationProperty extends BpmnRootElement {
  correlationPropertyRetrievalExpression?: ModdleElement<BpmnCorrelationPropertyRetrievalExpression>[];
  name?: string;
  type?: ModdleElement<BpmnItemDefinition>;
}

export interface BpmnError extends BpmnRootElement {
  structureRef?: ModdleElement<BpmnItemDefinition>;
  name?: string;
  errorCode?: string;
}

export interface BpmnCorrelationKey extends BpmnBaseElement {
  correlationPropertyRef?: ModdleElement<BpmnCorrelationProperty>[];
  name?: string;
}

export interface BpmnExpression extends BpmnBaseElement {
  body?: string;
}

export interface BpmnFormalExpression extends BpmnExpression {
  language?: string;
  evaluatesToTypeRef?: ModdleElement<BpmnItemDefinition>;
}

export interface BpmnMessage extends BpmnRootElement {
  name?: string;
  itemRef?: ModdleElement<BpmnItemDefinition>;
}

export interface BpmnItemDefinition extends BpmnRootElement {
  itemKind?: BpmnItemKind;
  structureRef?: string;
  isCollection?: boolean;
  import?: ModdleElement<BpmnImport>;
}

export interface BpmnFlowElement extends BpmnBaseElement {
  name?: string;
  auditing?: ModdleElement<BpmnAuditing>;
  monitoring?: ModdleElement<BpmnMonitoring>;
  categoryValueRef?: ModdleElement<BpmnCategoryValue>[];
}

export interface BpmnSequenceFlow extends BpmnFlowElement {
  isImmediate?: boolean;
  conditionExpression?: ModdleElement<BpmnExpression>;
  sourceRef?: ModdleElement<BpmnFlowNode>;
  targetRef?: ModdleElement<BpmnFlowNode>;
}

export interface BpmnFlowElementsContainer extends BpmnBaseElement {
  laneSets?: ModdleElement<BpmnLaneSet>[];
  flowElements?: ModdleElement<BpmnFlowElement>[];
}

export interface BpmnCallableElement extends BpmnRootElement {
  name?: string;
  ioSpecification?: ModdleElement<BpmnInputOutputSpecification>;
  supportedInterfaceRef?: ModdleElement<BpmnInterface>[];
  ioBinding?: ModdleElement<BpmnInputOutputBinding>[];
}

export interface BpmnFlowNode extends BpmnFlowElement {
  incoming?: ModdleElement<BpmnSequenceFlow>[];
  outgoing?: ModdleElement<BpmnSequenceFlow>[];
  lanes?: ModdleElement<BpmnLane>[];
}

export interface BpmnCorrelationPropertyRetrievalExpression extends BpmnBaseElement {
  messagePath?: ModdleElement<BpmnFormalExpression>;
  messageRef?: ModdleElement<BpmnMessage>;
}

export interface BpmnCorrelationPropertyBinding extends BpmnBaseElement {
  dataPath?: ModdleElement<BpmnFormalExpression>;
  correlationPropertyRef?: ModdleElement<BpmnCorrelationProperty>;
}

export interface BpmnResource extends BpmnRootElement {
  name?: string;
  resourceParameters?: ModdleElement<BpmnResourceParameter>[];
}

export interface BpmnResourceParameter extends BpmnBaseElement {
  name?: string;
  isRequired?: boolean;
  type?: ModdleElement<BpmnItemDefinition>;
}

export interface BpmnCorrelationSubscription extends BpmnBaseElement {
  correlationKeyRef?: ModdleElement<BpmnCorrelationKey>;
  correlationPropertyBinding?: ModdleElement<BpmnCorrelationPropertyBinding>[];
}

export interface BpmnMessageFlow extends BpmnBaseElement {
  name?: string;
  sourceRef?: ModdleElement<BpmnInteractionNode>;
  targetRef?: ModdleElement<BpmnInteractionNode>;
  messageRef?: ModdleElement<BpmnMessage>;
}

export interface BpmnMessageFlowAssociation extends BpmnBaseElement {
  innerMessageFlowRef?: ModdleElement<BpmnMessageFlow>;
  outerMessageFlowRef?: ModdleElement<BpmnMessageFlow>;
}

export interface BpmnInteractionNode {
  incomingConversationLinks?: ModdleElement<BpmnConversationLink>[];
  outgoingConversationLinks?: ModdleElement<BpmnConversationLink>[];
}

export interface BpmnParticipant extends BpmnInteractionNode, BpmnBaseElement {
  name?: string;
  interfaceRef?: ModdleElement<BpmnInterface>[];
  participantMultiplicity?: ModdleElement<BpmnParticipantMultiplicity>;
  endPointRefs?: ModdleElement<BpmnEndPoint>[];
  processRef?: ModdleElement<BpmnProcess>;
}

export interface BpmnParticipantAssociation extends BpmnBaseElement {
  innerParticipantRef?: ModdleElement<BpmnParticipant>;
  outerParticipantRef?: ModdleElement<BpmnParticipant>;
}

export interface BpmnParticipantMultiplicity extends BpmnBaseElement {
  minimum?: number;
  maximum?: number;
}

export interface BpmnCollaboration extends BpmnRootElement {
  name?: string;
  isClosed?: boolean;
  participants?: ModdleElement<BpmnParticipant>[];
  messageFlows?: ModdleElement<BpmnMessageFlow>[];
  artifacts?: ModdleElement<BpmnArtifact>[];
  conversations?: ModdleElement<BpmnConversationNode>[];
  conversationAssociations?: ModdleElement<BpmnConversationAssociation>;
  participantAssociations?: ModdleElement<BpmnParticipantAssociation>[];
  messageFlowAssociations?: ModdleElement<BpmnMessageFlowAssociation>[];
  correlationKeys?: ModdleElement<BpmnCorrelationKey>[];
  choreographyRef?: ModdleElement<BpmnChoreography>[];
  conversationLinks?: ModdleElement<BpmnConversationLink>[];
}

export interface BpmnChoreographyActivity extends BpmnFlowNode {
  participantRef?: ModdleElement<BpmnParticipant>[];
  initiatingParticipantRef?: ModdleElement<BpmnParticipant>;
  correlationKeys?: ModdleElement<BpmnCorrelationKey>[];
  loopType?: BpmnChoreographyLoopType;
}

export interface BpmnCallChoreography extends BpmnChoreographyActivity {
  calledChoreographyRef?: ModdleElement<BpmnChoreography>;
  participantAssociations?: ModdleElement<BpmnParticipantAssociation>[];
}

export interface BpmnSubChoreography extends BpmnChoreographyActivity, BpmnFlowElementsContainer {
  artifacts?: ModdleElement<BpmnArtifact>[];
}

export interface BpmnChoreographyTask extends BpmnChoreographyActivity {
  messageFlowRef?: ModdleElement<BpmnMessageFlow>[];
}

export interface BpmnChoreography extends BpmnCollaboration, BpmnFlowElementsContainer {
}

export interface BpmnGlobalChoreographyTask extends BpmnChoreography {
  initiatingParticipantRef?: ModdleElement<BpmnParticipant>;
}

export interface BpmnTextAnnotation extends BpmnArtifact {
  text?: string;
  textFormat?: string;
}

export interface BpmnGroup extends BpmnArtifact {
  categoryValueRef?: ModdleElement<BpmnCategoryValue>;
}

export interface BpmnAssociation extends BpmnArtifact {
  associationDirection?: BpmnAssociationDirection;
  sourceRef?: ModdleElement<BpmnBaseElement>;
  targetRef?: ModdleElement<BpmnBaseElement>;
}

export interface BpmnCategory extends BpmnRootElement {
  categoryValue?: ModdleElement<BpmnCategoryValue>[];
  name?: string;
}

export interface BpmnArtifact extends BpmnBaseElement {
}

export interface BpmnCategoryValue extends BpmnBaseElement {
  categorizedFlowElements?: ModdleElement<BpmnFlowElement>[];
  value?: string;
}

export interface BpmnActivity extends BpmnFlowNode {
  isForCompensation?: boolean;
  default?: ModdleElement<BpmnSequenceFlow>;
  ioSpecification?: ModdleElement<BpmnInputOutputSpecification>;
  boundaryEventRefs?: ModdleElement<BpmnBoundaryEvent>[];
  properties?: ModdleElement<BpmnProperty>[];
  dataInputAssociations?: ModdleElement<BpmnDataInputAssociation>[];
  dataOutputAssociations?: ModdleElement<BpmnDataOutputAssociation>[];
  startQuantity?: number;
  resources?: ModdleElement<BpmnResourceRole>[];
  completionQuantity?: number;
  loopCharacteristics?: ModdleElement<BpmnLoopCharacteristics>;
}

export interface BpmnServiceTask extends BpmnTask {
  implementation?: string;
  operationRef?: ModdleElement<BpmnOperation>;
}

export interface BpmnSubProcess extends BpmnActivity, BpmnFlowElementsContainer, BpmnInteractionNode {
  triggeredByEvent?: boolean;
  artifacts?: ModdleElement<BpmnArtifact>[];
}

export interface BpmnLoopCharacteristics extends BpmnBaseElement {
}

export interface BpmnMultiInstanceLoopCharacteristics extends BpmnLoopCharacteristics {
  isSequential?: boolean;
  behavior?: BpmnMultiInstanceBehavior;
  loopCardinality?: ModdleElement<BpmnExpression>;
  loopDataInputRef?: ModdleElement<BpmnItemAwareElement>;
  loopDataOutputRef?: ModdleElement<BpmnItemAwareElement>;
  inputDataItem?: ModdleElement<BpmnDataInput>;
  outputDataItem?: ModdleElement<BpmnDataOutput>;
  complexBehaviorDefinition?: ModdleElement<BpmnComplexBehaviorDefinition>[];
  completionCondition?: ModdleElement<BpmnExpression>;
  oneBehaviorEventRef?: ModdleElement<BpmnEventDefinition>;
  noneBehaviorEventRef?: ModdleElement<BpmnEventDefinition>;
}

export interface BpmnStandardLoopCharacteristics extends BpmnLoopCharacteristics {
  testBefore?: boolean;
  loopCondition?: ModdleElement<BpmnExpression>;
  loopMaximum?: number;
}

export interface BpmnCallActivity extends BpmnActivity, BpmnInteractionNode {
  calledElement?: string;
}

export interface BpmnTask extends BpmnActivity, BpmnInteractionNode {
}

export interface BpmnSendTask extends BpmnTask {
  implementation?: string;
  operationRef?: ModdleElement<BpmnOperation>;
  messageRef?: ModdleElement<BpmnMessage>;
}

export interface BpmnReceiveTask extends BpmnTask {
  implementation?: string;
  instantiate?: boolean;
  operationRef?: ModdleElement<BpmnOperation>;
  messageRef?: ModdleElement<BpmnMessage>;
}

export interface BpmnScriptTask extends BpmnTask {
  scriptFormat?: string;
  script?: string;
}

export interface BpmnBusinessRuleTask extends BpmnTask {
  implementation?: string;
}

export interface BpmnAdHocSubProcess extends BpmnSubProcess {
  completionCondition?: ModdleElement<BpmnExpression>;
  ordering?: BpmnAdHocOrdering;
  cancelRemainingInstances?: boolean;
}

export interface BpmnTransaction extends BpmnSubProcess {
  protocol?: string;
  method?: string;
}

export interface BpmnGlobalScriptTask extends BpmnGlobalTask {
  scriptLanguage?: string;
  script?: string;
}

export interface BpmnGlobalBusinessRuleTask extends BpmnGlobalTask {
  implementation?: string;
}

export interface BpmnComplexBehaviorDefinition extends BpmnBaseElement {
  condition?: ModdleElement<BpmnFormalExpression>;
  event?: ModdleElement<BpmnImplicitThrowEvent>;
}

export interface BpmnResourceRole extends BpmnBaseElement {
  resourceRef?: ModdleElement<BpmnResource>;
  resourceParameterBindings?: ModdleElement<BpmnResourceParameterBinding>[];
  resourceAssignmentExpression?: ModdleElement<BpmnResourceAssignmentExpression>;
  name?: string;
}

export interface BpmnResourceParameterBinding extends BpmnBaseElement {
  expression?: ModdleElement<BpmnExpression>;
  parameterRef?: ModdleElement<BpmnResourceParameter>;
}

export interface BpmnResourceAssignmentExpression extends BpmnBaseElement {
  expression?: ModdleElement<BpmnExpression>;
}

export interface BpmnImport {
  importType?: string;
  location?: string;
  namespace?: string;
}

export interface BpmnDefinitions extends BpmnBaseElement {
  name?: string;
  targetNamespace?: string;
  expressionLanguage?: string;
  typeLanguage?: string;
  imports?: ModdleElement<BpmnImport>[];
  extensions?: ModdleElement<BpmnExtension>[];
  rootElements?: ModdleElement<BpmnRootElement>[];
  diagrams?: ModdleElement<BpmndiBPMNDiagram>[];
  exporter?: string;
  relationships?: ModdleElement<BpmnRelationship>[];
  exporterVersion?: string;
}

export interface BpmnModdleTypeMap {
  'bpmn:Interface': ModdleElement<BpmnInterface> & { $type: 'bpmn:Interface' };
  'bpmn:Operation': ModdleElement<BpmnOperation> & { $type: 'bpmn:Operation' };
  'bpmn:EndPoint': ModdleElement<BpmnEndPoint> & { $type: 'bpmn:EndPoint' };
  'bpmn:Auditing': ModdleElement<BpmnAuditing> & { $type: 'bpmn:Auditing' };
  'bpmn:GlobalTask': ModdleElement<BpmnGlobalTask> & { $type: 'bpmn:GlobalTask' };
  'bpmn:Monitoring': ModdleElement<BpmnMonitoring> & { $type: 'bpmn:Monitoring' };
  'bpmn:Performer': ModdleElement<BpmnPerformer> & { $type: 'bpmn:Performer' };
  'bpmn:Process': ModdleElement<BpmnProcess> & { $type: 'bpmn:Process' };
  'bpmn:LaneSet': ModdleElement<BpmnLaneSet> & { $type: 'bpmn:LaneSet' };
  'bpmn:Lane': ModdleElement<BpmnLane> & { $type: 'bpmn:Lane' };
  'bpmn:GlobalManualTask': ModdleElement<BpmnGlobalManualTask> & { $type: 'bpmn:GlobalManualTask' };
  'bpmn:ManualTask': ModdleElement<BpmnManualTask> & { $type: 'bpmn:ManualTask' };
  'bpmn:UserTask': ModdleElement<BpmnUserTask> & { $type: 'bpmn:UserTask' };
  'bpmn:Rendering': ModdleElement<BpmnRendering> & { $type: 'bpmn:Rendering' };
  'bpmn:HumanPerformer': ModdleElement<BpmnHumanPerformer> & { $type: 'bpmn:HumanPerformer' };
  'bpmn:PotentialOwner': ModdleElement<BpmnPotentialOwner> & { $type: 'bpmn:PotentialOwner' };
  'bpmn:GlobalUserTask': ModdleElement<BpmnGlobalUserTask> & { $type: 'bpmn:GlobalUserTask' };
  'bpmn:Gateway': ModdleElement<BpmnGateway> & { $type: 'bpmn:Gateway' };
  'bpmn:EventBasedGateway': ModdleElement<BpmnEventBasedGateway> & { $type: 'bpmn:EventBasedGateway' };
  'bpmn:ComplexGateway': ModdleElement<BpmnComplexGateway> & { $type: 'bpmn:ComplexGateway' };
  'bpmn:ExclusiveGateway': ModdleElement<BpmnExclusiveGateway> & { $type: 'bpmn:ExclusiveGateway' };
  'bpmn:InclusiveGateway': ModdleElement<BpmnInclusiveGateway> & { $type: 'bpmn:InclusiveGateway' };
  'bpmn:ParallelGateway': ModdleElement<BpmnParallelGateway> & { $type: 'bpmn:ParallelGateway' };
  'bpmn:RootElement': ModdleElement<BpmnRootElement> & { $type: 'bpmn:RootElement' };
  'bpmn:Relationship': ModdleElement<BpmnRelationship> & { $type: 'bpmn:Relationship' };
  'bpmn:BaseElement': ModdleElement<BpmnBaseElement> & { $type: 'bpmn:BaseElement' };
  'bpmn:Extension': ModdleElement<BpmnExtension> & { $type: 'bpmn:Extension' };
  'bpmn:ExtensionDefinition': ModdleElement<BpmnExtensionDefinition> & { $type: 'bpmn:ExtensionDefinition' };
  'bpmn:ExtensionAttributeDefinition': ModdleElement<BpmnExtensionAttributeDefinition> & { $type: 'bpmn:ExtensionAttributeDefinition' };
  'bpmn:ExtensionElements': ModdleElement<BpmnExtensionElements> & { $type: 'bpmn:ExtensionElements' };
  'bpmn:Documentation': ModdleElement<BpmnDocumentation> & { $type: 'bpmn:Documentation' };
  'bpmn:Event': ModdleElement<BpmnEvent> & { $type: 'bpmn:Event' };
  'bpmn:IntermediateCatchEvent': ModdleElement<BpmnIntermediateCatchEvent> & { $type: 'bpmn:IntermediateCatchEvent' };
  'bpmn:IntermediateThrowEvent': ModdleElement<BpmnIntermediateThrowEvent> & { $type: 'bpmn:IntermediateThrowEvent' };
  'bpmn:EndEvent': ModdleElement<BpmnEndEvent> & { $type: 'bpmn:EndEvent' };
  'bpmn:StartEvent': ModdleElement<BpmnStartEvent> & { $type: 'bpmn:StartEvent' };
  'bpmn:ThrowEvent': ModdleElement<BpmnThrowEvent> & { $type: 'bpmn:ThrowEvent' };
  'bpmn:CatchEvent': ModdleElement<BpmnCatchEvent> & { $type: 'bpmn:CatchEvent' };
  'bpmn:BoundaryEvent': ModdleElement<BpmnBoundaryEvent> & { $type: 'bpmn:BoundaryEvent' };
  'bpmn:EventDefinition': ModdleElement<BpmnEventDefinition> & { $type: 'bpmn:EventDefinition' };
  'bpmn:CancelEventDefinition': ModdleElement<BpmnCancelEventDefinition> & { $type: 'bpmn:CancelEventDefinition' };
  'bpmn:ErrorEventDefinition': ModdleElement<BpmnErrorEventDefinition> & { $type: 'bpmn:ErrorEventDefinition' };
  'bpmn:TerminateEventDefinition': ModdleElement<BpmnTerminateEventDefinition> & { $type: 'bpmn:TerminateEventDefinition' };
  'bpmn:EscalationEventDefinition': ModdleElement<BpmnEscalationEventDefinition> & { $type: 'bpmn:EscalationEventDefinition' };
  'bpmn:Escalation': ModdleElement<BpmnEscalation> & { $type: 'bpmn:Escalation' };
  'bpmn:CompensateEventDefinition': ModdleElement<BpmnCompensateEventDefinition> & { $type: 'bpmn:CompensateEventDefinition' };
  'bpmn:TimerEventDefinition': ModdleElement<BpmnTimerEventDefinition> & { $type: 'bpmn:TimerEventDefinition' };
  'bpmn:LinkEventDefinition': ModdleElement<BpmnLinkEventDefinition> & { $type: 'bpmn:LinkEventDefinition' };
  'bpmn:MessageEventDefinition': ModdleElement<BpmnMessageEventDefinition> & { $type: 'bpmn:MessageEventDefinition' };
  'bpmn:ConditionalEventDefinition': ModdleElement<BpmnConditionalEventDefinition> & { $type: 'bpmn:ConditionalEventDefinition' };
  'bpmn:SignalEventDefinition': ModdleElement<BpmnSignalEventDefinition> & { $type: 'bpmn:SignalEventDefinition' };
  'bpmn:Signal': ModdleElement<BpmnSignal> & { $type: 'bpmn:Signal' };
  'bpmn:ImplicitThrowEvent': ModdleElement<BpmnImplicitThrowEvent> & { $type: 'bpmn:ImplicitThrowEvent' };
  'bpmn:DataState': ModdleElement<BpmnDataState> & { $type: 'bpmn:DataState' };
  'bpmn:ItemAwareElement': ModdleElement<BpmnItemAwareElement> & { $type: 'bpmn:ItemAwareElement' };
  'bpmn:DataAssociation': ModdleElement<BpmnDataAssociation> & { $type: 'bpmn:DataAssociation' };
  'bpmn:DataInput': ModdleElement<BpmnDataInput> & { $type: 'bpmn:DataInput' };
  'bpmn:DataOutput': ModdleElement<BpmnDataOutput> & { $type: 'bpmn:DataOutput' };
  'bpmn:InputSet': ModdleElement<BpmnInputSet> & { $type: 'bpmn:InputSet' };
  'bpmn:OutputSet': ModdleElement<BpmnOutputSet> & { $type: 'bpmn:OutputSet' };
  'bpmn:Property': ModdleElement<BpmnProperty> & { $type: 'bpmn:Property' };
  'bpmn:DataInputAssociation': ModdleElement<BpmnDataInputAssociation> & { $type: 'bpmn:DataInputAssociation' };
  'bpmn:DataOutputAssociation': ModdleElement<BpmnDataOutputAssociation> & { $type: 'bpmn:DataOutputAssociation' };
  'bpmn:InputOutputSpecification': ModdleElement<BpmnInputOutputSpecification> & { $type: 'bpmn:InputOutputSpecification' };
  'bpmn:DataObject': ModdleElement<BpmnDataObject> & { $type: 'bpmn:DataObject' };
  'bpmn:InputOutputBinding': ModdleElement<BpmnInputOutputBinding> & { $type: 'bpmn:InputOutputBinding' };
  'bpmn:Assignment': ModdleElement<BpmnAssignment> & { $type: 'bpmn:Assignment' };
  'bpmn:DataStore': ModdleElement<BpmnDataStore> & { $type: 'bpmn:DataStore' };
  'bpmn:DataStoreReference': ModdleElement<BpmnDataStoreReference> & { $type: 'bpmn:DataStoreReference' };
  'bpmn:DataObjectReference': ModdleElement<BpmnDataObjectReference> & { $type: 'bpmn:DataObjectReference' };
  'bpmn:ConversationLink': ModdleElement<BpmnConversationLink> & { $type: 'bpmn:ConversationLink' };
  'bpmn:ConversationAssociation': ModdleElement<BpmnConversationAssociation> & { $type: 'bpmn:ConversationAssociation' };
  'bpmn:CallConversation': ModdleElement<BpmnCallConversation> & { $type: 'bpmn:CallConversation' };
  'bpmn:Conversation': ModdleElement<BpmnConversation> & { $type: 'bpmn:Conversation' };
  'bpmn:SubConversation': ModdleElement<BpmnSubConversation> & { $type: 'bpmn:SubConversation' };
  'bpmn:ConversationNode': ModdleElement<BpmnConversationNode> & { $type: 'bpmn:ConversationNode' };
  'bpmn:GlobalConversation': ModdleElement<BpmnGlobalConversation> & { $type: 'bpmn:GlobalConversation' };
  'bpmn:PartnerEntity': ModdleElement<BpmnPartnerEntity> & { $type: 'bpmn:PartnerEntity' };
  'bpmn:PartnerRole': ModdleElement<BpmnPartnerRole> & { $type: 'bpmn:PartnerRole' };
  'bpmn:CorrelationProperty': ModdleElement<BpmnCorrelationProperty> & { $type: 'bpmn:CorrelationProperty' };
  'bpmn:Error': ModdleElement<BpmnError> & { $type: 'bpmn:Error' };
  'bpmn:CorrelationKey': ModdleElement<BpmnCorrelationKey> & { $type: 'bpmn:CorrelationKey' };
  'bpmn:Expression': ModdleElement<BpmnExpression> & { $type: 'bpmn:Expression' };
  'bpmn:FormalExpression': ModdleElement<BpmnFormalExpression> & { $type: 'bpmn:FormalExpression' };
  'bpmn:Message': ModdleElement<BpmnMessage> & { $type: 'bpmn:Message' };
  'bpmn:ItemDefinition': ModdleElement<BpmnItemDefinition> & { $type: 'bpmn:ItemDefinition' };
  'bpmn:FlowElement': ModdleElement<BpmnFlowElement> & { $type: 'bpmn:FlowElement' };
  'bpmn:SequenceFlow': ModdleElement<BpmnSequenceFlow> & { $type: 'bpmn:SequenceFlow' };
  'bpmn:FlowElementsContainer': ModdleElement<BpmnFlowElementsContainer> & { $type: 'bpmn:FlowElementsContainer' };
  'bpmn:CallableElement': ModdleElement<BpmnCallableElement> & { $type: 'bpmn:CallableElement' };
  'bpmn:FlowNode': ModdleElement<BpmnFlowNode> & { $type: 'bpmn:FlowNode' };
  'bpmn:CorrelationPropertyRetrievalExpression': ModdleElement<BpmnCorrelationPropertyRetrievalExpression> & { $type: 'bpmn:CorrelationPropertyRetrievalExpression' };
  'bpmn:CorrelationPropertyBinding': ModdleElement<BpmnCorrelationPropertyBinding> & { $type: 'bpmn:CorrelationPropertyBinding' };
  'bpmn:Resource': ModdleElement<BpmnResource> & { $type: 'bpmn:Resource' };
  'bpmn:ResourceParameter': ModdleElement<BpmnResourceParameter> & { $type: 'bpmn:ResourceParameter' };
  'bpmn:CorrelationSubscription': ModdleElement<BpmnCorrelationSubscription> & { $type: 'bpmn:CorrelationSubscription' };
  'bpmn:MessageFlow': ModdleElement<BpmnMessageFlow> & { $type: 'bpmn:MessageFlow' };
  'bpmn:MessageFlowAssociation': ModdleElement<BpmnMessageFlowAssociation> & { $type: 'bpmn:MessageFlowAssociation' };
  'bpmn:InteractionNode': ModdleElement<BpmnInteractionNode> & { $type: 'bpmn:InteractionNode' };
  'bpmn:Participant': ModdleElement<BpmnParticipant> & { $type: 'bpmn:Participant' };
  'bpmn:ParticipantAssociation': ModdleElement<BpmnParticipantAssociation> & { $type: 'bpmn:ParticipantAssociation' };
  'bpmn:ParticipantMultiplicity': ModdleElement<BpmnParticipantMultiplicity> & { $type: 'bpmn:ParticipantMultiplicity' };
  'bpmn:Collaboration': ModdleElement<BpmnCollaboration> & { $type: 'bpmn:Collaboration' };
  'bpmn:ChoreographyActivity': ModdleElement<BpmnChoreographyActivity> & { $type: 'bpmn:ChoreographyActivity' };
  'bpmn:CallChoreography': ModdleElement<BpmnCallChoreography> & { $type: 'bpmn:CallChoreography' };
  'bpmn:SubChoreography': ModdleElement<BpmnSubChoreography> & { $type: 'bpmn:SubChoreography' };
  'bpmn:ChoreographyTask': ModdleElement<BpmnChoreographyTask> & { $type: 'bpmn:ChoreographyTask' };
  'bpmn:Choreography': ModdleElement<BpmnChoreography> & { $type: 'bpmn:Choreography' };
  'bpmn:GlobalChoreographyTask': ModdleElement<BpmnGlobalChoreographyTask> & { $type: 'bpmn:GlobalChoreographyTask' };
  'bpmn:TextAnnotation': ModdleElement<BpmnTextAnnotation> & { $type: 'bpmn:TextAnnotation' };
  'bpmn:Group': ModdleElement<BpmnGroup> & { $type: 'bpmn:Group' };
  'bpmn:Association': ModdleElement<BpmnAssociation> & { $type: 'bpmn:Association' };
  'bpmn:Category': ModdleElement<BpmnCategory> & { $type: 'bpmn:Category' };
  'bpmn:Artifact': ModdleElement<BpmnArtifact> & { $type: 'bpmn:Artifact' };
  'bpmn:CategoryValue': ModdleElement<BpmnCategoryValue> & { $type: 'bpmn:CategoryValue' };
  'bpmn:Activity': ModdleElement<BpmnActivity> & { $type: 'bpmn:Activity' };
  'bpmn:ServiceTask': ModdleElement<BpmnServiceTask> & { $type: 'bpmn:ServiceTask' };
  'bpmn:SubProcess': ModdleElement<BpmnSubProcess> & { $type: 'bpmn:SubProcess' };
  'bpmn:LoopCharacteristics': ModdleElement<BpmnLoopCharacteristics> & { $type: 'bpmn:LoopCharacteristics' };
  'bpmn:MultiInstanceLoopCharacteristics': ModdleElement<BpmnMultiInstanceLoopCharacteristics> & { $type: 'bpmn:MultiInstanceLoopCharacteristics' };
  'bpmn:StandardLoopCharacteristics': ModdleElement<BpmnStandardLoopCharacteristics> & { $type: 'bpmn:StandardLoopCharacteristics' };
  'bpmn:CallActivity': ModdleElement<BpmnCallActivity> & { $type: 'bpmn:CallActivity' };
  'bpmn:Task': ModdleElement<BpmnTask> & { $type: 'bpmn:Task' };
  'bpmn:SendTask': ModdleElement<BpmnSendTask> & { $type: 'bpmn:SendTask' };
  'bpmn:ReceiveTask': ModdleElement<BpmnReceiveTask> & { $type: 'bpmn:ReceiveTask' };
  'bpmn:ScriptTask': ModdleElement<BpmnScriptTask> & { $type: 'bpmn:ScriptTask' };
  'bpmn:BusinessRuleTask': ModdleElement<BpmnBusinessRuleTask> & { $type: 'bpmn:BusinessRuleTask' };
  'bpmn:AdHocSubProcess': ModdleElement<BpmnAdHocSubProcess> & { $type: 'bpmn:AdHocSubProcess' };
  'bpmn:Transaction': ModdleElement<BpmnTransaction> & { $type: 'bpmn:Transaction' };
  'bpmn:GlobalScriptTask': ModdleElement<BpmnGlobalScriptTask> & { $type: 'bpmn:GlobalScriptTask' };
  'bpmn:GlobalBusinessRuleTask': ModdleElement<BpmnGlobalBusinessRuleTask> & { $type: 'bpmn:GlobalBusinessRuleTask' };
  'bpmn:ComplexBehaviorDefinition': ModdleElement<BpmnComplexBehaviorDefinition> & { $type: 'bpmn:ComplexBehaviorDefinition' };
  'bpmn:ResourceRole': ModdleElement<BpmnResourceRole> & { $type: 'bpmn:ResourceRole' };
  'bpmn:ResourceParameterBinding': ModdleElement<BpmnResourceParameterBinding> & { $type: 'bpmn:ResourceParameterBinding' };
  'bpmn:ResourceAssignmentExpression': ModdleElement<BpmnResourceAssignmentExpression> & { $type: 'bpmn:ResourceAssignmentExpression' };
  'bpmn:Import': ModdleElement<BpmnImport> & { $type: 'bpmn:Import' };
  'bpmn:Definitions': ModdleElement<BpmnDefinitions> & { $type: 'bpmn:Definitions' };
}

declare module 'moddle' {
  interface ModdleTypeMap extends BpmnModdleTypeMap {}
}
