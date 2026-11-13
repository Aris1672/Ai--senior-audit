import sys, re, time, subprocess, random, io
from PIL import Image, ImageFilter, ImageDraw, ImageEnhance
import pytesseract
random.seed(7)
def render(pdf, page, dpi):
    subprocess.run(['pdftoppm','-png','-r',str(dpi),'-f',str(page),'-l',str(page),pdf,'/tmp/ocr/p'],check=True)
    import glob; f=sorted(glob.glob('/tmp/ocr/p*.png'))[-1]; im=Image.open(f).convert('RGB'); import os; os.remove(f); return im
def truth(pdf,page):
    return subprocess.run(['pdftotext','-f',str(page),'-l',str(page),'-layout',pdf,'-'],capture_output=True,text=True).stdout
def degrade(im, level):
    if level==0: return im
    w,h=im.size
    d=ImageDraw.Draw(im,'RGBA')
    # a round blue stamp over the lower text and a signature scribble
    cx,cy,r=int(w*0.62),int(h*0.36),int(w*0.085)
    for k in range(3): d.ellipse([cx-r+k*6,cy-r+k*6,cx+r-k*6,cy+r-k*6],outline=(30,50,170,170),width=4)
    d.text((cx-r//2,cy-10),'ООО ПЕЧАТЬ',fill=(30,50,170,170))
    pts=[(int(w*0.25)+i*14,int(h*0.40)+int(18*random.uniform(-1,1))) for i in range(18)]
    d.line(pts,fill=(20,20,120,200),width=3)
    im=im.rotate(1.3 if level==1 else 2.4,expand=True,fillcolor=(245,243,238))
    if level>=1:
        im=ImageEnhance.Contrast(im).enhance(0.8); im=im.filter(ImageFilter.GaussianBlur(0.7 if level==1 else 1.2))
    if level>=2:
        im=im.resize((int(im.width*0.62),int(im.height*0.62)))   # a phone photo / 120-dpi fax
        px=im.load()
        for _ in range(im.width*im.height//60):
            x,y=random.randrange(im.width),random.randrange(im.height); px[x,y]=(60,60,60)
        b=io.BytesIO(); im.save(b,'JPEG',quality=35); im=Image.open(io.BytesIO(b.getvalue()))
    return im
norm=lambda s: re.sub(r'\s+',' ',s.lower().replace('ё','е')).strip()
def tokens(s): return re.findall(r'[0-9a-zа-я№]+(?:[.,/\-][0-9a-zа-я]+)*', norm(s))
def amounts(s): return set(re.sub(r'\s','',m) for m in re.findall(r'\d{1,3}(?: \d{3})+,\d{2}|\d+,\d{2}', s))
def numbers(s): return set(re.findall(r'\b\d{4,}\b', s))
rows=[]
for pdf,page in [(a.split(':')[0],int(a.split(':')[1])) for a in sys.argv[1:]]:
    t=truth(pdf,page); tt=tokens(t)
    for level,name in [(0,'чистый скан 200 dpi'),(1,'скан с печатью, наклон, размытие'),(2,'плохое фото / факс')]:
        im=degrade(render(pdf,page,200),level)
        t0=time.time(); data=pytesseract.image_to_data(im,lang='rus+eng',config='--psm 6',output_type=pytesseract.Output.DICT); dt=time.time()-t0
        words=[w for w,c in zip(data['text'],data['conf']) if w.strip()]; confs=[float(c) for w,c in zip(data['text'],data['conf']) if w.strip()]
        o=' '.join(words); ot=set(tokens(o))
        recall=sum(1 for x in tt if x in ot)/max(1,len(tt))
        am_t,am_o=amounts(t),amounts(o); nu_t,nu_o=numbers(t),numbers(o)
        rows.append((pdf.split('/')[-1][:22],page,name,round(recall*100,1),f'{len(am_t&am_o)}/{len(am_t)}',f'{len(nu_t&nu_o)}/{len(nu_t)}',round(sum(confs)/max(1,len(confs))),round(dt,1), sorted(am_t-am_o)[:3]))
for r in rows: print(*r,sep=' | ')
