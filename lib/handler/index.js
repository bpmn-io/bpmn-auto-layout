import { default as attacherHandler } from './attachersHandler.js';
import { default as elementHandler } from './elementHandler.js';
import { default as outgoingHandler } from './outgoingHandler.js';

export const handlers = [ elementHandler, outgoingHandler, attacherHandler ];