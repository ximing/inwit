import fs from 'node:fs';
import {init} from '../../apps/web/node_modules/@embedpdf/pdfium/dist/index.js';
const m=await init({wasmBinary:fs.readFileSync('apps/web/node_modules/@embedpdf/pdfium/dist/pdfium.wasm')});
m.FPDF_InitLibrary();
for(const name of process.argv.slice(2)) {
 const data=fs.readFileSync(name);const mem=m.pdfium.wasmExports.malloc(data.length);m.pdfium.HEAPU8.set(data,mem);
 const doc=m.FPDF_LoadMemDocument(mem,data.length,'');const page=m.FPDF_LoadPage(doc,0);
 const text=m.FPDFText_LoadPage(page);const rectCount=m.FPDFText_CountRects(text,0,-1);
 const size=m.pdfium.wasmExports.malloc(8);m.FPDF_GetPageSizeByIndexF(doc,0,size);
 const w=m.pdfium.getValue(size,'float'),h=m.pdfium.getValue(size+4,'float');
 const out=m.pdfium.wasmExports.malloc(32);const rects=[];
 for(let i=0;i<Math.min(rectCount,5);i++) {
  m.FPDFText_GetRect(text,i,out,out+8,out+16,out+24);
  const left=m.pdfium.getValue(out,'double'),top=m.pdfium.getValue(out+8,'double');
  const right=m.pdfium.getValue(out+16,'double'),bottom=m.pdfium.getValue(out+24,'double');
  m.FPDF_PageToDevice(page,0,0,w,h,0,left,top,out,out+4);
  rects.push({left,top,right,bottom,device:{x:m.pdfium.getValue(out,'i32'),y:m.pdfium.getValue(out+4,'i32')}});
 }
 console.log(JSON.stringify({name,w,h,rotation:m.FPDFPage_GetRotation(page),rectCount,rects}));
 m.FPDFText_ClosePage(text);m.FPDF_ClosePage(page);m.FPDF_CloseDocument(doc);m.pdfium.wasmExports.free(mem);m.pdfium.wasmExports.free(size);m.pdfium.wasmExports.free(out);
}
m.FPDF_DestroyLibrary();
