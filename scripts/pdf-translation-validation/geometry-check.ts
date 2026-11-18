import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getDocument} from '../../apps/server/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import {init} from '../../apps/web/node_modules/@embedpdf/pdfium/dist/index.js';
import {localToViewport,pdfToLocal,viewportToLocal} from '../../apps/server/src/documents/translation/geometry-logic.js';
import {parsePdfPage} from '../../apps/server/src/documents/translation/pdf-parser.js';
const m=await init({wasmBinary:fs.readFileSync('apps/web/node_modules/@embedpdf/pdfium/dist/pdfium.wasm')});m.FPDF_InitLibrary();
let assertions=0,maxError=0;
for(const rotation of [0,90,180,270]) {
 const bytes=fs.readFileSync(`scripts/pdf-translation-validation/samples/crop-unit-rotate-${rotation}.pdf`);
 const parsed=await parsePdfPage(bytes,0);const g=parsed.geometry;assert.equal(g.userUnit,2);
 const task=getDocument({data:new Uint8Array(bytes)});const doc=await task.promise;const p=await doc.getPage(1);
 const mem=m.pdfium.wasmExports.malloc(bytes.length);m.pdfium.HEAPU8.set(bytes,mem);const d=m.FPDF_LoadMemDocument(mem,bytes.length,'');const page=m.FPDF_LoadPage(d,0);const out=m.pdfium.wasmExports.malloc(8);
 for(const scale of [.5,1,2,3.25]) for(const extra of [0,90,180,270]) for(const raw of [{x:108,y:685.354},{x:400,y:200},{x:30,y:40}]) {
  const local=pdfToLocal(raw,g),v=localToViewport(local,g,scale,extra),back=viewportToLocal(v,g,scale,extra);
  assert.ok(Math.abs(back.x-local.x)<1e-8 && Math.abs(back.y-local.y)<1e-8);assertions++;
  const expected=p.getViewport({scale,rotation:(rotation+extra)%360}).convertToViewportPoint(raw.x,raw.y);
  assert.ok(Math.abs(v.x-expected[0])<1e-7 && Math.abs(v.y-expected[1])<1e-7);assertions++;
  // PDFium ignores UserUnit; supply native rotated dimensions and viewer rotation.
  const total=(rotation+extra)%180;const w=(total?g.height:g.width)/g.userUnit*scale,h=(total?g.width:g.height)/g.userUnit*scale;
  m.FPDF_PageToDevice(page,0,0,Math.round(w),Math.round(h),extra/90,raw.x,raw.y,out,out+4);
  const x=m.pdfium.getValue(out,'i32'),y=m.pdfium.getValue(out+4,'i32');const error=Math.max(Math.abs(x-v.x/g.userUnit),Math.abs(y-v.y/g.userUnit));maxError=Math.max(maxError,error);assert.ok(error<1.6);assertions++;
 }
 m.FPDF_ClosePage(page);m.FPDF_CloseDocument(d);m.pdfium.wasmExports.free(out);m.pdfium.wasmExports.free(mem);await task.destroy();
}
const scan=await parsePdfPage(fs.readFileSync('scripts/pdf-translation-validation/samples/scanned-bert.pdf'),0);assert.equal(scan.state,'no_text');assert.equal(scan.segments.length,0);assertions+=2;
m.FPDF_DestroyLibrary();console.log(JSON.stringify({assertions,maxPdfiumRoundingError:maxError,scan:scan.state},null,2));
