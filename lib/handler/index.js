import { default as attacherHandler } from './attachersHandler.js';
import { default as elementHandler } from './elementHandler.js';
import { default as outgoingHandler } from './outgoingHandler.js';
import { default as incomingHandler } from './incomingHandler.js';

export const handlers = [ elementHandler, outgoingHandler, incomingHandler, attacherHandler ];