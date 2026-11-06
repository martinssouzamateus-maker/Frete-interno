"""Monta Index.html (arquivo único para colar no Apps Script) a partir de Index.src.html."""
import base64, io, os, sys
from PIL import Image
AQUI = os.path.dirname(os.path.abspath(__file__))
FLASK = sys.argv[1]
css = open(os.path.join(FLASK, 'static/style.css'), encoding='utf-8').read()
def b64(path, largura=None):
    im = Image.open(path)
    if largura: im.thumbnail((largura, largura * 4))
    im = im.convert('RGBA').quantize(colors=48, method=Image.Quantize.FASTOCTREE)
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode()
html = open(os.path.join(AQUI, 'Index.src.html'), encoding='utf-8').read()
html = html.replace('/*CSS*/', css).replace('/*LOGO*/', b64(os.path.join(FLASK, 'static/logo.png'), 360)) \
           .replace('/*GRAF*/', b64(os.path.join(FLASK, 'static/grafismo.png'), 420))
open(os.path.join(AQUI, '..', 'Index.html'), 'w', encoding='utf-8').write(html)
print('Index.html', len(html) // 1024, 'KB')
