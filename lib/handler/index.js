import { default as attacherHandler } from './attachersHandler';
import { default as elementHandler } from './elementHandler';
import { default as outgoingHandler } from './outgoingHandler';

export const handlers = [ elementHandler, outgoingHandler, attacherHandler ];