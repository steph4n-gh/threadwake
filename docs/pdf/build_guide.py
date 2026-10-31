from pathlib import Path
import hashlib
import json
import re
import shutil

import reportlab
from reportlab import rl_config
from reportlab.pdfbase.pdfmetrics import Font
rl_config.invariant = 1
from xml.sax.saxutils import escape

from lxml import html
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, Image, KeepTogether, PageBreak,
    PageTemplate, Paragraph, Preformatted, Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader
from PIL import Image as RasterImage

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'web'
SOURCE = WEB / 'guide.html'
BUILD = ROOT / 'build/pdf-review'
BUILD.mkdir(parents=True, exist_ok=True)
OUT = BUILD / 'threadwake-field-guide.pdf'
SOURCE_SHA = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
DOM = html.fromstring(SOURCE.read_bytes())
MAIN = DOM.xpath('//main')[0]
SECTIONS = MAIN.xpath('./section')
NAV = {a.get('href')[1:]: a.text_content().strip() for a in DOM.xpath('//nav[@aria-label="Guide contents"]//a')}

FONT_DIR = Path(reportlab.__file__).parent / 'fonts'
for name, filename in [('Body','Vera.ttf'),('BodyB','VeraBd.ttf'),('BodyI','VeraIt.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))
for name, face in [('Display','Times-Roman'),('DisplayB','Times-Bold'),('DisplayI','Times-Italic'),('Mono','Courier')]:
    pdfmetrics.registerFont(Font(name, face, 'WinAnsiEncoding'))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyB', italic='BodyI', boldItalic='BodyB')
pdfmetrics.registerFontFamily('Display', normal='Display', bold='DisplayB', italic='DisplayI', boldItalic='DisplayB')
pdfmetrics.registerFontFamily('Mono', normal='Mono', bold='Mono', italic='Mono', boldItalic='Mono')

INK = colors.HexColor('#203a3d')
MUTED = colors.HexColor('#516a6c')
PAPER = colors.HexColor('#f8f5ee')
TEAL = colors.HexColor('#123d43')
BRASS = colors.HexColor('#917344')
PALE = colors.HexColor('#eaf0ea')
LINE = colors.HexColor('#c9d4cb')
W, H = letter
LEFT, RIGHT, TOP, BOTTOM = 48, 48, 54, 46
CW = W - LEFT - RIGHT

def style(name, **kw):
    base = dict(fontName='Body', fontSize=11.1, leading=15.8, textColor=INK,
                spaceAfter=9, allowWidows=0, allowOrphans=0)
    base.update(kw)
    return ParagraphStyle(name, **base)

ST = {
    'body': style('body'),
    'small': style('small', fontSize=9.7, leading=13.6, textColor=MUTED),
    'caption': style('caption', fontSize=9.2, leading=12.8, textColor=MUTED, spaceBefore=6, spaceAfter=12),
    'colophon': style('colophon', fontSize=9.2, leading=12.5, textColor=MUTED, spaceAfter=6),
    'eyebrow': style('eyebrow', fontName='BodyB', fontSize=9.2, leading=12, textColor=BRASS, spaceBefore=0, spaceAfter=7, keepWithNext=True),
    'h2': style('h2', fontName='DisplayB', fontSize=27, leading=32, spaceAfter=17, keepWithNext=True),
    'h3': style('h3', fontName='DisplayB', fontSize=15, leading=20, spaceBefore=9, spaceAfter=8, keepWithNext=True),
    'step': style('step', fontName='BodyB', fontSize=11.5, leading=16, spaceBefore=5, spaceAfter=5, keepWithNext=True),
    'table': style('table', fontSize=10.2, leading=14),
    'tablehead': style('tablehead', fontName='BodyB', fontSize=10.2, leading=14, textColor=colors.white),
    'term': style('term', fontName='BodyB', fontSize=10.2, leading=14),
    'credit': style('credit', fontSize=9.8, leading=13.5),
    'creditterm': style('creditterm', fontName='BodyB', fontSize=9.8, leading=13.5),
    'crewbody': style('crewbody', fontSize=10.2, leading=14.2),
    'quote': style('quote', fontName='DisplayI', fontSize=10.2, leading=14, textColor=MUTED, spaceBefore=6),
    'covereye': style('covereye', fontName='BodyB', fontSize=10, leading=14, textColor=colors.HexColor('#d9c595'), spaceAfter=14),
    'coverh': style('coverh', fontName='DisplayB', fontSize=43, leading=48, textColor=colors.HexColor('#fbf2df'), spaceAfter=14),
    'coverlede': style('coverlede', fontSize=13, leading=19, textColor=colors.HexColor('#d9e6df'), spaceAfter=18),
    'covercaption': style('covercaption', fontSize=9.2, leading=13, textColor=colors.HexColor('#c4d7d0'), spaceBefore=7),
    'toc': style('toc', fontSize=11.1, leading=18, spaceAfter=3),
}

def clean(s):
    return s.translate(str.maketrans({'→':' -> ','↑':'','↓':'','↰':'','↱':'','✳':'','\u2010':'-','\u2011':'-','\u2012':'-','\u2013':'-','\u2014':'-','\u2212':'-','\u00a0':' '}))

def txt(node):
    return clean(' '.join(node.text_content().split()))

def inline(node):
    parts = [escape(clean(node.text or ''))]
    for child in node:
        inner = inline(child)
        tag = child.tag.lower() if isinstance(child.tag, str) else ''
        if tag in ('b','strong'): inner = '<b>' + inner + '</b>'
        elif tag in ('i','em'): inner = '<i>' + inner + '</i>'
        elif tag in ('code','kbd'): inner = '<font face="Mono">' + inner + '</font>'
        elif tag == 'br': inner = '<br/>'
        elif tag == 'a' and child.get('href'):
            href = child.get('href')
            if href.startswith('#') and href[1:] == 'welcome': href = '#welcome'
            inner = '<link href="' + escape(href, {'"':'&quot;'}) + '" color="#315e61">' + inner + '</link>'
        parts += [inner, escape(clean(child.tail or ''))]
    return ''.join(parts)

def para(node, kind='body'):
    return Paragraph(inline(node), ST[kind])

class Heading(Paragraph):
    def __init__(self, text, key, toc_label=None, level=0, kind='h2', markup=False):
        super().__init__(clean(text) if markup else escape(clean(text)), ST[kind])
        self.key, self.toc_label, self.level = key, toc_label, level

class GuideDoc(BaseDocTemplate):
    def beforeDocument(self):
        self.current_chapter = 'THE LAST CROSSING'

    def afterFlowable(self, flowable):
        if isinstance(flowable, Heading):
            self.canv.bookmarkPage(flowable.key)
            self.canv.addOutlineEntry(clean(flowable.toc_label or flowable.getPlainText()), flowable.key, flowable.level, False)
            self.current_chapter = clean(flowable.toc_label or flowable.getPlainText())
            if flowable.toc_label:
                self.notify('TOCEntry', (0, clean(flowable.toc_label), self.page, flowable.key))

def page_start(c, doc):
    c.saveState()
    c.setFillColor(TEAL if doc.page == 1 else PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.restoreState()

def page_end(c, doc):
    c.saveState()
    if doc.page > 1:
        c.setStrokeColor(LINE); c.setLineWidth(.6); c.line(LEFT, H-35, W-RIGHT, H-35)
        c.setFillColor(MUTED); c.setFont('BodyB', 8)
        c.drawString(LEFT, H-25, 'THREADWAKE  /  THE PLAYER’S FIELD GUIDE')
    c.setFont('Body', 8.2)
    c.setFillColor(colors.HexColor('#c4d7d0') if doc.page == 1 else MUTED)
    c.drawString(LEFT, 25, 'THE LAST CROSSING' if doc.page == 1 else 'Threadwake · Player’s field guide')
    c.drawRightString(W-RIGHT, 25, f'{doc.page:02d}')
    c.restoreState()

def note(node):
    content = [para(p) for p in node if p.tag == 'p']
    t = Table([[content]], colWidths=[CW], hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.5,LINE),
                          ('LINEBEFORE',(0,0),(0,-1),2,BRASS),('LEFTPADDING',(0,0),(-1,-1),12),
                          ('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),11),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
    return [t, Spacer(1, 10)]

def definition_table(node):
    pairs=[]
    terms=node.xpath('./dt|./div/dt')
    credits=node.get('class')=='credits-list'
    for dt in terms:
        dd=dt.getnext()
        pairs.append([para(dt,'creditterm' if credits else 'term'), para(dd,'credit' if credits else 'table')])
    t=Table(pairs, colWidths=[125,CW-125], hAlign='LEFT')
    top, bottom = (3,2) if credits else (8,5)
    t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-1),.4,LINE),
                          ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(0,-1),14),
                          ('TOPPADDING',(0,0),(-1,-1),top),('BOTTOMPADDING',(0,0),(-1,-1),bottom)]))
    return [t,Spacer(1,10)]

def control_table(node):
    result=[]
    for cap in node.xpath('./caption'): result.append(para(cap,'caption'))
    rows=[]
    for tr in node.xpath('.//tr'):
        rows.append([para(td,'tablehead' if td.tag=='th' else 'table') for td in tr])
    t=Table(rows, colWidths=[150,CW-150],repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),TEAL),('VALIGN',(0,0),(-1,-1),'TOP'),
                          ('LINEBELOW',(0,1),(-1,-1),.4,LINE),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),
                          ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
                          ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    return result+[t,Spacer(1,12)]

def draw_paragraph(c,p,x,y,width):
    _,h=p.wrap(width,1000);p.drawOn(c,x,y-h);return h

class MapDiagram(Flowable):
    def __init__(self,node): super().__init__();self.node=node;self.width=CW;self.height=250
    def draw(self):
        c=self.canv;w,h=self.width,self.height
        c.setFillColor(PALE);c.roundRect(0,0,w,h,6,fill=1,stroke=0)
        sx,sy=w/640,h/390
        svg=self.node.xpath('./svg')[0]
        hub_label=txt(svg.xpath('.//text[@y="190"]')[0])
        hub_radius=pdfmetrics.stringWidth(hub_label,'BodyB',9.8)/2+5
        c.setStrokeColor(colors.HexColor('#8fae9e'));c.setLineWidth(.8);c.setDash(3,4)
        for match in re.finditer(r'M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)',svg.xpath('.//path')[0].get('d')):
            a,b,d,e=map(float,match.groups());c.line(a*sx,h-b*sy,d*sx,h-e*sy)
        c.setDash();c.setStrokeColor(BRASS);c.setLineWidth(1)
        for o in svg.xpath('.//circle'):
            radius=float(o.get('r'))*.67
            if float(o.get('r'))>18:radius=max(radius,hub_radius)
            c.setFillColor(TEAL);c.circle(float(o.get('cx'))*sx,h-float(o.get('cy'))*sy,radius,fill=1,stroke=1)
        for o in svg.xpath('.//text'):
            center=float(o.get('y'))==190
            c.setFillColor(colors.white if center else INK);c.setFont('BodyB' if center else 'Body',9.8)
            c.drawCentredString(float(o.get('x'))*sx,h-float(o.get('y'))*sy,txt(o))

class FlowDiagram(Flowable):
    def __init__(self,node):
        super().__init__();self.width=CW;self.cards=[];self.cardw=(CW-24)/3
        for item in node.xpath('./div'):
            self.cards.append([para(item[0],'step'),para(item[1],'table')])
        self.height=max(sum(p.wrap(self.cardw-20,1000)[1]+5 for p in card) for card in self.cards)+25
    def draw(self):
        c=self.canv
        for i,card in enumerate(self.cards):
            x=i*(self.cardw+12);c.setFillColor(PALE);c.setStrokeColor(LINE);c.roundRect(x,0,self.cardw,self.height,5,fill=1,stroke=1)
            y=self.height-12
            for p in card:y-=draw_paragraph(c,p,x+10,y,self.cardw-20)+5
            if i<2:
                c.setStrokeColor(BRASS);c.setLineWidth(1);c.line(x+self.cardw+2,self.height/2,x+self.cardw+10,self.height/2)
                path=c.beginPath();path.moveTo(x+self.cardw+7,self.height/2+3);path.lineTo(x+self.cardw+10,self.height/2);path.lineTo(x+self.cardw+7,self.height/2-3);c.drawPath(path)

class BandDiagram(Flowable):
    def __init__(self,node):super().__init__();self.node=node;self.width=CW;self.height=125
    def draw(self):
        c=self.canv;c.setFillColor(PALE);c.roundRect(0,0,CW,125,5,fill=1,stroke=0)
        palette=['#a78340','#438f97','#b66b66']
        for i,row in enumerate(self.node.xpath('./div[@class="band"]')):
            label=txt(row.xpath('./span')[0]);value=float(re.search(r'([\d.]+)%',label).group(1))/100
            y=91-i*33;c.setFont('BodyB',10);c.setFillColor(INK);c.drawString(14,y,label)
            x,bw=150,CW-166;c.setFillColor(colors.HexColor('#d5dfd5'));c.roundRect(x,y-2,bw,12,3,fill=1,stroke=0)
            c.setFillColor(colors.HexColor(palette[i]));c.roundRect(x,y-2,bw*value,12,3,fill=1,stroke=0)

class TurnsDiagram(Flowable):
    def __init__(self,node):super().__init__();self.node=node;self.width=CW;self.height=145
    def draw(self):
        c=self.canv;cw=(CW-18)/4
        for i,item in enumerate(self.node.xpath('./div')):
            x=i*(cw+6);c.setFillColor(PALE);c.roundRect(x,0,cw,145,5,fill=1,stroke=0)
            cx,cy=x+cw/2,99;c.setStrokeColor(BRASS);c.setLineWidth(1.8)
            path=c.beginPath();path.moveTo(cx,cy-25);path.lineTo(cx,cy)
            end=[(cx,cy+26),(cx+28,cy),(cx+11,cy-25),(cx-28,cy)][i]
            if i==2:path.curveTo(cx,cy+21,cx+11,cy+21,cx+11,cy);path.lineTo(*end)
            else:path.lineTo(*end)
            c.drawPath(path)
            ex,ey=end;c.setFillColor(BRASS);arrow=c.beginPath()
            if i==0:points=[(ex,ey),(ex-4,ey-7),(ex+4,ey-7)]
            elif i==1:points=[(ex,ey),(ex-7,ey-4),(ex-7,ey+4)]
            elif i==2:points=[(ex,ey),(ex-4,ey+7),(ex+4,ey+7)]
            else:points=[(ex,ey),(ex+7,ey-4),(ex+7,ey+4)]
            arrow.moveTo(*points[0]);[arrow.lineTo(*p) for p in points[1:]];arrow.close();c.drawPath(arrow,fill=1,stroke=0)
            heading=Paragraph(escape(txt(item.xpath('./b')[0])),style('turnhead',fontName='BodyB',fontSize=10.4,leading=14,alignment=TA_CENTER))
            small=Paragraph(escape(txt(item.xpath('./small')[0])),style('turnsmall',fontSize=9.1,leading=12,alignment=TA_CENTER,textColor=MUTED))
            draw_paragraph(c,heading,x+5,58,cw-10);draw_paragraph(c,small,x+7,38,cw-14)

def crew_cards(node):
    cards=[];cardw=(CW-14)/2
    for fig in node.xpath('./figure'):
        cap=fig.xpath('./figcaption')[0];name=cap.xpath('./h3')[0];role=cap.xpath('./p[@class="role"]')[0]
        image=fig.xpath('./img')[0]
        with RasterImage.open(WEB/image.get('src')) as original: sw,sh=original.size
        scale=min(73/sw,73/sh)
        img=Image(str(WEB/image.get('src')),width=sw*scale,height=sh*scale,mask='auto')
        headline=[para(name,'h3'),para(role,'small')]
        body=cap.xpath('./p[not(@class)]')[0];quote=cap.xpath('./blockquote')[0]
        card=Table([[img,headline],[[para(body,'crewbody')],''],[[para(quote,'quote')],'']],colWidths=[83,cardw-103],hAlign='LEFT')
        card.setStyle(TableStyle([('SPAN',(0,1),(-1,1)),('SPAN',(0,2),(-1,2)),('VALIGN',(0,0),(-1,-1),'TOP'),
                                 ('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.5,LINE),
                                 ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
                                 ('TOPPADDING',(0,0),(-1,0),10),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
        cards.append(card)
    outer=Table([[cards[0],cards[1]],[cards[2],cards[3]]],colWidths=[CW/2,CW/2],hAlign='LEFT')
    outer.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),12)]))
    return [outer]

def parse(node):
    tag=node.tag;cl=node.get('class','')
    if tag=='p':return [para(node,'eyebrow' if cl=='eyebrow' else 'small' if cl=='small' else 'body')]
    if tag=='h3':
        return [Heading(txt(node),node.get('id'),None,1,kind='h3')] if node.get('id') else [para(node,'h3')]
    if tag=='table':return control_table(node)
    if tag=='dl':return definition_table(node)
    if tag=='pre':
        text=clean(node.text_content()).strip('\n');p=Preformatted(text,style('code',fontName='Mono',fontSize=8.8,leading=12,spaceAfter=0))
        box=Table([[p]],colWidths=[CW]);box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.5,LINE),('LEFTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]));return [box,Spacer(1,10)]
    if tag=='ol':
        result=[]
        for i,li in enumerate(node.xpath('./li'),1):
            title=li.xpath('./strong')[0];result.append(Paragraph(str(i)+'. '+inline(title),ST['step']))
            result += [para(p) for p in li.xpath('./p')]
        return result
    if tag=='details':
        question=Paragraph(inline(node.xpath('./summary')[0]),ST['step']);answer=[]
        for div in node.xpath('./div'):
            for child in div:answer+=parse(child)
        return [KeepTogether([question]+answer+[Spacer(1,5)])]
    if tag=='div' and cl=='note':return note(node)
    if tag=='div' and cl=='crew':return crew_cards(node)
    if tag=='figure':
        result=[]
        if node.xpath('./svg'):result.append(MapDiagram(node))
        elif node.xpath('./div[@class="flow"]'):result.append(FlowDiagram(node.xpath('./div[@class="flow"]')[0]))
        elif node.xpath('./div[@class="band"]'):
            result += [para(p,'eyebrow') for p in node.xpath('./p')];result.append(BandDiagram(node))
        elif node.xpath('./div[@class="turns"]'):result.append(TurnsDiagram(node.xpath('./div[@class="turns"]')[0]))
        result += [para(cap,'caption') for cap in node.xpath('./figcaption')];return result
    if tag=='div':
        return [flow for child in node for flow in parse(child)]
    return []

story=[]
cover=SECTIONS[0]
story.append(Spacer(1,4));story.append(para(cover.xpath('./p[@class="eyebrow"]')[0],'covereye'))
heading=Heading(inline(cover.xpath('./h1')[0]),'welcome',NAV['welcome'],kind='coverh',markup=True)
story.append(heading);story.append(para(cover.xpath('./p[@class="lede"]')[0],'coverlede'))
hero=cover.xpath('./figure/img')[0]
with RasterImage.open(WEB/hero.get('src')) as original: sw,sh=original.size
ratio=sh/sw
story.append(Image(str(WEB/hero.get('src')),width=CW,height=CW*ratio))
story.append(para(cover.xpath('./figure/figcaption')[0],'covercaption'));story.append(PageBreak())
story.append(Paragraph('Inside the field guide',ST['h2']))
toc=TableOfContents();toc.levelStyles=[ST['toc']];toc.dotsMinLevel=0
story.append(toc);story.append(Spacer(1,19))
intro=SECTIONS[1]
story.append(para(intro[0],'eyebrow'))
introhead=Heading(txt(intro[1]),'story-title',None,1,kind='h3');story.append(introhead)
for child in list(intro)[2:]:story += parse(child)

for section in SECTIONS[2:]:
    key=section.get('id')
    story.append(Spacer(1,20) if key in ('saves','installation') else PageBreak())
    story.append(para(section[0],'eyebrow'))
    story.append(Heading(txt(section[1]),key,NAV[key]))
    children=list(section)[2:]
    for child in children:story += parse(child)

footer=MAIN.xpath('./footer')[0]
story.append(Spacer(1,8))
for p in footer.xpath('./p'):
    # The linked contents already provide the printed edition's cover navigation.
    if p.xpath('./a[@href="#welcome"]'):continue
    story.append(para(p,'colophon'))

doc=GuideDoc(str(OUT),pagesize=letter,leftMargin=LEFT,rightMargin=RIGHT,topMargin=TOP,bottomMargin=BOTTOM,
             title='Threadwake - The Player’s Field Guide',author='Threadwake contributors',subject='Complete spoiler-free player field guide')
doc.addPageTemplates(PageTemplate(id='book',frames=[Frame(LEFT,BOTTOM,CW,H-TOP-BOTTOM,id='main',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=page_start,onPageEnd=page_end))
OUT.parent.mkdir(parents=True,exist_ok=True)
doc.multiBuild(story)

assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==SOURCE_SHA
reader=PdfReader(str(OUT));text='\n'.join(p.extract_text() for p in reader.pages)
(BUILD/'extracted.txt').write_text(text)
def normalized(s):return re.sub(r'\W+','',clean(s)).lower()
pdfn=normalized(text)
units=[]
for node in MAIN.xpath('.//p|.//h1|.//h2|.//h3|.//th|.//td|.//dt|.//dd|.//summary|.//blockquote|.//figcaption|.//pre'):
    if node.xpath('ancestor::*[@class="quick-links"]'):continue
    if node.tag=='p' and node.xpath('parent::footer') and node.xpath('./a[@href="#welcome"]'):continue
    # Portrait captions contain nested blocks already checked individually.
    if node.tag=='figcaption' and node.xpath('./h3'):continue
    value=txt(node)
    if node.tag=='h1':value='A light for the crossing.'
    if value:units.append({'tag':node.tag,'text':value,'present':normalized(value) in pdfn})
missing=[u for u in units if not u['present']]
required=['first-steps','controls','crew','world','machines','signals','instruments','water','saves','installation','troubleshooting','credits']
assert len(DOM.xpath('//section[@id="troubleshooting"]/details'))==11
receipt={'sourceHTMLSHA256':SOURCE_SHA,'sourceFile':'web/guide.html','pdfSHA256':hashlib.sha256(OUT.read_bytes()).hexdigest(),'pages':len(reader.pages),
         'canonicalUnitsChecked':len(units),'missingCanonicalUnits':missing,'twelveSections':[{'id':key,'heading':txt(MAIN.xpath('./section[@id="'+key+'"]')[0].xpath('./h2')[0]),'present':normalized(txt(MAIN.xpath('./section[@id="'+key+'"]')[0].xpath('./h2')[0])) in pdfn} for key in required],
         'faqQuestions':11,'allFAQAnswersExpanded':all(normalized(txt(n)) in pdfn for n in DOM.xpath('//section[@id="troubleshooting"]/details')),
         'fourCharacters':{name:name in text for name in ['Marin','Vale','Iona','Mara']},'bookmarks':len(reader.outline),
         'transform':'Canonical HTML paragraphs/tables/FAQ/credits used directly; dashes/arrows use portable ASCII. Navigation replaced by PDF contents/bookmarks; vector diagram text/data read from HTML. No narrative rewrite.',
         'art':{'hero':hero.get('src'),'portraits':[p.get('src') for p in MAIN.xpath('.//div[@class="crew"]//img')],'imageEditing':False},
         'glyphScan':{'replacementCharacters':text.count('\ufffd'),'blackSquares':text.count('\u25a0')},'visualReview':'PENDING rendered-page inspection'}
(BUILD/'content-check.json').write_text(json.dumps({'receipt':receipt,'units':units},indent=2)+'\n')
if missing:raise RuntimeError('Canonical text not found in PDF: '+str([u['text'][:100] for u in missing]))
assert all(s['present'] for s in receipt['twelveSections']) and receipt['allFAQAnswersExpanded']
assert all(receipt['fourCharacters'].values())
shutil.copy2(OUT,WEB/'threadwake-field-guide.pdf')
(BUILD/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:receipt[k] for k in ['pages','pdfSHA256','canonicalUnitsChecked','missingCanonicalUnits','faqQuestions','allFAQAnswersExpanded','fourCharacters','bookmarks']},indent=2))
