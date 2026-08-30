-- Product-visual provenance (C9) — purely additive.
--
-- product_visuals was built for one source (FSIS label PDFs rendered by
-- us), so its provenance was implicit. C9's imagery audit defined the
-- fields a visual row must be able to state for correctness and for any
-- FUTURE externally sourced image to be honest about itself:
--
--   provider      which system produced the image (implicit until now)
--   resolved_url  the URL that actually served the source bytes, when it
--                 differs from source_url (redirects, C9 URL repair)
--   gtin          the exact validated GTIN an external catalog image was
--                 matched on — never populated by fuzzy matching; official
--                 label renders carry NULL because their association is
--                 the recall notice itself, not an identifier lookup
--   confidence    how the image is associated with the recall
--   attribution   the exact attribution/license text a source requires us
--                 to display; NULL means none required (official works)
--
-- Every existing row keeps its meaning through the defaults: provider
-- 'fsis_label_pdf' and confidence 'official_source' are precisely what
-- all current rows are. No row is modified, no policy or grant changes,
-- RLS stays exactly as the product_visuals migration established it
-- (public read; writes via service role only). The columns are public
-- exactly as the rest of the row is — they describe public recall
-- imagery and can carry no secret.

alter table public.product_visuals
  add column provider text not null default 'fsis_label_pdf'
    check (provider in ('fsis_label_pdf', 'fda_announcement', 'catalog_exact_gtin')),
  add column resolved_url text,
  add column gtin text
    check (gtin is null or gtin ~ '^(\d{8}|\d{12}|\d{13}|\d{14})$'),
  add column confidence text not null default 'official_source'
    check (confidence in ('official_source', 'exact_gtin_match')),
  add column attribution text;

-- A catalog image without its identifier would be unauditable: the GTIN
-- (and the attribution its license demands) must arrive with the row.
alter table public.product_visuals
  add constraint product_visuals_catalog_requires_gtin
    check (provider <> 'catalog_exact_gtin' or gtin is not null);
