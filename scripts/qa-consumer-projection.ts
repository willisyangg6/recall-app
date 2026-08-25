/**
 * Development-only consumer-projection QA report.
 *
 *   npm run qa:fda
 *
 * Runs Consumer Projection V2 over the recorded 160-announcement corpus, plus
 * the FSIS benchmark corpus, and prints violations grouped by cluster with
 * projection-quality metrics. This is the feedback loop that replaces
 * inspecting recalls one at a time: fix the cluster, re-run, watch the count
 * fall.
 *
 * Everything here is deterministic and offline — no model inference is
 * involved in the shipped runtime or in this report.
 */

import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

import { projectCase } from '../src/domain/projection';
import { auditConsumerCase, summarizeQa, type QaRecordResult } from '../src/lib/consumer-qa';
import { parseFdaAnnouncement, slugFromPath, type FdaListingItem } from '../src/server/fda/parse';
import { parseFsisRecord, type FsisRawRecord } from '../src/server/fsis/parse';

interface QaCorpusEntry {
  path: string;
  listing: FdaListingItem;
  mainHtml: string;
}

function loadFdaCorpus(): QaCorpusEntry[] {
  return JSON.parse(
    gunzipSync(readFileSync('src/server/fda/fixtures/qa-corpus.json.gz')).toString('utf8'),
  ) as QaCorpusEntry[];
}

function auditFda(): QaRecordResult[] {
  const results: QaRecordResult[] = [];
  for (const entry of loadFdaCorpus()) {
    try {
      const normalized = parseFdaAnnouncement({
        listing: entry.listing,
        detailMainHtml: entry.mainHtml,
        path: entry.path,
      });
      const projection = projectCase([normalized]);
      results.push(
        auditConsumerCase(
          slugFromPath(entry.path).slice(0, 44),
          projection,
          projection.affectedProducts,
        ),
      );
    } catch (error) {
      results.push({
        id: slugFromPath(entry.path).slice(0, 44),
        violations: [
          {
            rule: 'record-failed-to-parse',
            severity: 'critical',
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
        inventory: {
          total: 0,
          byDisposition: {
            retained: 0,
            normalized: 0,
            aggregated: 0,
            relationship_preserved: 0,
            suppressed: 0,
            projection_dropped: 0,
          },
        },
        signals: {
          photosInSource: 0,
          photosShown: 0,
          hasVariants: false,
          variantCount: 0,
          variantsWithIdentifiers: 0,
          orphanIdentifiers: 0,
          hasDates: false,
          hasUpc: false,
          hasLotCodes: false,
          codeDatePairsInSource: 0,
          codeDatePairsPreserved: 0,
          distributionKnown: false,
          retailersFound: 0,
          areasFound: 0,
          packageCoverage: 'source_silent',
          actionOrigin: 'app',
          sourceHasDateKeyword: false,
          sourceHasUpcKeyword: false,
          sourceHasRetailerStatement: false,
          sourceHasAreaPhrase: false,
          dateFieldsPresent: 0,
          dateFieldsNormalized: 0,
          dateLeaks: 0,
          typeMismatches: 0,
          codeLocationShown: false,
          codeLocationCandidates: 0,
          codeLocationRejected: 0,
          hazardHasTemplate: false,
          healthRiskRendered: false,
          quantityInSource: false,
          quantitySurfaced: false,
          packageFieldLabels: [],
          checkerRendered: false,
          rejectedUnsupported: 0,
          rejectedWrongDestination: 0,
          rejectedInvalidType: 0,
          rejectedIntentionallySuppressed: 0,
          sourceHasSize: false,
          sizeSurfaced: false,
          sourceHasLot: false,
          lotSurfaced: false,
          sourceHasRetailLocation: false,
          retailLocationsSurfaced: false,
          sourceHasPlatform: false,
          platformSurfaced: false,
          statesSurfaced: false,
          unapprovedFieldLabels: 0,
          crossDestinationLeaks: 0,
          actionIsFragment: false,
          statesInSourceClause: 0,
          statesRetained: 0,
          citiesAsRetailers: 0,
          retailerCoverageEntries: 0,
          listDetected: false,
          listItemCount: 0,
          listItemsWithIdentifiers: 0,
          orphanPackageFields: 0,
          variantsTotal: 0,
          invalidVariantIdentities: 0,
          dateLikeVariantNames: 0,
          geographyLikeVariantNames: 0,
          codeLikeVariantNames: 0,
          labelLikeVariantNames: 0,
          rawRowVariantNames: 0,
          affectedVersionsWithMetadata: 0,
          sharedFieldCount: 0,
          ambiguousScopeSuppressed: 0,
          looseFieldsAfterCards: 0,
          geographyAsRetailer: 0,
          malformedRenderedDates: 0,
          monthYearSourcePresent: 0,
          monthYearNormalized: 0,
          monthYearInventedDays: 0,
          recognitionImages: 0,
          codeImages: 0,
          extremeAspectImages: 0,
          homeThumbnailValid: true,
        },
      });
    }
  }
  return results;
}

function auditFsis(): QaRecordResult[] {
  const records: FsisRawRecord[] = JSON.parse(
    readFileSync('src/server/fsis/fixtures/benchmark-records.json', 'utf8'),
  );
  return records.map((raw) => {
    const projection = projectCase([parseFsisRecord(raw)]);
    return auditConsumerCase(
      projection.sourceIdentifiers[0]?.id ?? 'fsis',
      projection,
      projection.affectedProducts,
    );
  });
}

function report(title: string, results: QaRecordResult[]): number {
  const summary = summarizeQa(results);
  console.log(`\n${'═'.repeat(72)}\n${title} — ${summary.records} records\n${'═'.repeat(72)}`);

  console.log('\nProjection quality:');
  const m = summary.metrics;
  const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${Math.round((a / b) * 100)}%`);
  console.log(
    `  product photos:      ${m.photosShown}/${m.photosSourcePresent} shown where source has them (${pct(m.photosShown, m.photosSourcePresent)})`,
  );
  console.log(
    `  dates:               ${m.datesExtracted} records project a date · ${m.dateMissed} stated in source but missed`,
  );
  console.log(
    `  barcodes:            ${m.upcExtracted} records project a barcode · ${m.upcMissed} stated in source but missed`,
  );
  console.log(
    `  retailers:           ${m.retailerExtracted} extracted / ${m.retailerSourcePresent} source-present (${pct(m.retailerExtracted, m.retailerSourcePresent)})`,
  );
  console.log(`  affected versions:   ${m.variantsExtracted} records`);
  console.log(`  lot-code sets:       ${m.lotCodesExtracted} records`);
  console.log(
    `  distribution known:  ${m.distributionKnown}/${m.records} (${pct(m.distributionKnown, m.records)})`,
  );
  console.log(
    `  package coverage:    structured ${m.packageStructured} | partial ${m.packagePartial} | ` +
      `source-silent ${m.packageSourceSilent} | parser-missed ${m.packageParserMissed}`,
  );
  console.log(
    `  consumer action:     ${m.actionFromSource} from source, ${m.actionAppFallback} app recommendation`,
  );

  console.log('\nSemantic relationships:');
  console.log(
    `  variant-bearing:     ${m.variantBearingRecords} records · ${m.variantsWithOwnIdentifiers} where versions carry their own identifiers`,
  );
  console.log(`  versions with own identifiers: ${m.variantRelationshipsPreserved}`);
  console.log(`  orphan identifiers:  ${m.orphanIdentifiers}`);
  console.log(
    `  code↔date pairs:     ${m.codeDatePairsPreserved} preserved / ${m.codeDatePairsInSource} stated in source`,
  );
  console.log(
    `  geography areas:     ${m.areasExtracted} extracted / ${m.areaSourcePresent} source-present`,
  );

  console.log('\nStandardization:');
  console.log(
    `  dates:               ${m.dateFieldsNormalized}/${m.dateFieldsPresent} normalized · ${m.dateLeaks} raw-format leaks`,
  );
  console.log(`  type mismatches:     ${m.typeMismatches}`);
  console.log(
    `  code location:       ${m.codeLocationShown} records show one · ${m.codeLocationRejected} candidates rejected as unusable`,
  );
  console.log(
    `  health risk:         ${m.hazardTemplateRendered}/${m.hazardTemplateRecognized} recognized hazards render a template`,
  );
  console.log(
    `  recall quantity:     ${m.quantitySurfaced} surfaced · ${m.quantityInSource} stated in source · ${m.quantityMissed} missed`,
  );

  console.log('\nClosed consumer schema:');
  console.log(
    `  package field labels: ${m.uniquePackageFieldLabels} unique · ${m.unapprovedFieldLabels} outside the allowlist`,
  );
  console.log(`  cross-destination leaks: ${m.crossDestinationLeaks}`);
  console.log(
    `  Check Your Package:  ${m.checkersRendered} rendered · ${m.checkersHidden} hidden (nothing useful survived)`,
  );
  console.log(
    `  facts held back:     ${m.rejectedUnsupported} no approved field · ${m.rejectedWrongDestination} wrong destination · ` +
      `${m.rejectedInvalidType} wrong type · ${m.rejectedIntentionallySuppressed} layout/low-value`,
  );
  console.log(`  action fragments:    ${m.actionFragments}`);

  console.log('\nDistribution entity roles:');
  console.log(
    `  clause states:       ${m.statesRetainedFromClauses}/${m.statesInSourceClauses} retained · ` +
      `cities as retailers: ${m.citiesAsRetailers} (must be 0)`,
  );
  console.log(
    `  geography as retailer: ${m.geographyAsRetailer} (must be 0) · ` +
      `retailer↔place links kept: ${m.retailerCoverageEntries}`,
  );

  console.log('\nSource-declared product lists:');
  console.log(
    `  ${m.listsDetected} records · ${m.listItems} items · ${m.listItemsWithIdentifiers} items with own identifiers`,
  );

  console.log('\nClosed variant identity:');
  console.log(
    `  variants total:      ${m.variantsTotal} · invalid identities: ${m.invalidVariantIdentities} (must be 0)`,
  );
  console.log(
    `  by kind — date: ${m.dateLikeVariantNames} · geography: ${m.geographyLikeVariantNames} · ` +
      `code: ${m.codeLikeVariantNames} · label: ${m.labelLikeVariantNames} · raw row: ${m.rawRowVariantNames} (all must be 0)`,
  );
  console.log(
    `  affected-versions lines with metadata: ${m.affectedVersionsWithMetadata} (must be 0)`,
  );

  console.log('\nShared fields and loose rows:');
  console.log(
    `  shared-field blocks: ${m.recordsWithSharedFields} records · ${m.sharedFieldsRendered} fields · ` +
      `ambiguous facts suppressed: ${m.ambiguousScopeSuppressed}`,
  );
  console.log(`  loose fields after version cards: ${m.looseFieldsAfterCards} (must be 0)`);

  console.log('\nOwnership and dates:');
  console.log(`  variant-mode orphan fields: ${m.orphanPackageFields} (must be 0)`);
  console.log(
    `  month/year dates:    ${m.monthYearNormalized}/${m.monthYearSourcePresent} normalized · ` +
      `invented days: ${m.monthYearInventedDays} (must be 0)`,
  );
  console.log(`  malformed rendered dates: ${m.malformedRenderedDates} (must be 0)`);

  console.log('\nDestination completeness (extracted → surfaced):');
  console.log(`  package size:        ${m.sizeSurfaced}/${m.sizeSourcePresent}`);
  console.log(`  lot / batch codes:   ${m.lotSurfaced}/${m.lotSourcePresent}`);
  console.log(`  states:              ${m.statesSurfaced} records name states`);
  console.log(
    `  retail locations:    ${m.retailLocationSurfaced}/${m.retailLocationSourcePresent}`,
  );
  console.log(`  online platforms:    ${m.platformSurfaced}/${m.platformSourcePresent}`);

  console.log('\nImages by role:');
  console.log(
    `  code crops excluded from gallery: ${m.codeImagesExcluded} across ${m.recordsWithCodeImages} records`,
  );
  console.log(
    `  home thumbnail valid: ${m.homeThumbnailValid}/${m.records} · extreme-aspect images laid out: ${m.extremeAspectImages}`,
  );

  // Source → projection completeness. Every fact the source supported, and
  // what the projection did with it. `projection_dropped` is the number that
  // measures silent information loss.
  const inv = summary.inventory.byDisposition;
  console.log(`\nSource → projection (${summary.inventory.total} source facts):`);
  console.log(
    `  retained ${inv.retained} | normalized ${inv.normalized} | aggregated ${inv.aggregated} | ` +
      `relationship preserved ${inv.relationship_preserved}`,
  );
  console.log(
    `  intentionally suppressed ${inv.suppressed} | dropped by projection ${inv.projection_dropped}`,
  );

  console.log(
    `\nViolations: ${summary.criticalCount} critical, ${summary.majorCount} major, ${summary.minorCount} minor`,
  );
  if (summary.violationsByRule.length === 0) {
    console.log('  (none)');
  }
  for (const cluster of summary.violationsByRule) {
    console.log(`\n  [${cluster.severity}] ${cluster.rule} — ${cluster.count} record(s)`);
    for (const example of cluster.examples) console.log(`      · ${example}`);
  }
  return summary.criticalCount;
}

const fdaCritical = report('FDA consumer projection', auditFda());
const fsisCritical = report('FSIS consumer projection (regression guard)', auditFsis());
console.log(`\nTotal critical violations: ${fdaCritical + fsisCritical}\n`);
