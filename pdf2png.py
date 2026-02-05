import argparse
import os
import fitz  # PyMuPDF

parser = argparse.ArgumentParser()
parser.add_argument("pdf")
parser.add_argument("--out", default="out/pages")
parser.add_argument("--dpi", type=int, default=250)
args = parser.parse_args()

os.makedirs(args.out, exist_ok=True)

doc = fitz.open(args.pdf)

zoom = args.dpi / 72.0
matrix = fitz.Matrix(zoom, zoom)

for i in range(doc.page_count):
    page = doc.load_page(i)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    path = os.path.join(args.out, f"page-{i+1:03d}.png")
    pix.save(path)
