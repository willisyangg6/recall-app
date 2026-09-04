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

`announcement-<slug>.json` files are single recorded announcements (verbatim
listing row + page `<main>`, each stamped with its `capturedAt` date and
`officialUrl`) backing exact presentation regressions in
`presentation-regressions.test.ts`:

- `announcement-crystal-temptations-chocolatey-eyeballs.json` — brand vs
  legal-firm identity, allergen grammar (P2a).
- `announcement-lmsi-kofinas-garlic-olive-oil.json` — initialism firm name,
  unapproved-ingredient grammar, multi-size product description (P2a/P2b).
- `announcement-jaimes-spanish-village-jalapeno-ranch.json` — the P2b
  single-row Affected Products table: prose UPC + lot list with no size or
  date evidence (recorded 2026-09-02).

## Pinned production notices (P3B)

`hazard-metal-or-chemical-notices.json` is a different kind of fixture: it is
**not** a re-recorded page. It holds the three production notices the P3B
read-only audit of all 721 archived FDA source records (2026-09-03) found
misclassified under the disjunctive FDA reason category `Potential Metal or
Chemical Contaminant`, as **bounded official excerpts** — the packaging clause
that falsely triggered the old bare-keyword scan, and the clause that actually
states the hazard — each entry carrying its own `officialUrl` and a
`provenance` note saying exactly where its text came from. It backs
`src/server/fda/hazard-metal-or-chemical.test.ts` and the repair tests in
`src/server/fda-contaminant-repair.test.ts`, neither of which may branch on a
native id.

Nothing in it is invented. If a full page is ever recorded for one of these
notices, replace the excerpt with the recorded announcement rather than
extending the excerpt by hand.

Never hand-edit the recorded fixtures above; re-record from the live sources
instead.
