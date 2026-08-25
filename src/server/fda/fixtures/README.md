# Recorded real FDA fixtures

All fixtures were recorded verbatim from the official FDA sources on
**2026-08-21** (the automated test suite never touches the network):

- `listing-items.json` — raw items from the FDA listing JSON backend
  (`https://www.fda.gov/datatables-json/recalls-market-withdrawals.json`),
  exactly as served. Includes food-scoped announcements plus deliberate
  out-of-scope rows (a pet-food item tagged `Animal & Veterinary, Food &
Beverages`, a `Drugs` item, a `Medical Devices` item, and one with an empty
  product field) so category filtering is proven against real data.
- `pages/<slug>.html` — the `<main>` content region of each announcement
  detail page (`https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/<slug>`),
  the exact region the live fetcher extracts and the snapshot store preserves.
  Site chrome outside `<main>` (navigation, scripts) is not announcement
  content and is not retained.
- `food-rss.xml` — the food-safety recalls RSS feed
  (`https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/food-safety-recalls/rss.xml`).

The set was chosen to cover the consumer-meaningful shapes: pathogen
contamination (Salmonella, Listeria, C. botulinum), undeclared allergens
(single and multiple), foreign material, chemical contamination (lead,
radionuclides), explicit state lists, nationwide and unknown distribution,
explicit-zero / positive / absent illness statements, product code tables,
stated quantity, update-churn URL variants (`updated-…` replacing the original
listing row, `update-…` and `updated-release-…` coexisting with it), an
expansion published as a separate announcement, and an upstream-ingredient
recall.

Never hand-edit these files; re-record from the live sources instead.
