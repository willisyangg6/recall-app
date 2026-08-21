# FSIS fixtures

Real records from the official USDA FSIS Recall API
(`https://www.fsis.usda.gov/fsis/api/recall/v/1?field_translation_language=en`),
recorded verbatim on **2026-08-21**. Nothing in these files is invented; they
are checked in so the test suite is deterministic and never depends on live
FSIS access.

| File                                            | Record          | Why it is here                                                               |
| ----------------------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `recall-active-nationwide-017-2026.json`        | 017-2026        | Normal active recall, Class I, nationwide distribution                       |
| `recall-active-stated-states-016-2026.json`     | 016-2026        | Active recall with an explicit state list                                    |
| `recall-closed-parent-005-2026.json`            | 005-2026        | Closed recall; parent of an expansion; carries an in-place Editor's Note     |
| `recall-closed-expansion-005-2026-exp.json`     | 005-2026-EXP    | Expansion published as a new record with a suffixed number                   |
| `pha-active-nationwide-pha-08082026-01.json`    | PHA-08082026-01 | Public Health Alert (unclassified, empty product list)                       |
| `pha-retraction-pha-04012026-01.json`           | PHA-04012026-01 | Live-observed PHA retraction notice                                          |
| `recall-closed-unknown-geography-006-2025.json` | 006-2025        | Empty `field_states` (unknown geography) + HTML entity in establishment name |
| `recall-closed-dirty-number-034-2024.json`      | " 034-2024"     | Dirty recall number (leading whitespace)                                     |

Some tests derive "before" variants from these records (e.g. blanking the
classification to simulate the pre-classification state). Derivations happen in
test code, are clearly labeled, and are never displayed or persisted as recall
data.
