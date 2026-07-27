#!/usr/bin/env python3
import sys
import fitz  # PyMuPDF

if len(sys.argv) < 2:
    print("")
    sys.exit(1)

pdf_path = sys.argv[1]

try:
    doc = fitz.open(pdf_path)
    text = ""

    for page_num in range(len(doc)):
        page = doc[page_num]
        text += page.get_text()

    print(text)
    doc.close()
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
