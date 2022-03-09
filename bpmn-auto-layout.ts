#!node

import * as fs from 'fs';

import * as AutoLayout from './lib/AutoLayout';

var diagramXML = fs.readFileSync(process.stdin.fd, 'utf-8');

var autoLayout = new AutoLayout();

async function layoutedDiagramXML (inXML) {
    const out = await autoLayout.layoutProcess(inXML);
    console.log(out);
}

layoutedDiagramXML(diagramXML);

