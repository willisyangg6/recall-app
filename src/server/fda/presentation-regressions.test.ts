/**
 * P2a exact consumer regressions, proven end to end against recorded OFFICIAL
 * announcements (listing row + page <main>, captured 2026-09-01 from fda.gov —
 * each fixture records its officialUrl). The simulator QA that triggered the
 * root-cause audit showed these exact failures; the fixtures pin the fixes at
 * full pipeline depth: raw announcement → parse → projectCase → shared
 * presentation contract.
 *
 *  - Crystal Temptations / Chocolatey Eyeballs: the consumer brand is
 *    "Little Temptations" (FDA's structured brand field); the legal firm
 *    issued the notice but is not the shelf identity.
 *  - LMSI LLC / Kofinas olive oil: brand "Kofinas", firm "LMSI" (an
 *    initialism, never "Lmsi"), and the unapproved-ingredient reason family
 *    with the exact required grammar.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { projectCase } from '../../domain/projection';
import { caseIdentity, conciseReasonLine, whereSoldModel } from '../../lib/recall-presentation';
import { buildConsumerCase } from '../../lib/consumer-projection';
import { buildWhatHappened } from '../../lib/what-happened';
import { parseFdaAnnouncement, slugFromPath, type FdaListingItem } from './parse';

interface RecordedAnnouncement {
  officialUrl: string;
  path: string;
  listing: FdaListingItem;
  mainHtml: string;
}

function recordedCase(fixture: string) {
  const recorded: RecordedAnnouncement = JSON.parse(
    readFileSync(`src/server/fda/fixtures/${fixture}`, 'utf8'),
  );
  const projection = projectCase([
    parseFdaAnnouncement({
      listing: recorded.listing,
      detailMainHtml: recorded.mainHtml,
      path: recorded.path,
    }),
  ]);
  const identity = caseIdentity(
    projection.brands ?? [],
    projection.recallingFirm.displayName,
    projection.title,
  );
  const happened = buildWhatHappened({
    title: projection.title,
    noticeType: projection.noticeType,
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmDisplayName: projection.recallingFirm.displayName,
    summaryText: projection.summaryText,
    productDescription: projection.productDescription ?? null,
    consumerBrand: identity.whatHappenedSubject,
  });
  return { projection, identity, happened };
}

test('recorded Chocolatey Eyeballs: brand identity, allergen grammar, one state list', () => {
  const { projection, identity, happened } = recordedCase(
    'announcement-crystal-temptations-chocolatey-eyeballs.json',
  );
  // Consumer brand vs legal firm — decided once, never conflated.
  assert.equal(identity.brand.text, 'Little Temptations');
  assert.equal(identity.legalFirm, 'Crystal Temptations');
  assert.equal(identity.whatHappenedSubject, 'Little Temptations');
  // The exact heading requirement (the size list stays until P2b).
  assert.match(happened.text, /^Little Temptations recalled Chocolatey Eyeballs/);
  assert.match(
    happened.text,
    /because the products may contain milk, an allergen that is not declared on the label\.$/,
  );
  // Home's reason line renders the same interpreted allergen family.
  assert.equal(
    conciseReasonLine({
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
    }),
    'Undeclared milk allergen.',
  );
  // 13 distribution states render as ONE full-name list — never "13 states."
  // beside the same names.
  const consumer = buildConsumerCase(projection, projection.affectedProducts);
  const sold = whereSoldModel(consumer.distribution);
  assert.equal(sold.states.length, 13);
  assert.ok(sold.lead.startsWith('Arizona,'), sold.lead);
  assert.ok(sold.lead.includes('Wyoming'), sold.lead);
  assert.ok(!sold.lead.includes('states.'), sold.lead);
});

test('recorded Kofinas olive oil: LMSI initialism, exact unapproved-ingredient grammar', () => {
  const { identity, happened } = recordedCase('announcement-lmsi-kofinas-garlic-olive-oil.json');
  assert.equal(identity.brand.text, 'Kofinas');
  // The legal firm survives as an initialism for official traceability —
  // "LMSI", never the un-shouted "Lmsi" — and is not the consumer subject.
  assert.equal(identity.legalFirm, 'LMSI');
  assert.equal(identity.whatHappenedSubject, 'Kofinas');
  // The exact required sentence frame and reason grammar (sizes until P2b).
  assert.match(
    happened.text,
    /^Kofinas recalled Garlic Mediterranean Infused Extra Virgin Olive Oil/,
  );
  assert.match(
    happened.text,
    /because it contains garlic essential oil that is not approved for culinary use\.$/,
  );
  assert.ok(!happened.text.includes('because of contains'), happened.text);
  assert.ok(!happened.text.includes('Lmsi'), happened.text);
});

const corpus: { path: string; listing: FdaListingItem; mainHtml: string }[] = JSON.parse(
  gunzipSync(readFileSync('src/server/fda/fixtures/qa-corpus.json.gz')).toString('utf8'),
);

function corpusHappened(fragment: string) {
  const entry = corpus.find((e) => slugFromPath(e.path).includes(fragment));
  assert.ok(entry, `corpus record missing: ${fragment}`);
  const projection = projectCase([
    parseFdaAnnouncement({
      listing: entry!.listing,
      detailMainHtml: entry!.mainHtml,
      path: entry!.path,
    }),
  ]);
  const identity = caseIdentity(
    projection.brands ?? [],
    projection.recallingFirm.displayName,
    projection.title,
  );
  return buildWhatHappened({
    title: projection.title,
    noticeType: projection.noticeType,
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmDisplayName: projection.recallingFirm.displayName,
    summaryText: projection.summaryText,
    productDescription: projection.productDescription ?? null,
    consumerBrand: identity.whatHappenedSubject,
  });
}

test('recorded Comforts/Kroger: the consumer brand is the What Happened subject', () => {
  const happened = corpusHappened('fda-alerts-consumers-recall-certain-comforts');
  assert.match(happened.text, /^Comforts recalled /);
  assert.ok(!happened.text.startsWith('Kroger'), happened.text);
});

/**
 * "because of <finite verb/clause>" can no longer be produced anywhere in the
 * recorded corpus — the malformed families the audit documented ("because of
 * contains…", "because of product did not…", "because of glass prone…").
 */
const MALFORMED_BECAUSE =
  /because of (?:contains?|is|are|was|were|has|have|had|does|do|did|not|may|might|must|can|could|will|would|shall|should|prone)\b/i;

test('corpus scan: no malformed because-clause survives in any What Happened', () => {
  let scanned = 0;
  for (const entry of corpus) {
    let projection;
    try {
      projection = projectCase([
        parseFdaAnnouncement({
          listing: entry.listing,
          detailMainHtml: entry.mainHtml,
          path: entry.path,
        }),
      ]);
    } catch {
      continue; // parse coverage is qa-harness's concern, not this scan's
    }
    const identity = caseIdentity(
      projection.brands ?? [],
      projection.recallingFirm.displayName,
      projection.title,
    );
    const happened = buildWhatHappened({
      title: projection.title,
      noticeType: projection.noticeType,
      reasonText: projection.reasonText,
      hazardCategory: projection.hazardCategory,
      pathogenOrAllergen: projection.pathogenOrAllergen,
      firmDisplayName: projection.recallingFirm.displayName,
      summaryText: projection.summaryText,
      productDescription: projection.productDescription ?? null,
      consumerBrand: identity.whatHappenedSubject,
    });
    scanned += 1;
    assert.doesNotMatch(
      happened.text,
      MALFORMED_BECAUSE,
      `${slugFromPath(entry.path)}: ${happened.text}`,
    );
    // A junk placeholder can never become a sentence subject.
    assert.doesNotMatch(happened.text, /^(?:No Brand Name|Multiple brand names|Various)\b/i);
  }
  assert.ok(scanned >= 155, `only ${scanned} corpus records scanned`);
});
