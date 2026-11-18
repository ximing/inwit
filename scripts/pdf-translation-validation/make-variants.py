from pypdf import PdfReader,PdfWriter
from pypdf.generic import NameObject,FloatObject,RectangleObject
from PIL import Image
from reportlab.pdfgen import canvas
base='scripts/pdf-translation-validation/'
for rotation in [0,90,180,270]:
 p=PdfReader(base+'samples/attention.pdf').pages[1]
 p.cropbox=RectangleObject([30,40,580,750]);p[NameObject('/UserUnit')]=FloatObject(2)
 if rotation:p.rotate(rotation)
 w=PdfWriter();w.add_page(p);w.write(base+f'samples/crop-unit-rotate-{rotation}.pdf')
im=Image.open(base+'output/bert-2.png');c=canvas.Canvas(base+'samples/scanned-bert.pdf',pagesize=(612,792));c.drawImage(base+'output/bert-2.png',0,0,612,792);c.save()
