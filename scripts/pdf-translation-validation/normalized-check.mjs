import fs from 'node:fs';
import {init} from '../../apps/web/node_modules/@embedpdf/pdfium/dist/index.js';
import {PdfiumNative} from '../../apps/web/node_modules/@embedpdf/engines/dist/lib/pdfium/index.js';
const m=await init({wasmBinary:fs.readFileSync('apps/web/node_modules/@embedpdf/pdfium/dist/pdfium.wasm')});
const engine=new PdfiumNative(m,{fontFallback:null});

const data=fs.readFileSync('scripts/pdf-translation-validation/samples/crop-unit-rotate-90.pdf');
const task=engine.openDocumentBuffer({id:'probe',content:data.buffer.slice(data.byteOffset,data.byteOffset+data.length)},{normalizeRotation:true});
const doc=await task.toPromise();console.log(JSON.stringify(doc));
console.log(JSON.stringify((await engine.getPageTextRects(doc,doc.pages[0]).toPromise()).slice(0,2)));

await engine.closeDocument(doc).toPromise();await engine.destroy().toPromise();
