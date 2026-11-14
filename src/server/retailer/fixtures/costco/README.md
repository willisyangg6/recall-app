# Costco notice fixtures (recorded 2026-11-13)

Real public bytes, recorded once for offline tests. Nothing here is synthetic.

- `index.html` — the 11 React flight chunks (`self.__next_f.push`) of
  <https://www.costco.com/f/-/recalls> that carry the notice entries, copied
  byte-for-byte from the page fetched at 2026-11-13T20:51Z (the full page is
  2.2 MB of unrelated site chrome). It parses to the same 21 documents as the
  full page.
- `letters/*.pdf` — five member letters kept as the original PDF bytes because
  the PDF itself is under test: Whipped Cream `bltdc8f3dbbb7e4b836`, Tractor
  Wheels `blte87d0e2282b82829`, Little Giant ladders `blt810b89e5a5fbde2c`,
  Punahele (a scanned page) `blt875c3b1355914d97`, and Meatloaf (undated)
  `blta2c263db1a92d045`.
- `letters/*.txt` — the other 16 letters as text, produced by
  `extractPdfText` from the PDFs fetched the same day (the files are named by
  index entry id; `:` becomes `_`).
- `agency-cases.json` — every `recall_cases` row published on or after
  2025-09-01 (339 cases), read through the public read path. The four cases a
  Costco notice matches (`38c00154` Once Upon a Farm, `c4bc0caa` Champion
  Foods, `d5c52eb7` Punahele, `9c9edbd7` Ajinomoto) are complete; every other
  case keeps its full firm, brands, title, dates and geography, with its
  summary capped at 600 characters and at most 8 product lines of 300. Those
  are distractors. Because the cap trims text that product matching reads,
  this fixture is evidence for the outcomes the decision test pins, not for
  the full corpus; the full-corpus outcome is the dry run against production
  (docs/recall-retailer-notices.md).
