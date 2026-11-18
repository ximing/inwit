"""CSI observations against the isolated fake supplier only; never point at user localhost:5190."""
import sys,time,json,urllib.request
from browser_check import cua,js,mouse

def install_trace():
 return js('''(() => { if (location.origin !== 'http://127.0.0.1:5192') throw Error('isolated origin required');
 window.__streamTrace=[];window.__streamRequests=[];window.__streamOriginalFetch=window.fetch;
 window.fetch=async (...a)=>{const u=String(a[0]);window.__streamRequests.push({url:u,method:a[1]?.method??'GET',at:performance.now()});return window.__streamOriginalFetch(...a)};
 window.__streamObserver=new MutationObserver(()=>{const p=document.querySelector('.pdf-translation-popover');if(!p)return;const d=p.querySelector('[data-translation-draft]');const entry={at:performance.now(),draft:d?.textContent??null,text:p.textContent};if(JSON.stringify(entry).replace(/"at":[^,]+,/, '')!==window.__lastStreamEntry){window.__lastStreamEntry=JSON.stringify(entry).replace(/"at":[^,]+,/, '');window.__streamTrace.push(entry)}});
 window.__streamObserver.observe(document.body,{childList:true,subtree:true,characterData:true});return true;})()''')

def visible_targets():
 return js('''JSON.stringify([...document.querySelectorAll('button[aria-label^="查看第"]')].map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.pdfSegment,x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}}).filter(r=>r.x>0&&r.x<innerWidth&&r.y>80&&r.y<innerHeight-40))''')

def report():
 return js('JSON.stringify({trace:window.__streamTrace,requests:window.__streamRequests,visibility:document.visibilityState})')

if __name__=='__main__':
 print(json.dumps({'targets':visible_targets(),'observation':report()},ensure_ascii=False))
