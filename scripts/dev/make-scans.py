"""
Turns text PDFs into scans (image-only PDFs and JPG photos) for testing text
recognition through the app. Uses the degradations of ocr-experiment.py.

    python3 scripts/dev/make-scans.py <out-dir> <file.pdf> …

For every input file writes:
  <name>_scan.pdf    every page as a clean 200-dpi scan (no text layer)
  <name>_stamp.pdf   every page with a stamp, a signature, skew and blur
  <name>_photo.jpg   the first page as a poor phone photo (expected to fail the gate)
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'ocr-experiment.py'), encoding='utf-8').read().split('rows=[]')[0]
exec(src)  # render(), degrade()

import subprocess  # noqa: E402

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
os.makedirs('/tmp/ocr', exist_ok=True)
for pdf in sys.argv[2:]:
    name = os.path.splitext(os.path.basename(pdf))[0]
    n = int(next(l.split(':')[1] for l in subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout.splitlines() if l.startswith('Pages:')))
    pages = [render(pdf, p, 200) for p in range(1, n + 1)]
    for level, suffix in [(0, 'scan'), (1, 'stamp')]:
        imgs = [degrade(im.copy(), level).convert('RGB') for im in pages]
        imgs[0].save(os.path.join(out, f'{name}_{suffix}.pdf'), save_all=True, append_images=imgs[1:], resolution=200)
    degrade(pages[0].copy(), 2).convert('RGB').save(os.path.join(out, f'{name}_photo.jpg'), quality=60)
    print(name, n, 'pages')
