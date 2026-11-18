import json,time,urllib.request
SESSION='inwit-pdf-acceptance'
def cua(action,args={}):
 req=urllib.request.Request('http://127.0.0.1:10088/command',json.dumps({'action':action,'args':args,'session':SESSION}).encode(),{'Content-Type':'application/json'})
 r=json.load(urllib.request.urlopen(req,timeout=30))
 if not r.get('success'): raise RuntimeError(r)
 return r['data']
def js(code):
 r=cua('evaluate',{'code':code});v=r.get('value');
 try:return json.loads(v)
 except:return v
def state():return json.load(urllib.request.urlopen('http://127.0.0.1:3020/api/__pdf-test/state'))
def mouse(x,y,count=1):
 for typ in ['mousePressed','mouseReleased']:cua('cdp',{'method':'Input.dispatchMouseEvent','params':{'type':typ,'x':x,'y':y,'button':'left','clickCount':count}})
def point(index):return js(f'(()=>{{const r=document.querySelectorAll("button[aria-label^=查看第]")[{index}].getBoundingClientRect();return JSON.stringify({{x:r.x+r.width/2,y:r.y+r.height/2}})}})()')
if __name__=='__main__':
 out=[]
 cua('click',{'selector':'button[aria-label="收起中文"]'})
 before=state()['calls'];p=point(2)
 for n in [1,2]:mouse(p['x'],p['y'],n);time.sleep(.08)
 time.sleep(.7);out.append({'case':'trusted double click <=400ms','before':before,'after':state()['calls']})
 for n in [1,2,3]:mouse(p['x'],p['y'],n);time.sleep(.07)
 time.sleep(.7);out.append({'case':'trusted triple click <=400ms','before':before,'after':state()['calls']})
 # Drag over real PDF line.
 cua('cdp',{'method':'Input.dispatchMouseEvent','params':{'type':'mousePressed','x':p['x']-40,'y':p['y'],'button':'left','clickCount':1}})
 cua('cdp',{'method':'Input.dispatchMouseEvent','params':{'type':'mouseMoved','x':p['x']+80,'y':p['y']+18,'button':'left','buttons':1}})
 cua('cdp',{'method':'Input.dispatchMouseEvent','params':{'type':'mouseReleased','x':p['x']+80,'y':p['y']+18,'button':'left','clickCount':1}})
 time.sleep(.7);out.append({'case':'trusted drag selection','before':before,'after':state()['calls'],'selectionUI':js('JSON.stringify(document.body.innerText.includes("翻译为中文"))')})
 print(json.dumps(out,ensure_ascii=False));open('scripts/pdf-translation-acceptance/browser-results.json','w').write(json.dumps(out,ensure_ascii=False,indent=2))
