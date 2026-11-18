import json,subprocess
from PIL import Image,ImageDraw
pages={'attention':[2,4],'bert':[2,3],'resnet':[1,2],'adam':[1,2],'gpt3':[3,4],'lora':[1,2],'diffusion':[2,3],'clip':[2,3]}
for name,nums in pages.items():
 data=json.load(open(f'scripts/pdf-translation-validation/output/{name}.json'))
 for num in nums:
  prefix=f'scripts/pdf-translation-validation/output/{name}-{num}'
  subprocess.run(['pdftoppm','-f',str(num),'-l',str(num),'-scale-to','1400','-png','-singlefile',f'scripts/pdf-translation-validation/samples/{name}.pdf',prefix],check=True,stderr=subprocess.DEVNULL)
  im=Image.open(prefix+'.png');draw=ImageDraw.Draw(im);p=data[num-1];scale=im.width/p['geometry']['width'];h=p['geometry']['height']
  for s in p['segments']:
   if s['qualityState']!='reliable':continue
   for q in s['rects']:
    xs=[pt['x']*scale for pt in q];ys=[(h-pt['y'])*scale for pt in q];draw.rectangle((min(xs),min(ys),max(xs),max(ys)),outline=(0,130,50),width=1)
   q=s['rects'][0];draw.text((q[0]['x']*scale-20,(h-q[2]['y'])*scale),str(s['ordinal']),fill=(220,0,0))
  im.save(prefix+'-review.png')
