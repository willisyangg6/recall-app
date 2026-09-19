/**
 * The Design Preview hub — LOCAL DEVELOPMENT TOOLING, not a product screen.
 *
 * It exists so the founder can reach every shopper-report state in a
 * simulator and screenshot it for the designer while the production feature
 * gate stays off. It renders no product UI of its own: each row arms a
 * simulated session (lib/design-preview.ts) and then pushes the REAL Detail
 * or the REAL questionnaire, which render the production components against
 * the live read-only feed. There is deliberately no preview copy of Detail,
 * the community block, or the questionnaire anywhere in this file — a
 * screenshot of a copy would prove nothing about the product.
 *
 * This screen carries the only "development" labelling in the harness. The
 * screens it opens carry none, so the captures are of the product exactly as
 * it is built.
 *
 * Every recall shown here is a real, current recall chosen from the app's
 * normal feed session — no extra feed request, no invented case. The only
 * simulated values are the four the hub names in its own banner.
 *
 * Release builds: the entry point into this route does not exist (Profile's
 * row is behind `__DEV__`, which Metro eliminates), and the screen refuses to
 * arm anything anyway, so a deep link reaches an inert page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DocumentBlockView } from '@/components/document/document-blocks';
import { DocumentSectionView, DocumentView } from '@/components/document/document-view';
import { ResetPanel } from '@/components/installation-reset-section';
import { DevelopmentEntry } from '@/components/profile/development-entry';
import { NavigationRow } from '@/components/profile/navigation-row';
import { PersonalizationCard } from '@/components/profile/personalization-card';
import { ProfileSection } from '@/components/profile/profile-section';
import { ValueRow } from '@/components/profile/value-row';
import { RecallCard } from '@/components/recall-card';
import { SaveControlAppearance } from '@/components/save-recall-button';
import { NotificationsPanel } from '@/components/settings/notifications-panel';
import {
  PersonalizationForm,
  PreferencesNotReady,
  StateSection,
  StateSelectorContent,
  StoreSection,
  StoreSelectorContent,
} from '@/components/settings/personalization-form';
import {
  OutcomeStep,
  PausedStep,
  QuestionStep,
  ReviewStep,
} from '@/components/report-questionnaire';
import { StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { CategoryTag } from '@/components/ui/category-tag';
import { Chip } from '@/components/ui/chip';
import { IllnessNotice } from '@/components/ui/illness-notice';
import { DisclosureControl } from '@/components/ui/disclosure-control';
import { Icon, ICON_NAMES } from '@/components/ui/icon';
import { MediaTile } from '@/components/ui/media-tile';
import { NoticeLabel } from '@/components/ui/notice-label';
import { OfficialImageSet } from '@/components/ui/official-image-set';
import { RelevanceLabel } from '@/components/ui/relevance-label';
import { RiskLabel } from '@/components/ui/risk-label';
import { SearchBar } from '@/components/ui/search-bar';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import {
  color,
  CUSTOM_FONTS_INSTALLED,
  fontFamily,
  hitSlopToMinimum,
  layout,
  radius,
  spacing,
  typography,
  type TypographyVariant,
} from '@/constants/design-tokens';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import {
  deriveIllnessStatus,
  illnessNoticeCopy,
  narrativeWithoutIllness,
  type IllnessNoticeCopy,
} from '@/domain/illness-status';
import { documentBySlug, PROFILE_DOCUMENT_GROUPS, TRUST_DOCUMENTS } from '@/content';
import type { DocumentBlock, TrustDocument } from '@/content/document-model';
import { useFeed } from '@/hooks/use-feed';
import {
  activeDesignPreview,
  candidateScore,
  DESIGN_PREVIEW_SCENARIOS,
  enterDesignPreview,
  exitDesignPreview,
  isDevelopmentBuild,
  rankCandidates,
  resetDesignPreview,
  type DesignPreviewSession,
  type PreviewCaseRequirement,
  EXTREME_LANDSCAPE_MIN_ASPECT,
  EXTREME_PORTRAIT_MAX_ASPECT,
  type PreviewDetailFacts,
  type PreviewScenario,
  type PreviewScenarioGroup,
  type ScreenedCandidate,
} from '@/lib/design-preview';
import {
  DETAIL_ERROR_FALLBACK,
  DETAIL_ERROR_TITLE,
  DETAIL_LOADING,
  DETAIL_MISSING,
} from '@/lib/detail-copy';
import {
  RESET_CONFIRM_BODY,
  RESET_CONFIRM_CANCEL,
  RESET_CONFIRM_DELETE,
  RESET_CONFIRM_TITLE,
} from '@/lib/installation-reset';
import { GENERIC_FAILURE, type NotificationsView } from '@/lib/notifications-screen';
import { storeCountLabel } from '@/lib/personalization-screen';
import {
  APP_VERSION_LABEL,
  DEVELOPMENT_HEADING,
  DOCUMENT_HINT,
  summarizePreferences,
  versionLine,
  type PreferenceSummaryState,
} from '@/lib/profile-hub';
import { LAUNCH_CATEGORY_OPTIONS } from '@/domain/food-category-launch';
import {
  EMPTY_PREFERENCES,
  SUPPORTED_STATE_CODES,
  type UserRecallPreferences,
} from '@/domain/preferences';
import type {
  Classification,
  NoticeType,
  OfficialClass,
  SourceAgency,
} from '@/domain/recall-types';
import type { ConsumerRiskTier } from '@/domain/risk-tier';
import {
  FEED_EMPTY_SEARCH,
  FEED_ERROR_TITLE,
  FEED_LOAD_FAILURE,
  FEED_LOADING,
  FEED_STALE_NOTICE,
  PERSONALIZE_CTA,
} from '@/lib/feed-copy';
import { RISK_FILTER_TIERS } from '@/lib/feed-filters';
import {
  SAVED_EMPTY,
  SAVED_ERROR_TITLE,
  SAVED_LOADING,
  saveControlState,
  savedMissingNotice,
} from '@/lib/saved-recalls';
import { selectHazardGuidance } from '@/lib/recall-display';
import { fetchCaseDetail, type FeedItem } from '@/lib/recall-feed';
import {
  buildDetailModel,
  buildHomeCardModel,
  disclosureControl,
  IMAGE_DOTS_WINDOW,
  todayIso,
  cardSummaryText,
  noticeLabel,
  type DetailImageSet,
  type HomeCardModel,
} from '@/lib/recall-presentation';
import { interpretReason } from '@/lib/recall-reason';
import { riskView } from '@/lib/risk-display';
import {
  EMPTY_ANSWERS,
  questionnaireOutcome,
  questionnaireSteps,
  REMOVE_FAILURE,
  REPORT_UNAVAILABLE,
  RETAILER_NOT_SURE,
  SUBMIT_FAILURE,
  SUCCESS_BODY,
  SUCCESS_TITLE,
  type QuestionKey,
  type QuestionnaireAnswers,
  type QuestionnaireChoices,
} from '@/lib/shopper-report-presentation';

/** How many candidates per requirement the hub offers as alternatives. */
const CANDIDATES_SHOWN = 6;
/** How many of the primary bucket are confirmed against the real detail model. */
const CANDIDATES_CONFIRMED = 5;
/**
 * How many recalls the hub reads a real Detail model for on open. The
 * presentation scenarios (jurisdiction, row and cell disclosure) can only be
 * decided from that model, and a feed row cannot answer "does any cell in
 * this notice hold more than two values". These are the same read-only detail
 * requests the Detail screen itself makes.
 */
const DETAIL_PROBE_LIMIT = 80;

/** How many feed rows each P2B2 hint bucket contributes to the probes. */
const HINTS_PER_BUCKET = 3;

/**
 * How many extra rows each P2B7C imagery bucket contributes. Image-set size
 * and label-page count exist only in the real Detail model, so the imagery
 * scenarios are satisfied by breadth of probing rather than by any feed-row
 * hint — and a bucket the live corpus cannot fill still says "No suitable
 * current recall" instead of substituting one.
 */
const IMAGERY_HINTS = 10;

/**
 * Feed-row HINTS for the reviewed hazard guides — where a recall carrying
 * each guide is likely to be found, so a probe is spent on it. Hints only:
 * the requirement itself is decided by the real Detail model's guide
 * selection, never by these patterns.
 */
const GUIDE_HINTS: readonly RegExp[] = [
  /botul/i,
  /listeria/i,
  /e\.?\s?coli|stec|shiga/i,
  /salmonella/i,
  /hepatitis/i,
  /cyclospora/i,
];

const REQUIREMENT_LABELS: Record<PreviewCaseRequirement, string> = {
  reportable_with_retailers: 'Eligible recall naming at least one retailer',
  reportable_without_retailers: 'Eligible recall naming no retailer',
  not_reportable: 'Ineligible recall (unusable geography)',
  // P2B3
  reportable_single_state: 'Eligible recall naming exactly one state',
  reportable_multi_state: 'Eligible recall naming several states',
  reportable_nationwide: 'Eligible recall distributed nationwide',
  jurisdictions_few: 'Recall naming five jurisdictions or fewer',
  jurisdictions_many: 'Recall naming more than five jurisdictions',
  products_one: 'Recall with exactly one affected-product row',
  products_many: 'Recall with several affected-product rows',
  cell_two_values: 'Recall with an unpaired cell holding exactly two values',
  cell_many_values: 'Recall with an unpaired cell holding more than two values',
  pairs_two: 'Recall stating exactly two code/date pairs',
  pairs_many: 'Recall stating more than two code/date pairs',
  // P2B2
  nationwide: 'Recall distributed nationwide',
  risk_critical: 'Recall at the CRITICAL tier',
  risk_very_high: 'Recall at the VERY HIGH tier',
  risk_high: 'Recall at the HIGH tier',
  risk_moderate: 'Recall at the MODERATE tier',
  risk_low: 'Recall at the LOW tier',
  risk_pending: 'Recall at the PENDING tier',
  risk_unknown: 'Notice at the UNKNOWN tier',
  image: 'Recall whose Detail model resolved a hero image',
  no_image: 'Recall whose Detail model resolved no hero image',
  name_short: 'Recall with a short product name',
  name_long: 'Recall with a long product name',
  images_one: 'Recall with exactly one official product photo',
  images_two: 'Recall with exactly two official product photos',
  images_five: 'Recall with exactly five official product photos',
  images_six: 'Recall with exactly six official product photos',
  images_seven: 'Recall with exactly seven official product photos',
  images_many: 'Recall with fifteen or more official product photos',
  images_largest: 'Recall with the largest official set in the live corpus',
  image_portrait: 'Recall whose set holds an unusually tall official photo',
  image_landscape: 'Recall whose set holds an unusually wide official photo',
  name_long_images: 'Recall with a long product name and a paged image set',
  row_image_matched: 'Recall with an image matched to an exact product row',
  labels_unrendered: 'Notice with official label pages (rendered nowhere)',
  guide_botulism: 'Recall the pipeline matches to the botulism guide',
  guide_listeria: 'Recall the pipeline matches to the Listeria guide',
  guide_stec: 'Recall the pipeline matches to the E. coli (STEC) guide',
  guide_undeclared_allergen: 'Recall the pipeline matches to the undeclared-allergen guide',
  guide_salmonella: 'Recall the pipeline matches to the Salmonella guide',
  guide_hepatitis_a: 'Recall the pipeline matches to the hepatitis A guide',
  guide_cyclospora: 'Recall the pipeline matches to the Cyclospora guide',
  health_risk_fallback: 'Recall with a Health Risk section but no reviewed guide',
  health_risk_absent: 'Recall with no Health Risk section',
  pairs_complete: 'Recall whose code/date group is complete',
  pairs_incomplete: 'Recall whose code/date group has an undated code',
};

const GROUP_LABELS: Record<PreviewScenarioGroup, string> = {
  community: 'Community shopper reports',
  questionnaire: 'Questionnaire',
  disclosure: 'Where It Was Sold and Affected Products',
  header: 'Product header',
  health: 'Health Risk',
  risk: 'Risk labels on Detail',
  imagery: 'Official imagery on Detail',
};

/**
 * One classification per consumer tier, so the label gallery renders through
 * the REAL pipeline — `riskView` derives the word, the casing and the spoken
 * label from these exactly as it does for a live recall. Nothing here is
 * recall content: it is the official classification vocabulary, and a wrong
 * mapping would show up as the wrong badge.
 */
const TIER_SAMPLE: Record<ConsumerRiskTier, Classification> = {
  critical: classificationOf(['class_I']),
  very_high: classificationOf(['class_I', 'class_II']),
  high: classificationOf(['class_II']),
  moderate: classificationOf(['class_II', 'class_III']),
  low: classificationOf(['class_III']),
  pending: { value: 'not_yet_classified', sourceText: null, officialClasses: [] },
  unknown: { value: 'not_applicable_pha', sourceText: null, officialClasses: [] },
};

/**
 * P2B7N status-treatment matrix inputs. Real classification shapes and real
 * notice types — the gallery derives what shows from them through `riskView`
 * rather than being told, so a change to the rule changes this matrix.
 */
const STATUS_TREATMENTS: readonly {
  caption: string;
  classification: Classification;
  agency: SourceAgency;
  noticeType: NoticeType;
}[] = [
  {
    caption: 'Public health alert · unknown → PUBLIC HEALTH ALERT only, no risk label',
    classification: { value: 'not_applicable_pha', sourceText: null, officialClasses: [] },
    agency: 'FSIS',
    noticeType: 'public_health_alert',
  },
  {
    caption: 'Recall · unknown → UNKNOWN (a recall’s missing class is real information)',
    classification: { value: 'multiple_classes', sourceText: null },
    agency: 'FDA',
    noticeType: 'recall',
  },
  {
    caption: 'Recall · not yet classified → PENDING',
    classification: { value: 'not_yet_classified', sourceText: null, officialClasses: [] },
    agency: 'FDA',
    noticeType: 'recall',
  },
  {
    caption: 'Recall · Class I → CRITICAL',
    classification: { value: 'class_I', sourceText: 'Class I', officialClasses: ['class_I'] },
    agency: 'FDA',
    noticeType: 'recall',
  },
];

function classificationOf(classes: OfficialClass[]): Classification {
  return {
    value: classes.length === 1 ? classes[0] : 'multiple_classes',
    sourceText: null,
    officialClasses: classes,
  };
}

/** What the real detail model actually produced for a case. */
interface ConfirmedSections {
  /** The REAL header image set this case produced, for the imagery gallery. */
  imageSet: DetailImageSet | null;
  healthRisk: boolean;
  affectedProducts: boolean;
  community: boolean;
  facts: PreviewDetailFacts;
}

export default function DesignPreviewScreen() {
  const insets = useSafeAreaInsets();
  const feed = useFeed();
  const [chosen, setChosen] = useState<Partial<Record<PreviewCaseRequirement, string>>>({});
  const [confirmed, setConfirmed] = useState<Record<string, ConfirmedSections>>({});
  const [session, setSession] = useState<DesignPreviewSession | null>(null);
  const [expanded, setExpanded] = useState<PreviewCaseRequirement | null>(null);
  // The foundation gallery's one interactive sample.
  const [sampleExpanded, setSampleExpanded] = useState(false);

  // Returning from a simulated submission or removal should show the current
  // simulated state, not the one this screen last rendered.
  useFocusEffect(
    useCallback(() => {
      setSession(activeDesignPreview());
    }, []),
  );

  const candidates = useMemo(() => {
    const items = feed.state.status === 'ready' ? feed.state.items : [];
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      state: item.state,
      geography: item.geography,
      retailerNames: item.retailerNames,
      productLineCount: item.productNames.length,
      lastPublicActivityAt: item.lastPublicActivityAt,
      // The same derivation the Detail model makes from the same stored
      // classification, so the risk scenarios land on the tier they name.
      riskTier: riskView(item.classification, item.sourceAgency, item.noticeType).tier,
    }));
  }, [feed.state]);

  const buckets = useMemo(() => {
    const factsFor = (id: string) => confirmed[id]?.facts ?? null;
    const forRequirement = (requirement: PreviewCaseRequirement) =>
      rankCandidates(candidates, requirement, factsFor);
    return Object.fromEntries(
      (Object.keys(REQUIREMENT_LABELS) as PreviewCaseRequirement[]).map((requirement) => [
        requirement,
        forRequirement(requirement),
      ]),
    ) as Record<PreviewCaseRequirement, ScreenedCandidate[]>;
  }, [candidates, confirmed]);

  /**
   * The recalls the hub reads a REAL Detail model for, chosen to span the
   * shapes the presentation scenarios need: the longest product tables (long
   * cells live there), single-line notices, and the widest jurisdiction
   * lists. Derived from the feed alone, never from the confirmed results, so
   * confirming can never feed back into what gets confirmed.
   */
  const probeIds = useMemo(() => {
    const items = feed.state.status === 'ready' ? feed.state.items : [];
    const byProductLines = [...candidates].sort((a, b) => b.productLineCount - a.productLineCount);
    const singleLine = candidates.filter((item) => item.productLineCount === 1);
    const byStates = [...candidates].sort(
      (a, b) =>
        (b.geography.scope === 'states' ? b.geography.states.length : 0) -
        (a.geography.scope === 'states' ? a.geography.states.length : 0),
    );
    // P2B2 hints, from the feed row's own fields: a few rows per reviewed
    // hazard guide, a few whose hazard has no guide, rows with and without
    // a hero, and the shortest and longest titles. Every one is confirmed
    // against the real Detail model before a scenario can use it.
    const hazardText = (item: FeedItem) =>
      `${item.pathogenOrAllergen ?? ''} ${item.reasonText ?? ''}`;
    const guideHinted = GUIDE_HINTS.flatMap((pattern) =>
      items.filter((item) => pattern.test(hazardText(item))).slice(0, HINTS_PER_BUCKET),
    );
    const allergen = items.filter((item) => item.hazardCategory === 'allergen');
    const otherHazards = items.filter((item) =>
      [
        'foreign_material',
        'product_integrity',
        'other_regulatory',
        'chemical_contamination',
      ].includes(item.hazardCategory),
    );
    const withHero = items.filter((item) => item.heroImageUrl !== null);
    // FSIS notices are the only source of rendered label pages (the FDA
    // announcements publish photographs instead).
    const fsis = items.filter((item) => item.sourceAgency === 'FSIS');
    const withoutHero = items.filter((item) => item.heroImageUrl === null);
    const byTitleLength = [...items].sort((a, b) => a.title.length - b.title.length);
    const picked: string[] = [];
    for (const item of [
      // Weighted toward long product tables: a notice that prints a code
      // beside its own date is a notice with a per-product table, and those
      // are the rows the pair scenarios need. A narrow sample simply reports
      // "no suitable current recall" rather than substituting a wrong one, so
      // breadth here is the difference between a scenario being offered and
      // being honestly unavailable.
      ...byProductLines.slice(0, 20),
      ...singleLine.slice(0, 5),
      ...byStates.slice(0, 5),
      ...guideHinted,
      ...allergen.slice(0, HINTS_PER_BUCKET),
      ...otherHazards.slice(0, HINTS_PER_BUCKET + 1),
      ...withHero.slice(0, HINTS_PER_BUCKET),
      ...withoutHero.slice(0, HINTS_PER_BUCKET),
      ...byTitleLength.slice(0, 2),
      ...byTitleLength.slice(-2),
      // P2B7C hints. How many official photos a notice published is not on
      // the feed row at all — only the real Detail model knows — so the hub
      // probes MORE recalls that carry a hero (a notice with several photos
      // always has one) and the FSIS notices whose label PDFs are the only
      // source of label-page evidence. Every one is still confirmed against
      // the real model before any imagery scenario can use it.
      ...withHero.slice(HINTS_PER_BUCKET, HINTS_PER_BUCKET + IMAGERY_HINTS),
      ...fsis.slice(0, IMAGERY_HINTS),
    ]) {
      if (!picked.includes(item.id) && picked.length < DETAIL_PROBE_LIMIT) picked.push(item.id);
    }
    return picked;
  }, [candidates, feed.state]);

  // Read each probe's real Detail model: which sections it produced, and the
  // disclosure shape of its jurisdiction list, product rows and cells. These
  // are the same read-only detail requests the Detail screen itself makes.
  useEffect(() => {
    if (probeIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        probeIds.map(async (id) => {
          try {
            const detail = await fetchCaseDetail(id);
            if (detail === null) return null;
            const model = buildDetailModel(detail, { today: todayIso(), affectsYou: false });
            const { sections } = model;
            const cells = (sections.affectedProducts?.table.expanded.rows ?? []).flatMap(
              (row) => row.cells,
            );
            // Independent fields and coordinated pair groups are measured
            // separately: a paired cell's line count belongs to its group, not
            // to a field, and one must never satisfy the other's scenario.
            const valueCounts = cells
              .filter((cell) => cell.pairGroup === null)
              .map((cell) => cell.values.length);
            const pairLines = (sections.affectedProducts?.table.expanded.rows ?? []).flatMap(
              (row) => {
                const groups = new Map<string, number>();
                for (const cell of row.cells) {
                  if (cell.pairGroup !== null) groups.set(cell.pairGroup, cell.values.length);
                }
                return [...groups.values()];
              },
            );
            // A pair group is incomplete when either half carries an empty
            // line — an undated code, which the screen keeps as a blank.
            const pairCompleteness = (sections.affectedProducts?.table.expanded.rows ?? []).flatMap(
              (row) => {
                const groups = new Map<string, boolean>();
                for (const cell of row.cells) {
                  if (cell.pairGroup === null) continue;
                  const blank = cell.values.includes('');
                  groups.set(cell.pairGroup, (groups.get(cell.pairGroup) ?? false) || blank);
                }
                return [...groups.values()];
              },
            );
            // The guide the REAL pipeline selects for this notice — the same
            // call, on the same projection, that `buildDetailModel` makes.
            const { projection } = detail;
            const guide = selectHazardGuidance(
              interpretReason({
                reasonText: projection.reasonText,
                hazardCategory: projection.hazardCategory,
                pathogenOrAllergen: projection.pathogenOrAllergen,
                summaryText: projection.summaryText,
                title: projection.title,
              }),
              {
                pathogenOrAllergen: projection.pathogenOrAllergen,
                reasonText: projection.reasonText,
              },
            );
            return [
              id,
              {
                imageSet: model.productImages,
                healthRisk: sections.healthRisk !== null,
                affectedProducts: sections.affectedProducts !== null,
                community: sections.communityReports !== null,
                facts: {
                  jurisdictionCount: sections.whereSold?.states.length ?? 0,
                  productRowCount: sections.affectedProducts?.table.expanded.rows.length ?? 0,
                  maxCellValues: valueCounts.length > 0 ? Math.max(...valueCounts) : 0,
                  hasTwoValueCell: valueCounts.includes(2),
                  maxPairLines: pairLines.length > 0 ? Math.max(...pairLines) : 0,
                  hasTwoLinePairGroup: pairLines.includes(2),
                  hasHeroImage: model.heroImageUrl !== null,
                  productNameLength: model.productName.length,
                  healthRisk: sections.healthRisk !== null,
                  healthGuideKey: sections.healthRisk !== null && guide !== null ? guide.key : null,
                  hasCompletePairGroup: pairCompleteness.includes(false),
                  hasIncompletePairGroup: pairCompleteness.includes(true),
                  // P2B7C (as corrected): the model's own complete header
                  // set, so a scenario lands on a recall that really has that
                  // many REACHABLE pages; the label count comes from the
                  // allocation, which still holds pages no screen renders.
                  productImageCount: model.productImages?.images.length ?? 0,
                  labelPageCount: model.images.gallery.filter(
                    (image) => image.source === 'fsis_label_render',
                  ).length,
                  rowImageCount: model.images.rowImages.size,
                  hasExtremePortraitImage: (model.productImages?.images ?? []).some(
                    (image) =>
                      image.aspectRatio !== null &&
                      image.aspectRatio <= EXTREME_PORTRAIT_MAX_ASPECT,
                  ),
                  hasExtremeLandscapeImage: (model.productImages?.images ?? []).some(
                    (image) =>
                      image.aspectRatio !== null &&
                      image.aspectRatio >= EXTREME_LANDSCAPE_MIN_ASPECT,
                  ),
                },
              },
            ] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, ConfirmedSections> = {};
      for (const result of results) if (result !== null) next[result[0]] = result[1];
      setConfirmed(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [probeIds]);

  /**
   * The recall a requirement will use: the founder's explicit pick, else the
   * best-confirmed primary candidate, else the top-ranked one.
   */
  const selectionFor = (requirement: PreviewCaseRequirement): ScreenedCandidate | null => {
    const bucket = buckets[requirement];
    const picked = chosen[requirement];
    if (picked !== undefined) {
      const match = bucket.find((screened) => screened.candidate.id === picked);
      if (match) return match;
    }
    if (requirement === 'reportable_with_retailers') {
      const best = bucket
        .slice(0, CANDIDATES_CONFIRMED)
        .find((screened) => isFullyFeatured(confirmed[screened.candidate.id]));
      if (best) return best;
    }
    // A presentation requirement is only ever satisfied by a confirmed case,
    // so the bucket already holds nothing but real matches.
    return bucket[0] ?? null;
  };

  const open = (scenario: PreviewScenario) => {
    const selection = selectionFor(scenario.requirement);
    if (selection === null) return;
    const entered = enterDesignPreview({
      scenarioId: scenario.id,
      caseId: selection.candidate.id,
      caseTitle: selection.candidate.title,
      allowedStateCodes: selection.allowedStateCodes,
      retailerChoices: selection.retailerChoices,
      now: new Date().toISOString(),
    });
    if (entered === null) return;
    setSession(entered);
    router.push(
      scenario.destination === 'detail'
        ? { pathname: '/recall/[id]', params: { id: selection.candidate.id } }
        : { pathname: '/report/[id]', params: { id: selection.candidate.id } },
    );
  };

  // A release build can neither arm a session nor offer a control that would.
  if (!isDevelopmentBuild()) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Design Preview' }} />
        <View style={styles.content}>
          <ThemedText themeColor="textSecondary">
            Design Preview is a development-only tool and is not available in this build.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Design Preview' }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.five + insets.bottom }]}>
        <ThemedView type="backgroundSelected" style={styles.banner}>
          <ThemedText type="subtitle">Local development tooling</ThemedText>
          <ThemedText type="small">
            Not part of the product. The recall content below is real and read-only. Only four
            values are simulated: the public report count, whether this device has a report, that
            report’s answers, and whether the feature is available inside this session. Simulated
            reports stay in memory on this device — nothing is written to Supabase, and the
            production feature gate is untouched and still off.
          </ThemedText>
        </ThemedView>

        {feed.state.status === 'loading' ? (
          <ThemedText themeColor="textSecondary">Loading the live feed…</ThemedText>
        ) : null}
        {feed.state.status === 'error' ? (
          <ThemedText themeColor="textSecondary">
            The live feed could not load, so no real recall can be offered: {feed.state.message}
          </ThemedText>
        ) : null}

        {session ? (
          <ThemedView type="backgroundElement" style={styles.sessionBox}>
            <ThemedText type="small" themeColor="textSecondary">
              ACTIVE SIMULATED SESSION
            </ThemedText>
            <ThemedText>{session.scenarioId}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {session.caseTitle}
            </ThemedText>
            <ThemedText type="small">
              {session.simulated === null
                ? 'Not simulated — this case reads the real server.'
                : `Simulated: ${summaryText(session)} · ${
                    session.simulated.report === null
                      ? 'no report from this device'
                      : 'this device has a report'
                  }`}
            </ThemedText>
            <View style={styles.sessionActions}>
              <Action
                label="Reset simulated state"
                onPress={() => {
                  resetDesignPreview();
                  setSession(activeDesignPreview());
                }}
              />
              <Action
                label="Leave preview"
                onPress={() => {
                  exitDesignPreview();
                  setSession(null);
                }}
              />
            </View>
          </ThemedView>
        ) : null}

        {/* P2B0 design foundation: the shared primitives rendered from the
            tokens, so the founder can inspect them in a simulator before any
            product screen is restyled. Development-only, like this whole hub. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          DESIGN FOUNDATION
        </ThemedText>
        <Surface
          background="background/page"
          radius={16}
          border="border/subtle"
          style={styles.card}>
          <Text variant="caption" color="text/secondary">
            {CUSTOM_FONTS_INSTALLED
              ? `Type scale in ${fontFamily.sans} and ${fontFamily.mono}.`
              : `Type scale at the approved sizes and weights. ${fontFamily.sans} and ${fontFamily.mono} are not installed yet, so the platform face stands in.`}
          </Text>
          {(Object.keys(typography) as TypographyVariant[]).map((variant) => (
            <Text key={variant} variant={variant}>
              {variant === 'label' || variant === 'label-strong'
                ? variant.toUpperCase()
                : `${variant} · ${typography[variant].fontSize}/${typography[variant].fontWeight}`}
            </Text>
          ))}
        </Surface>
        <View style={styles.badges}>
          <Surface radius={16} border="border/subtle" elevation="card" style={styles.swatch}>
            <Text variant="body-small">Card surface · elevated</Text>
          </Surface>
          <Surface background="background/subtle" radius={8} style={styles.swatch}>
            <Text variant="body-small">Information callout surface</Text>
          </Surface>
          <Surface background="background/media-placeholder" radius={8} style={styles.swatch}>
            <Text variant="body-small" color="text/secondary">
              Media placeholder
            </Text>
          </Surface>
        </View>
        <Surface radius={16} border="border/subtle" style={styles.card}>
          <Text variant="body-small" color="text/secondary">
            The shared disclosure control, collapsed and expanded. Its words come from the real
            presentation contract; tap it to toggle.
          </Text>
          <DisclosureControl
            control={disclosureControl(22, 'lot codes')}
            expanded={sampleExpanded}
            onPress={() => setSampleExpanded((prior) => !prior)}
          />
        </Surface>

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          RISK LABELS
        </ThemedText>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            All seven consumer labels, rendered by the product’s own Risk Label through the real
            riskView pipeline — the same words, casing and spoken labels a live recall gets.
          </ThemedText>
          <View style={styles.badges}>
            {RISK_FILTER_TIERS.map((tier) => {
              const risk = riskView(TIER_SAMPLE[tier], 'FDA', 'recall');
              return (
                <RiskLabel
                  key={tier}
                  tier={risk.tier}
                  label={risk.badgeLabel ?? ''}
                  accessibilityLabel={risk.accessibilityLabel}
                />
              );
            })}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {RISK_FILTER_TIERS.map(
              (tier) => riskView(TIER_SAMPLE[tier], 'FDA', 'recall').accessibilityLabel,
            ).join(' · ')}
          </ThemedText>
        </ThemedView>

        {/* P2B7D: the three category-tag treatments compared over the same
            real recalls, kept as the decision record. B is the product's own
            component; A and C are drawn nowhere else. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          CATEGORY TAG TREATMENTS
        </ThemedText>
        <CategoryTagGallery items={feed.state.status === 'ready' ? feed.state.items : []} />

        {/* P2B7H: the date metadata beside every status shape, the
            icon-only save control in both states, and the card summary
            rule — the compact-card details this milestone changed. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          STATUS METADATA AND SAVE CONTROL
        </ThemedText>
        <StatusMetadataGallery />

        {/* P2B1: the Feed's card, controls and states, rendered by the
            production components over REAL recalls from the live feed
            session. What is simulated is named on the gallery itself. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          FEED CARD MATRIX
        </ThemedText>
        <FeedCardGallery items={feed.state.status === 'ready' ? feed.state.items : []} />

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          FEED CONTROLS AND STATES
        </ThemedText>
        <FeedControlsGallery />

        {/* P2B2: Recall Detail's whole-screen states with their real copy,
            and the two Information Callout tones. Everything else on Detail
            is inspected on the real screen through the scenarios below. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          DETAIL STATES AND CALLOUTS
        </ThemedText>
        <DetailStatesGallery />

        {/* P2B7C: the production image set over REAL image sets from the
            probed recalls — the indicator shapes side by side, plus the one
            simulated case the live corpus cannot supply (a candidate whose
            image cannot load). */}
        {/* P2B7G: the Detail-title exploration — three treatments for
            extremely long official product names over the longest REAL
            titles in the live feed session. A decision record only:
            production Detail is unchanged, and treatments 2 and 3 exist
            nowhere else. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          DETAIL TITLE TREATMENTS
        </ThemedText>
        <DetailTitleGallery items={feed.state.status === 'ready' ? feed.state.items : []} />

        {/* P2B7K: the SHIPPED compact illness notice in every state the live
            corpus produces, in its real place in the Detail identity area,
            with the What Happened narrative each state leaves behind. The
            notice is about illnesses alone — injury, adverse-reaction,
            hospitalization and mixed-figure rows all render no notice and keep
            their sentence in the narrative. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          ILLNESS NOTICE
        </ThemedText>
        <IllnessNoticeGallery items={feed.state.status === 'ready' ? feed.state.items : []} />

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          OFFICIAL IMAGERY AND FAILURE
        </ThemedText>
        <ImagerySampleGallery confirmed={confirmed} />

        {/* The complete icon set, every declared glyph with its name, so a
            missing or wrongly-mapped asset is visible in one place rather
            than screen by screen. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          ICON SET ({ICON_NAMES.length})
        </ThemedText>
        <IconGallery />

        {/* P2B3: the questionnaire's steps and states, rendered by the real
            step components over choices a real eligible recall allows. The
            flows themselves — submit, edit, remove, refuse, pause — are
            walked on the real screen through the scenarios below. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          QUESTIONNAIRE STEPS AND STATES
        </ThemedText>
        <QuestionnaireGallery source={selectionFor('reportable_with_retailers')} />

        {/* P2B4: the Saved tab's whole-screen states with their real copy,
            and its list — the same shared card the Feed draws — over real
            recalls chosen for the shapes a saved list has to survive. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          SAVED STATES AND LIST
        </ThemedText>
        <SavedGallery items={feed.state.status === 'ready' ? feed.state.items : []} />

        {/* P2B5: the live Profile's own components — the featured
            Personalization card in every answer the store can give, a grouped
            section with the chevron rows and the value row, and the
            development entry — imported from production, never copied. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          PROFILE COMPONENTS AND STATES
        </ThemedText>
        <ProfileGallery />

        {/* P2B6A: the Personalization screen's own sections and the
            Notifications screen's own panel — imported from production,
            never copied — in every state each screen can reach. Each
            sample holds its state in memory here: nothing below reads or
            writes a preference, registers a token, or asks the operating
            system for permission. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          PERSONALIZATION STATES
        </ThemedText>
        <PersonalizationGallery />

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          NOTIFICATION STATES
        </ThemedText>
        <NotificationsGallery />

        {/* P2B6B: the trust documents' shared renderer and content blocks —
            imported from production, never copied — over the registry's own
            real content, plus the reset panel in every state with its press
            wired to nothing: nothing below can start a deletion, and no
            document is rewritten here. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          DOCUMENT RENDERER AND STATES
        </ThemedText>
        <DocumentGallery />

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          RECALLS IN USE
        </ThemedText>
        {(Object.keys(REQUIREMENT_LABELS) as PreviewCaseRequirement[]).map((requirement) => {
          const selection = selectionFor(requirement);
          const bucket = buckets[requirement];
          return (
            <ThemedView key={requirement} type="backgroundElement" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">
                {REQUIREMENT_LABELS[requirement]}
              </ThemedText>
              {selection === null ? (
                <ThemedText type="small">
                  {feed.state.status === 'ready'
                    ? 'No current recall in the live feed fits this scenario.'
                    : '—'}
                </ThemedText>
              ) : (
                <>
                  <ThemedText>{selection.candidate.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {candidateFacts(selection, confirmed[selection.candidate.id])}
                  </ThemedText>
                  {bucket.length > 1 ? (
                    <Action
                      label={expanded === requirement ? 'Hide other recalls' : 'Choose another'}
                      onPress={() => setExpanded(expanded === requirement ? null : requirement)}
                    />
                  ) : null}
                </>
              )}
              {expanded === requirement
                ? bucket.slice(0, CANDIDATES_SHOWN).map((option) => (
                    <Pressable
                      key={option.candidate.id}
                      accessibilityRole="button"
                      onPress={() => {
                        setChosen((prior) => ({ ...prior, [requirement]: option.candidate.id }));
                        setExpanded(null);
                      }}>
                      <ThemedView type="backgroundSelected" style={styles.option}>
                        <ThemedText type="small">{option.candidate.title}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {candidateFacts(option, confirmed[option.candidate.id])}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  ))
                : null}
            </ThemedView>
          );
        })}

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          SCENARIOS
        </ThemedText>
        {DESIGN_PREVIEW_SCENARIOS.map((scenario, index) => {
          const selection = selectionFor(scenario.requirement);
          const firstOfGroup =
            index === 0 || DESIGN_PREVIEW_SCENARIOS[index - 1].group !== scenario.group;
          return (
            <Pressable
              key={scenario.id}
              accessibilityRole="button"
              accessibilityLabel={scenario.title}
              accessibilityState={{ disabled: selection === null }}
              disabled={selection === null}
              onPress={() => open(scenario)}>
              {firstOfGroup ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.groupLabel}>
                  {GROUP_LABELS[scenario.group]}
                </ThemedText>
              ) : null}
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText>{scenario.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {scenario.expectation}
                </ThemedText>
                <ThemedText type="small" themeColor={selection === null ? 'textSecondary' : 'link'}>
                  {selection === null
                    ? 'No suitable current recall — unavailable'
                    : `Open ${scenario.destination === 'detail' ? 'Recall Detail' : 'the questionnaire'} →`}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

/**
 * CATEGORY TAG TREATMENTS (P2B7D) — the decision record.
 *
 * Three token-compliant ways to put one product category on a recall card,
 * compared side by side over the SAME two real recalls before one of them was
 * wired into the shipped card. It stays in the harness so the comparison can
 * be re-inspected rather than re-argued, and so a future restyling can see
 * what was rejected and why.
 *
 * Each sample reproduces the part of the card every treatment touches — the
 * status row and the content row, at the card's own geometry — and varies
 * nothing else. The footer is omitted because no treatment reaches it.
 *
 *   A · inline metadata — the category joins the brand line after a middot.
 *       No container, no added height, and no fixed position: where it lands
 *       depends on how long the brand is, and it is the same type, size and
 *       colour as the brand, so it reads as more brand.
 *   B · subtle neutral tag — its own hairline-bordered mark under the brand,
 *       at a fixed left edge on every card. SHIPPED.
 *   C · filled neutral tag in the status row — the strongest treatment that
 *       still borrows no risk or relevance colour. It takes the card's most
 *       prominent metadata position, beside the risk badge, and a filled
 *       rectangle there reads as a second status.
 *
 * Only the real `CategoryTag` renders B; A and C are drawn here and nowhere
 * else, so neither rejected treatment exists in the product.
 */

type TagTreatment = 'inline' | 'tag' | 'status';

const TAG_TREATMENTS: readonly { key: TagTreatment; caption: string }[] = [
  {
    key: 'inline',
    caption: 'A · inline metadata on the brand line — rejected: no fixed position, reads as brand',
  },
  { key: 'tag', caption: 'B · subtle neutral tag under the brand — SHIPPED' },
  {
    key: 'status',
    caption: 'C · filled neutral tag in the status row — rejected: competes with the risk badge',
  },
];

function TreatmentSample({ model, treatment }: { model: HomeCardModel; treatment: TagTreatment }) {
  const label = model.categoryLabel;
  return (
    <Surface radius={16} border="border/subtle" elevation="card" style={styles.treatmentCard}>
      <View style={styles.treatmentStatusRow}>
        {model.risk.badgeLabel ? (
          <RiskLabel
            tier={model.risk.tier}
            label={model.risk.badgeLabel}
            accessibilityLabel={model.risk.accessibilityLabel}
          />
        ) : null}
        <Text variant="micro-caption" color="text/secondary">
          {model.activity.text}
        </Text>
        {treatment === 'status' && label ? (
          <View style={styles.filledCategoryTag}>
            <Text variant="caption">{label}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.treatmentContent}>
        <MediaTile uri={model.heroImageUrl} alt={model.productName} size={layout.cardMediaSize} />
        <View style={styles.treatmentIdentity}>
          <View>
            <Text variant="heading-3">{model.productName}</Text>
            <Text variant="caption" color="text/secondary">
              {treatment === 'inline' && label
                ? `${model.brand.text} · ${label}`
                : model.brand.text}
            </Text>
          </View>
          {treatment === 'tag' && label ? <CategoryTag label={label} /> : null}
          {model.reasonLine ? (
            <Text variant="body-small" color="text/secondary">
              {model.reasonLine}
            </Text>
          ) : null}
        </View>
      </View>
    </Surface>
  );
}

function CategoryTagGallery({ items }: { items: FeedItem[] }) {
  const today = todayIso();
  const models = useMemo(
    () => items.map((item) => buildHomeCardModel(item, { today, affectsYou: false })),
    [items, today],
  );
  const tagged = models.filter((model) => model.categoryLabel !== null);
  const untagged = models.length - tagged.length;

  if (tagged.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No live recall with a launch-visible category is loaded yet, so no treatment can be shown.
      </ThemedText>
    );
  }

  // The shortest and the longest real product name that actually carries a
  // displayable category: the two shapes a treatment has to survive.
  const shortest = tagged.reduce(
    (best, model) => (model.productName.length < best.productName.length ? model : best),
    tagged[0],
  );
  const longest = tagged.reduce(
    (best, model) => (model.productName.length > best.productName.length ? model : best),
    tagged[0],
  );
  const samples: { title: string; model: HomeCardModel }[] = [
    { title: `Short card · ${shortest.categoryLabel}`, model: shortest },
    { title: `Long card · ${longest.categoryLabel}`, model: longest },
  ];

  // Which labels the live feed actually produces, and how often.
  const counts = new Map<string, number>();
  for (const model of tagged) {
    const label = model.categoryLabel!;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const census = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ');

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Three token-compliant treatments over the same two real recalls, drawn at the card’s own
        geometry. Nothing is simulated: the category on each sample is the one the live projection
        stores. B is the product’s own CategoryTag; A and C exist only here.
      </Text>
      {samples.map((sample) => (
        <View key={sample.model.id} style={styles.feedCase}>
          <Text variant="body-small-bold">{sample.title}</Text>
          {TAG_TREATMENTS.map((treatment) => (
            <View key={treatment.key} style={styles.feedCase}>
              <Text variant="caption" color="text/secondary">
                {treatment.caption}
              </Text>
              <TreatmentSample model={sample.model} treatment={treatment.key} />
            </View>
          ))}
        </View>
      ))}

      <View style={styles.feedCase}>
        <Text variant="caption" color="text/secondary">
          Every launch-visible label as the shipped tag, so all nine words can be checked at their
          real width. The three launch-hidden ids (Prepared foods, Supplements, Other) have no tag
          and cannot be rendered here — nothing maps an id to a word outside the frozen vocabulary.
        </Text>
        <View style={styles.badges}>
          {LAUNCH_CATEGORY_OPTIONS.map((option) => (
            <CategoryTag key={option.value} label={option.label} />
          ))}
        </View>
      </View>

      <Text variant="caption" color="text/secondary">
        Live feed census — {tagged.length} of {models.length} loaded recalls show a tag; {untagged}{' '}
        show none (no stored categories, or only launch-hidden ones) and render no container, no
        spacer and nothing spoken. {census}
      </Text>
    </Surface>
  );
}

/**
 * The Recall Card's four states and its long-content and geography cases,
 * each on a REAL current recall chosen from the live feed for the shape it
 * has. Two values, and only two, are simulated, and the gallery says so on
 * screen: the Affects-you flag (so the relevance state can be inspected
 * without a matching personalization), and — only if every live recall
 * happens to carry an image — the missing image on the "no image" cards.
 * Tapping a card opens the real Recall Detail; Save writes this device's
 * own bookmark list and nothing else.
 */
function FeedCardGallery({ items }: { items: FeedItem[] }) {
  const today = todayIso();
  const models = useMemo(
    () => items.map((item) => buildHomeCardModel(item, { today, affectsYou: false })),
    [items, today],
  );
  if (models.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No live recalls loaded yet, so no card can be shown.
      </ThemedText>
    );
  }

  const withImage = models.find((model) => model.heroImageUrl !== null) ?? models[0];
  const liveWithoutImage = models.find((model) => model.heroImageUrl === null) ?? null;
  const withoutImage = liveWithoutImage ?? { ...withImage, heroImageUrl: null };
  const longest = (pick: (model: HomeCardModel) => string | null) =>
    models.reduce(
      (best, model) => ((pick(model)?.length ?? 0) > (pick(best)?.length ?? 0) ? model : best),
      models[0],
    );
  const longTitle = longest((model) => model.productName);
  const longSummary = longest((model) => model.reasonLine);
  const nationwide = models.find((model) => model.locationSummary === 'Nationwide') ?? null;
  const multiState = models.find((model) => model.locationSummary.includes('+')) ?? null;
  const alert = models.find((model) => model.noticeLabel !== null) ?? null;
  // P2B7I: the one card state the live corpus cannot supply on demand — a
  // stored hero whose URL cannot load. A real card's own model with its hero
  // swapped for a deliberately unreachable official-host URL; the caption
  // says so.
  const failingImage: HomeCardModel = { ...withImage, heroImageUrl: unreachableImage('card') };

  const cases: { caption: string; model: HomeCardModel }[] = [
    {
      caption: 'Affects you · image (relevance simulated)',
      model: { ...withImage, affectsYou: true },
    },
    {
      caption: `Affects you · no image (relevance simulated${liveWithoutImage ? '' : '; image removed'})`,
      model: { ...withoutImage, affectsYou: true },
    },
    { caption: 'Does not affect you · image', model: withImage },
    {
      caption: `Does not affect you · no image${liveWithoutImage ? '' : ' (image removed)'}`,
      model: withoutImage,
    },
    {
      caption:
        'SIMULATED: the image fails to load (an unreachable URL). While the request is active ' +
        'the card holds the square; once the failure is known it settles into the no-image ' +
        'layout and stays there — no grey rectangle, and no second request on later visits, ' +
        'because the session remembers the verdict.',
      model: failingImage,
    },
    { caption: 'Longest product name in the live feed', model: longTitle },
    {
      caption:
        'Longest product name · no image (image removed): the three-line clamp at the full ' +
        'card width, with no gap where a tile would have been.',
      model: { ...longTitle, heroImageUrl: null },
    },
    {
      caption:
        'No image at an accessibility text size — a device setting this harness cannot ' +
        'simulate: set Settings › Accessibility › Display & Text Size › Larger Text first, ' +
        'then inspect this card. The text-led layout wraps; nothing is clipped or fixed.',
      model: withoutImage,
    },
    { caption: 'Longest summary in the live feed', model: longSummary },
    ...(nationwide ? [{ caption: 'Nationwide distribution', model: nationwide }] : []),
    ...(multiState
      ? [{ caption: 'Multi-state distribution (two codes, then +N)', model: multiState }]
      : []),
    ...(alert ? [{ caption: 'Public Health Alert notice label', model: alert }] : []),
  ];

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Real recalls from the live feed, drawn by the product’s own Recall Card on the page colour.
        Only the values each caption names are simulated. Tapping a card opens the real Recall
        Detail; Save writes only this device’s bookmark list, so the saved and unsaved states can be
        inspected by tapping it.
      </Text>
      {cases.map(({ caption, model }, index) => (
        <View key={`${index}-${model.id}`} style={styles.feedCase}>
          <Text variant="caption" color="text/secondary">
            {caption}
          </Text>
          <RecallCard model={model} />
        </View>
      ))}
    </Surface>
  );
}

/**
 * The Saved tab (P2B4): its whole-screen states with their real copy, its
 * two information notices, and its list — drawn by the SAME shared
 * `RecallCard` the Feed uses, at the same rhythm, over real current recalls
 * chosen from the live feed for the shapes a saved list has to survive (one
 * item, several, a long product name, no image, nationwide, multi-state, a
 * Public Health Alert, and one card per risk label the live corpus holds).
 *
 * Nothing here reads or writes the device's saved list: the gallery composes
 * cards from feed items directly, so no state below is this device's real
 * bookmark state, and no card here is missing because it was not saved. The
 * cards are live, so a card's own Save control writes this device's bookmark
 * list exactly as it does on the Feed — the gallery itself never toggles it.
 *
 * The missing-from-feed notice is shown on a simulated count, because it
 * appears only once a saved recall leaves the active corpus; the caption
 * says so.
 */
function SavedGallery({ items }: { items: FeedItem[] }) {
  const today = todayIso();
  const models = useMemo(
    () => items.map((item) => buildHomeCardModel(item, { today, affectsYou: false })),
    [items, today],
  );

  const longest = (pick: (model: HomeCardModel) => string | null) =>
    models.reduce(
      (best, model) => ((pick(model)?.length ?? 0) > (pick(best)?.length ?? 0) ? model : best),
      models[0],
    );
  const withImage = models.find((model) => model.heroImageUrl !== null) ?? models[0];
  const liveWithoutImage = models.find((model) => model.heroImageUrl === null) ?? null;
  const nationwide = models.find((model) => model.locationSummary === 'Nationwide') ?? null;
  const multiState = models.find((model) => model.locationSummary.includes('+')) ?? null;
  const alert = models.find((model) => model.noticeLabel !== null) ?? null;
  const byTier = RISK_FILTER_TIERS.map((tier) => ({
    tier,
    model: models.find((model) => model.risk.tier === tier) ?? null,
  }));
  const absentTiers = byTier.filter((entry) => entry.model === null).map((entry) => entry.tier);

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Saved’s whole-screen states with their real copy from lib/saved-recalls, then its list drawn
        by the product’s own Recall Card at the Feed’s rhythm over real recalls from the live feed.
        The gallery neither reads nor writes this device’s saved list, so nothing below reflects
        what is actually saved; tapping a card opens the real Recall Detail, and its Save control
        writes this device’s bookmark list exactly as it does on the Feed.
      </Text>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...SAVED_LOADING} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...SAVED_EMPTY} icon="bookmark" />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage title={SAVED_ERROR_TITLE} body={FEED_LOAD_FAILURE} />
      </Surface>
      <Text variant="caption" color="text/secondary">
        The two notices: a refresh that failed over a feed already on screen, and — on a simulated
        count of two, because it appears only once a saved recall leaves the active corpus — saved
        recalls the active feed no longer carries.
      </Text>
      <Callout tone="information">{FEED_STALE_NOTICE}</Callout>
      <Callout tone="information">{savedMissingNotice(2) ?? ''}</Callout>
      {models.length === 0 ? (
        <Text variant="caption" color="text/secondary">
          No live recalls loaded yet, so no saved list can be shown.
        </Text>
      ) : (
        <>
          <View style={styles.feedCase}>
            <Text variant="caption" color="text/secondary">
              One saved recall
            </Text>
            <RecallCard model={models[0]} />
          </View>
          <View style={styles.feedCase}>
            <Text variant="caption" color="text/secondary">
              Several saved recalls, newest save first, 16px apart
            </Text>
            {models.slice(0, 3).map((model) => (
              <RecallCard key={model.id} model={model} />
            ))}
          </View>
          <View style={styles.feedCase}>
            <Text variant="caption" color="text/secondary">
              Longest product name in the live feed
            </Text>
            <RecallCard model={longest((model) => model.productName)} />
          </View>
          <View style={styles.feedCase}>
            <Text variant="caption" color="text/secondary">
              {liveWithoutImage ? 'No image' : 'No image (image removed from a live recall)'}
            </Text>
            <RecallCard model={liveWithoutImage ?? { ...withImage, heroImageUrl: null }} />
          </View>
          {nationwide ? (
            <View style={styles.feedCase}>
              <Text variant="caption" color="text/secondary">
                Nationwide distribution
              </Text>
              <RecallCard model={nationwide} />
            </View>
          ) : null}
          {multiState ? (
            <View style={styles.feedCase}>
              <Text variant="caption" color="text/secondary">
                Multi-state distribution (two codes, then +N)
              </Text>
              <RecallCard model={multiState} />
            </View>
          ) : null}
          {alert ? (
            <View style={styles.feedCase}>
              <Text variant="caption" color="text/secondary">
                Public Health Alert notice label
              </Text>
              <RecallCard model={alert} />
            </View>
          ) : null}
          {byTier.map(({ tier, model }) =>
            model === null ? null : (
              <View key={tier} style={styles.feedCase}>
                <Text variant="caption" color="text/secondary">
                  Risk label · {tier}
                </Text>
                <RecallCard model={model} />
              </View>
            ),
          )}
          {absentTiers.length > 0 ? (
            <Text variant="caption" color="text/secondary">
              No current recall in the live feed carries: {absentTiers.join(', ')}. Every risk label
              is rendered on its own in the RISK LABELS gallery above.
            </Text>
          ) : null}
        </>
      )}
    </Surface>
  );
}

/**
 * The live Profile's components in the states the shipped screen can reach,
 * each handed a SIMULATED answer its caption names — the gallery reads no
 * store and writes none, so nothing here reflects this device's real
 * preferences. Every card and row is live: a card opens the real
 * Personalization screen, a row the real document.
 */
function ProfileGallery() {
  const ready = (prefs: Parameters<typeof summarizePreferences>[0]): PreferenceSummaryState => ({
    status: 'ready',
    summary: summarizePreferences(prefs),
  });
  const states: [caption: string, state: PreferenceSummaryState][] = [
    ['Loading — simulated: a read that has not answered', { status: 'loading' }],
    [
      'Empty preferences — simulated: the store answered with nothing chosen',
      ready(EMPTY_PREFERENCES),
    ],
    [
      'Populated — simulated: California, Peanuts and Milk, Costco and Trader Joe’s',
      ready({ state: 'CA', allergens: ['peanut', 'milk'], retailers: ['costco', 'trader-joes'] }),
    ],
    [
      'Long — simulated: District of Columbia, four allergens and three stores, summarized to two names and +N',
      ready({
        state: 'DC',
        allergens: ['peanut', 'tree nuts', 'milk', 'egg'],
        retailers: ['walmart', 'target', 'costco'],
      }),
    ],
    ['Read failure — simulated: the store could not be read', { status: 'unavailable' }],
  ];
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The Profile tab’s own components (components/profile), imported from production. Each
        Personalization card below is handed the simulated answer its caption names — this gallery
        neither reads nor writes this device’s preferences — and opens the real Personalization
        screen; the rows open the real documents.
      </Text>
      {states.map(([caption, state]) => (
        <GallerySample key={caption} caption={caption}>
          <PersonalizationCard
            label="Personalization"
            href="/settings/personalization"
            state={state}
          />
        </GallerySample>
      ))}
      {/* P2B7H: the hub's OWN group labels, from the registry, in the
          corrected title case — the convention that replaced the shouted
          caption. Rendered by the production `ProfileSection`, so a label
          that started shouting again would show here first. */}
      {PROFILE_DOCUMENT_GROUPS.map((group) => (
        <GallerySample key={group.title} caption={`Group label: ${group.title}`}>
          <ProfileSection title={group.title} footnote={group.footnote}>
            {group.slugs.map((slug) => {
              const doc = documentBySlug(slug);
              return doc ? (
                <NavigationRow
                  key={doc.slug}
                  label={doc.title}
                  href={{ pathname: '/document/[slug]', params: { slug: doc.slug } }}
                  hint={DOCUMENT_HINT}
                />
              ) : null;
            })}
          </ProfileSection>
        </GallerySample>
      ))}
      <GallerySample caption={`Group label: App, and ${DEVELOPMENT_HEADING}`}>
        <ProfileSection title="App">
          <ValueRow label={APP_VERSION_LABEL} value={versionLine(null, null)} />
        </ProfileSection>
      </GallerySample>
      <GallerySample caption="A grouped section: chevron rows, a value row, and a footnote caption">
        <ProfileSection title="App" footnote="A quiet caption associated with the group.">
          <NavigationRow
            label="Sources & Methodology"
            href={{ pathname: '/document/[slug]', params: { slug: 'sources-methodology' } }}
            hint={DOCUMENT_HINT}
          />
          <NavigationRow
            label="Privacy & Data Controls"
            summary="A row with its supporting line."
            href={{ pathname: '/document/[slug]', params: { slug: 'privacy-data-controls' } }}
            hint={DOCUMENT_HINT}
          />
          <ValueRow label={APP_VERSION_LABEL} value={versionLine(null, null)} />
        </ProfileSection>
      </GallerySample>
      <GallerySample caption="The development entry (renders only in a development build)">
        <DevelopmentEntry
          label="Design Preview"
          summary="Local tooling for screenshotting product states. Not part of the product."
          href="/design-preview"
        />
      </GallerySample>
    </Surface>
  );
}

/**
 * The Feed's controls and whole-screen states: the search bar, the chips in
 * both states, the relevance label, the icon set, and the state message with
 * the Feed's real copy. The controls here are live but wired to nothing —
 * they narrow no feed and open no sheet.
 */
function FeedControlsGallery() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'affects_me'>('all');
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Live controls wired to nothing: the search bar, the feed-mode pair, a filter chip in both
        states, the relevance label and the icon set. Below them, the Feed’s state messages with
        their real copy — the loading sample does not announce itself here.
      </Text>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search product, company, brand, or code"
        accessibilityLabel="Sample search"
      />
      <View style={styles.badges}>
        <Chip label="All" selected={mode === 'all'} onPress={() => setMode('all')} />
        <Chip
          label="Affects me"
          selected={mode === 'affects_me'}
          onPress={() => setMode('affects_me')}
        />
        <Chip label="Location" selected={false} trailingIcon="chevron-down" onPress={() => {}} />
        <Chip label="Location · 2" selected trailingIcon="chevron-down" onPress={() => {}} />
      </View>
      <RelevanceLabel />
      <View style={styles.badges}>
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} size={24} />
        ))}
      </View>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...FEED_LOADING} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...FEED_EMPTY_SEARCH} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage title={FEED_ERROR_TITLE} body={FEED_LOAD_FAILURE} />
      </Surface>
      <Surface background="background/subtle" radius={12} style={styles.feedCase}>
        <Text variant="heading-3">{PERSONALIZE_CTA.title}</Text>
        <Text variant="body-small">{PERSONALIZE_CTA.body}</Text>
      </Surface>
    </Surface>
  );
}

/**
 * Recall Detail's loading, not-found and load-failure messages with the real
 * copy from lib/detail-copy.ts (the loading sample does not announce itself
 * here), and the Information Callout in both tones on sample sentences —
 * the real affects-you and retracted-notice sentences are the presentation
 * contract's and render only on a real Detail.
 */
/**
 * A URL that is deliberately unreachable, for the ONE imagery state the live
 * corpus cannot supply on demand: a candidate whose image fails to load.
 *
 * It is not recall content and is never presented as one — the caption says
 * it is simulated. What it proves is the P2B7C correction's rule, kept in
 * P2B7I: a page that cannot render leaves the set, so the dots and the
 * counter always describe pages a shopper can actually reach.
 *
 * Each simulated failure gets its OWN unreachable URL. A failure is
 * remembered for the session (`image-failures`), so two samples sharing one
 * URL would let the first settle the second before it ever tried.
 */
function unreachableImage(name: string): string {
  return `https://www.fda.gov/files/design-preview-unreachable-${name}.png`;
}

/**
 * The production `OfficialImageSet` over the REAL header sets the probed
 * recalls produced — one sample per indicator shape (P2B7I: none, dots
 * only, dots AND counter, the largest), plus the two simulated failures.
 * Nothing here is a copy of the component or of a recall: the sets are
 * `DetailModel.productImages` exactly as Detail receives them, and a
 * simulated sample is a real set's own photographs with unreachable
 * candidates added — never an invented image.
 */
function ImagerySampleGallery({ confirmed }: { confirmed: Record<string, ConfirmedSections> }) {
  const sets = Object.values(confirmed)
    .map((entry) => entry.imageSet)
    .filter((set): set is DetailImageSet => set !== null);
  const withCount = (predicate: (count: number) => boolean) =>
    sets.find((set) => predicate(set.images.length)) ?? null;
  const one = withCount((count) => count === 1);
  // Dots only: the five-photo set when the probes found one (the largest
  // shape still marked one dot per image), else any set at or under it.
  const complete =
    withCount((count) => count === IMAGE_DOTS_WINDOW) ??
    withCount((count) => count >= 2 && count <= IMAGE_DOTS_WINDOW);
  // Dots AND counter: the six-photo set when found (the first shape whose
  // dots become a sliding window), else any larger set.
  const windowed =
    withCount((count) => count === IMAGE_DOTS_WINDOW + 1) ??
    withCount((count) => count > IMAGE_DOTS_WINDOW);
  const largest = sets.reduce<DetailImageSet | null>(
    (best, set) => (best === null || set.images.length > best.images.length ? set : best),
    null,
  );
  const paged = complete ?? windowed;
  const unreachable = (name: string, accessibilityLabel: string) => ({
    url: unreachableImage(name),
    accessibilityLabel,
    aspectRatio: null,
  });
  // A failed MIDDLE page: two real photographs around one unreachable
  // candidate, so the settling behaviour — and the survival of the healthy
  // pages on either side — is visible on real photography.
  const middleFailure: DetailImageSet | null =
    paged === null
      ? null
      : {
          images: [
            paged.images[0],
            unreachable('page', paged.images[0].accessibilityLabel),
            paged.images[1],
          ],
        };
  // Every candidate unreachable: the set must render nothing at all.
  const allFailed: DetailImageSet | null =
    paged === null
      ? null
      : {
          images: ['all-1', 'all-2', 'all-3'].map((name) =>
            unreachable(name, paged.images[0].accessibilityLabel),
          ),
        };

  const samples: { caption: string; set: DetailImageSet | null }[] = [
    { caption: 'One official photo — the static tile, with no indicator.', set: one },
    {
      caption:
        `Two to ${IMAGE_DOTS_WINDOW} official photos` +
        `${complete ? ` (this one: ${complete.images.length})` : ''} — one dot per image, and ` +
        'no counter: everything the agency published is a page.',
      set: complete,
    },
    {
      caption:
        `More than ${IMAGE_DOTS_WINDOW}` +
        `${windowed ? ` (this one: ${windowed.images.length})` : ''} — a sliding window of at ` +
        `most ${IMAGE_DOTS_WINDOW} dots AND the compact counter beside it. Swipe to the end: ` +
        'the window follows you, the counter reaches the last page, and every image is ' +
        'reachable. Never one indicator without the other.',
      set: windowed,
    },
    {
      caption:
        `The largest set these probes found${largest ? ` (${largest.images.length} official photos)` : ''}: ` +
        'every one of them is a page. Swiping to the last proves the counter never names an ' +
        'image you cannot reach.',
      set: largest,
    },
    {
      caption:
        'SIMULATED: three candidates, the middle one unreachable. The failed page leaves the ' +
        'set and the two real photographs stay — two dots, no counter, never a blank counted page.',
      set: middleFailure,
    },
    {
      caption:
        'SIMULATED: every candidate unreachable. Nothing renders under this caption — that empty ' +
        'space is the correct result, the same no-image shape Detail’s header takes.',
      set: allFailed,
    },
  ];

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The product’s own image set over real header sets from the recalls this hub probed. Only the
        last two samples simulate anything, and each says so. A simulated failure is remembered for
        the session, so it settles immediately on later visits to this hub.
      </Text>
      {samples.map((sample) => (
        <View key={sample.caption} style={styles.imagerySample}>
          <Text variant="caption" color="text/secondary">
            {sample.caption}
          </Text>
          {sample.set === null ? (
            <Text variant="body-small">No suitable recall among the probed cases.</Text>
          ) : (
            <OfficialImageSet set={sample.set} />
          )}
        </View>
      ))}
    </Surface>
  );
}

/** Every declared glyph with its name, at the two sizes the product uses. */
function IconGallery() {
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Every name the icon primitive declares, tinted as the product tints them. A blank cell here
        is a missing or wrongly-mapped asset, wherever it would otherwise have shown up.
      </Text>
      <View style={styles.iconGrid}>
        {ICON_NAMES.map((name) => (
          <View key={name} style={styles.iconCell}>
            <Icon name={name} size={24} />
            <Icon name={name} size={16} color="icon/secondary" />
            <Text variant="micro-caption" color="text/secondary">
              {name}
            </Text>
          </View>
        ))}
      </View>
    </Surface>
  );
}

function DetailStatesGallery() {
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        Recall Detail’s whole-screen states with their real copy, and the Information Callout in its
        warning and information tones on sample sentences. The loading sample does not announce
        itself here.
      </Text>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...DETAIL_LOADING} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage {...DETAIL_MISSING} />
      </Surface>
      <Surface radius={12} border="border/subtle">
        <StateMessage title={DETAIL_ERROR_TITLE} body={DETAIL_ERROR_FALLBACK} />
      </Surface>
      <Callout tone="warning">Sample warning callout — the affects-you treatment.</Callout>
      <Callout tone="information">
        Sample information callout — the retracted-notice treatment.
      </Callout>
    </Surface>
  );
}

// ── Detail title treatments (P2B7G) ─────────────────────────────────────────

/**
 * The simulated large-type factor for the title comparison. iOS's
 * accessibility sizes reach well past this; 1.6 approximates the first
 * accessibility step so the treatments can be compared side by side in one
 * screenshot. It multiplies the reader's real Dynamic Type setting rather
 * than replacing it, and the caption says the size is simulated — the real
 * behaviour is verified on the device, where the whole screen scales.
 */
const SIMULATED_LARGE_TYPE = 1.6;

/** The bounded treatment's line count before disclosure (treatment 2). */
const BOUNDED_TITLE_LINES = 4;

/**
 * A concise head clause is derivable ONLY when the source itself separates
 * one from its enumeration ("Various sizes of Hard and Soft Cheese
 * including: Ricotta Cheese, …"). An enumeration with no head clause has no
 * concise form that keeps every product variant, so no other shape derives.
 */
const CONCISE_HEAD_CLAUSE = /^(.{12,80}?)[,;:]?\s+(?:including:?|such as)\s/i;

function conciseHeadClause(title: string): string | null {
  const match = title.match(CONCISE_HEAD_CLAUSE);
  return match ? match[1].trim() : null;
}

/** Treatment 2: the bound plus its explicit, accessible disclosure. */
function BoundedTitleSample({ title, typeScale }: { title: string; typeScale?: number }) {
  const [expanded, setExpanded] = useState(false);
  const scaled =
    typeScale !== undefined
      ? {
          fontSize: typography['heading-2'].fontSize * typeScale,
          lineHeight: typography['heading-2'].lineHeight * typeScale,
        }
      : undefined;
  return (
    <View style={styles.titleSampleBlock}>
      <Text
        variant="heading-2"
        accessibilityRole="header"
        numberOfLines={expanded ? undefined : BOUNDED_TITLE_LINES}
        style={scaled}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          expanded ? 'Show less of the product name' : 'Show the full product name'
        }
        hitSlop={hitSlopToMinimum(typography.caption.lineHeight)}
        onPress={() => setExpanded((prior) => !prior)}>
        {({ pressed }) => (
          <Text variant="caption" color="action/secondary" style={pressed && { opacity: 0.6 }}>
            {expanded ? 'Show less' : 'Show full title'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * P2B7G: the Detail-title exploration — the decision record for how Recall
 * Detail should present extremely long official product names, compared over
 * the LONGEST real shopper titles in the live feed session at the Detail
 * header's own heading-2 type and identity-beside-media geometry.
 *
 *   1. The shipped unbounded title (production behaviour, unchanged).
 *   2. A four-line bound with an explicit accessible disclosure that grows
 *      the title in place. The clamped node's content stays the complete
 *      name, so VoiceOver always speaks the whole title.
 *   3. A deterministic concise display title — rendered only for a title
 *      whose source separates a head clause from its enumeration; the
 *      caption says when the live corpus provides none, and an enumerated
 *      multi-product name is never cut (that would drop real variants).
 *
 * Treatments 2 and 3 are drawn here and nowhere else; the hero footprint is
 * simulated with the shared media tile at the Detail media size.
 */
function DetailTitleGallery({ items }: { items: FeedItem[] }) {
  const today = todayIso();
  const models = useMemo(
    () => items.map((item) => buildHomeCardModel(item, { today, affectsYou: false })),
    [items, today],
  );
  if (models.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No live recalls loaded yet, so no title can be shown.
      </ThemedText>
    );
  }

  const byLength = [...models].sort((a, b) => b.productName.length - a.productName.length);
  const longest = byLength[0];
  const runnersUp = byLength.slice(1, 3);
  const concise = byLength.find((model) => conciseHeadClause(model.productName) !== null) ?? null;
  const heroUri =
    longest.heroImageUrl ?? byLength.find((m) => m.heroImageUrl)?.heroImageUrl ?? null;

  const identityRow = (children: React.ReactNode, withImage: boolean) => (
    <View style={styles.titleIdentityRow}>
      <View style={styles.titleIdentity}>{children}</View>
      {withImage ? (
        <MediaTile uri={heroUri} alt={longest.productName} size={layout.detailMediaSize} />
      ) : null}
    </View>
  );

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The longest real product names in the live feed, at Detail’s own heading type. Treatment 1
        is the shipped screen; treatments 2 and 3 are drawn only here. The hero footprint is
        simulated with the shared media tile; the large-type samples are simulated at ×
        {SIMULATED_LARGE_TYPE} on top of the current text size.
      </Text>

      <GallerySample
        caption={`Treatment 1 · unbounded (shipped) — ${longest.productName.length} characters, with imagery`}>
        {identityRow(
          <Text variant="heading-2" accessibilityRole="header">
            {longest.productName}
          </Text>,
          true,
        )}
      </GallerySample>
      <GallerySample
        caption={`Treatment 2 · bounded at ${BOUNDED_TITLE_LINES} lines with “Show full title”, with imagery`}>
        {identityRow(<BoundedTitleSample title={longest.productName} />, true)}
      </GallerySample>
      {concise ? (
        <GallerySample
          caption={`Treatment 3 · deterministic concise head clause (“${conciseHeadClause(concise.productName)}”) — derivable only where the source separates a head clause from its enumeration; the full name stays one disclosure away`}>
          {identityRow(
            <View style={styles.titleSampleBlock}>
              <Text variant="heading-2" accessibilityRole="header">
                {conciseHeadClause(concise.productName)}
              </Text>
              <BoundedTitleSample title={concise.productName} />
            </View>,
            false,
          )}
        </GallerySample>
      ) : (
        <Text variant="caption" color="text/secondary">
          Treatment 3 — no loaded title separates a head clause from its enumeration, so no concise
          display title can be derived without dropping product variants; nothing is invented.
        </Text>
      )}

      <GallerySample caption="Treatment 1 vs 2 · no imagery — the identity takes the full width">
        {identityRow(
          <Text variant="heading-2" accessibilityRole="header">
            {longest.productName}
          </Text>,
          false,
        )}
        {identityRow(<BoundedTitleSample title={longest.productName} />, false)}
      </GallerySample>

      <GallerySample
        caption={`Treatment 1 vs 2 · simulated large type (×${SIMULATED_LARGE_TYPE}), with imagery`}>
        {identityRow(
          <Text
            variant="heading-2"
            accessibilityRole="header"
            style={{
              fontSize: typography['heading-2'].fontSize * SIMULATED_LARGE_TYPE,
              lineHeight: typography['heading-2'].lineHeight * SIMULATED_LARGE_TYPE,
            }}>
            {longest.productName}
          </Text>,
          true,
        )}
        {identityRow(
          <BoundedTitleSample title={longest.productName} typeScale={SIMULATED_LARGE_TYPE} />,
          true,
        )}
      </GallerySample>

      {runnersUp.map((model) => (
        <GallerySample
          key={model.id}
          caption={`Treatment 2 · next-longest title — ${model.productName.length} characters`}>
          {identityRow(<BoundedTitleSample title={model.productName} />, false)}
        </GallerySample>
      ))}
    </Surface>
  );
}

// ── Illness notice (P2B7K) ──────────────────────────────────────────────────

/**
 * The SHIPPED compact illness notice, in every state the live corpus produces,
 * and the `What Happened` narrative each one leaves behind.
 *
 * Nothing here is a mock-up or an alternative: `IllnessNotice` is the
 * production component, the copy is the production contract's own output, and
 * the identity column is reproduced at Recall Detail's real geometry — `flex:
 * 1` beside a `layout.detailMediaSize` hero — because that geometry is what
 * the notice actually gets. Beside imagery on a 390pt screen the column is
 * about 194pt wide, which is why the notice is auto-width and shrinkable
 * rather than a full-width band.
 *
 * The founder's rule is visible in the last four rows: an injury, an adverse
 * reaction, a hospitalization and a mixed figure each produce NO notice, and
 * each sentence stays in the narrative exactly as the source wrote it.
 */
const ILLNESS_STATES: readonly { caption: string; source: string }[] = [
  { caption: '1 illness', source: 'One consumer illness has been reported to date.' },
  {
    caption: 'multiple illnesses',
    source:
      'There have been reports of 12 confirmed cases of consumers experiencing stomach illness linked to this product.',
  },
  {
    caption: 'qualified illness count',
    source: 'To date, approximately 470 illnesses have been reported to the agency.',
  },
  {
    caption: 'illnesses without a count',
    source:
      'Illnesses have been reported; the number and extent of which are currently under investigation.',
  },
  {
    caption: 'explicit no illnesses',
    source: 'No illnesses have been reported to date.',
  },
  {
    caption: 'unknown — no notice renders',
    source: 'The product was distributed to retail stores in Ohio and Indiana.',
  },
  {
    caption: 'injury statement — no notice; the sentence stays in What Happened',
    source: 'One consumer reported a dental injury from consuming the product.',
  },
  {
    caption: 'adverse-reaction statement — no notice; the sentence stays in What Happened',
    source:
      'There have been no confirmed reports of adverse reactions due to consumption of these products.',
  },
  {
    caption: 'hospitalization and death — retained in What Happened, never in the notice',
    source:
      'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.',
  },
  {
    caption: 'mixed figure — no fabricated illness count; the statement is retained',
    source:
      'To date, the company has received approximately 470 reports of illness or adverse reactions.',
  },
];

const ILLNESS_SHORT_TITLE = 'Soft Ripened Cheese';
const ILLNESS_LONG_TITLE =
  'Various sizes of Hard and Soft Cheese including: Ricotta Cheese, Fresh Mozzarella, Smoked Scamorza and Aged Provolone Wedges';

/** The notice in its real place: below the brand, above the official link. */
function IllnessPlacement({
  copy,
  title,
  brand,
  images,
  typeScale,
  heroUri,
}: {
  copy: IllnessNoticeCopy | null;
  title: string;
  brand: string;
  images: 0 | 1 | 2;
  typeScale?: number;
  heroUri: string | null;
}) {
  const scaled =
    typeScale === undefined
      ? undefined
      : {
          fontSize: typography['heading-2'].fontSize * typeScale,
          lineHeight: typography['heading-2'].lineHeight * typeScale,
        };
  return (
    <View style={styles.illnessIdentityRow}>
      <View style={styles.illnessIdentity}>
        <View style={styles.illnessTitleBlock}>
          <Text variant="heading-2" accessibilityRole="header" style={scaled}>
            {title}
          </Text>
          <Text variant="body-small" color="text/secondary">
            {brand}
          </Text>
        </View>
        {/* Unknown renders NOTHING here — no row, no spacer, no placeholder. */}
        {copy ? <IllnessNotice copy={copy} /> : null}
        <View style={styles.illnessLink}>
          <Text variant="caption" color="action/secondary">
            Read the official FDA notice
          </Text>
          <Icon name="external-link" size={16} color="icon/brand" />
        </View>
      </View>
      {images > 0 ? (
        <View style={styles.illnessMediaColumn}>
          <MediaTile uri={heroUri} alt={title} size={layout.detailMediaSize} />
          {images > 1 ? (
            <Text variant="caption" color="text/secondary">
              1 of 3
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function IllnessNoticeGallery({ items }: { items: FeedItem[] }) {
  const today = todayIso();
  const heroUri = useMemo(() => {
    for (const item of items) {
      const model = buildHomeCardModel(item, { today, affectsYou: false });
      if (model.heroImageUrl) return model.heroImageUrl;
    }
    return null;
  }, [items, today]);

  const states = useMemo(
    () =>
      ILLNESS_STATES.map((state) => {
        const status = deriveIllnessStatus(state.source);
        return { ...state, status, copy: illnessNoticeCopy(status) };
      }),
    [],
  );
  const withSeverity = states.find((state) => state.caption.startsWith('hospitalization'))!;

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The shipped component, over real source prose from the live corpus. The notice carries
        illnesses and nothing else: an injury, an adverse reaction, a hospitalization and a figure
        shared between two harms all render no notice at all, and every one of those sentences stays
        in What Happened untouched.
      </Text>

      <Text variant="body-small-bold">The notice, state by state</Text>
      {states.map((state) => (
        <GallerySample key={state.caption} caption={state.caption}>
          {state.copy ? (
            <IllnessNotice copy={state.copy} />
          ) : (
            <Text variant="caption" color="text/secondary">
              No notice renders — the source never established illness status, and silence is not a
              zero.
            </Text>
          )}
        </GallerySample>
      ))}

      <Text variant="body-small-bold">In place: below the brand, above the official link</Text>
      <GallerySample
        caption={`With one image — the identity column is ${layout.detailMediaSize}pt narrower than the page`}>
        <IllnessPlacement
          copy={withSeverity.copy}
          title={ILLNESS_SHORT_TITLE}
          brand="Fromagerie Bel"
          images={1}
          heroUri={heroUri}
        />
      </GallerySample>
      <GallerySample caption="No image — the identity takes the full width">
        <IllnessPlacement
          copy={withSeverity.copy}
          title={ILLNESS_SHORT_TITLE}
          brand="Fromagerie Bel"
          images={0}
          heroUri={null}
        />
      </GallerySample>
      <GallerySample caption="Multiple images and a long title">
        <IllnessPlacement
          copy={states[1].copy}
          title={ILLNESS_LONG_TITLE}
          brand="Savello USA"
          images={2}
          heroUri={heroUri}
        />
      </GallerySample>
      <GallerySample caption="Explicit no illnesses, long title, no image">
        <IllnessPlacement
          copy={states[4].copy}
          title={ILLNESS_LONG_TITLE}
          brand="Savello USA"
          images={0}
          heroUri={null}
        />
      </GallerySample>
      <GallerySample
        caption={`Simulated accessibility type (×${SIMULATED_LARGE_TYPE}) beside a hero`}>
        <IllnessPlacement
          copy={withSeverity.copy}
          title={ILLNESS_SHORT_TITLE}
          brand="Fromagerie Bel"
          images={1}
          typeScale={SIMULATED_LARGE_TYPE}
          heroUri={heroUri}
        />
      </GallerySample>
      <GallerySample caption="With the Affects You warning directly below the header">
        <IllnessPlacement
          copy={withSeverity.copy}
          title={ILLNESS_SHORT_TITLE}
          brand="Fromagerie Bel"
          images={1}
          heroUri={heroUri}
        />
        <Callout tone="warning">Warning: This recall affects you.</Callout>
      </GallerySample>

      <GallerySample caption="Beside the CRITICAL risk badge — an illness count is not a risk level">
        <View style={styles.illnessStatusRow}>
          <RiskLabel tier="critical" label="Critical" accessibilityLabel="Risk level: Critical" />
          <Text variant="caption" color="text/secondary">
            Updated 12 Sep
          </Text>
        </View>
        <IllnessNotice copy={withSeverity.copy!} />
        <IllnessNotice copy={states[4].copy!} />
      </GallerySample>

      <Text variant="body-small-bold">What Happened, beside the notice</Text>
      <Text variant="caption" color="text/secondary">
        An illness sentence is removed only when the notice completely represents it. A sentence
        that also carries a hospitalization, a death, an injury, an adverse reaction or a
        qualification stays — showing a count twice is a blemish, dropping a death is a correctness
        failure.
      </Text>
      {states.map((state) => {
        const narrative = `The firm is recalling the product after routine testing found Listeria monocytogenes. ${state.source} The recall covers 1,200 cases.`;
        const deduped = narrativeWithoutIllness(narrative, state.status);
        return (
          <GallerySample key={`wh-${state.caption}`} caption={state.caption}>
            {state.copy ? (
              <IllnessNotice copy={state.copy} />
            ) : (
              <Text variant="caption" color="text/secondary">
                No notice renders.
              </Text>
            )}
            <Text variant="caption" color="text/secondary">
              {deduped === narrative
                ? 'What Happened (unchanged)'
                : 'What Happened (de-duplicated)'}
            </Text>
            <Text variant="body-small">{deduped}</Text>
          </GallerySample>
        );
      })}
    </Surface>
  );
}

/**
 * The questionnaire's steps and states, one under another, drawn by the
 * real step components (components/report-questionnaire) so a screenshot is
 * of the product's own composition. The choices are a real eligible recall's
 * own — its jurisdictions and the retailers its notice names — narrowed or
 * widened only to give each step the shape it demonstrates: one state for
 * the confirm, the supported-jurisdiction registry for the searchable list.
 * Every caption names which. Rows here are live so the chosen state can be
 * inspected; Next, Back, Submit and Done are wired to nothing, and nothing
 * here reads or writes shopper-report state.
 *
 * A recall with no official geography is ineligible for reports, so it has
 * no questionnaire at all: the gallery shows the screen's own unavailable
 * state for it rather than a form that could never be submitted.
 */
function QuestionnaireGallery({ source }: { source: ScreenedCandidate | null }) {
  const states = source?.allowedStateCodes ?? [];
  const retailers = source?.retailerChoices ?? [];
  const singleState: QuestionnaireChoices = {
    allowedStateCodes: states.length > 0 ? [states[0]] : SUPPORTED_STATE_CODES.slice(0, 1),
    retailerChoices: [],
  };
  const multiState: QuestionnaireChoices = {
    allowedStateCodes: states.length > 1 ? states : SUPPORTED_STATE_CODES.slice(0, 4),
    retailerChoices: retailers,
  };
  const nationwide: QuestionnaireChoices = {
    allowedStateCodes: SUPPORTED_STATE_CODES,
    retailerChoices: retailers,
  };
  const withRetailers: QuestionnaireChoices = {
    allowedStateCodes: multiState.allowedStateCodes,
    retailerChoices: retailers,
  };
  // A complete set of answers from the section's own first choices, for the
  // review samples. Never a state or store the section does not offer.
  const complete: QuestionnaireAnswers = {
    declined: false,
    stateCode: withRetailers.allowedStateCodes[0],
    retailer: retailers[0] ?? RETAILER_NOT_SURE,
    purchaseWindow: 'past_month',
  };
  const noop = () => {};
  const origin =
    source === null ? 'the supported-jurisdiction registry' : 'a real recall’s own choices';

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The questionnaire’s steps and states, drawn by the real step components. Choices come from{' '}
        {origin}; each caption says which. Rows are live; Next, Back, Submit and Done are wired to
        nothing, and no shopper-report state is read or written here. A recall with no official
        geography is ineligible for reports altogether, so it has no questionnaire to show — the
        screen’s own unavailable state stands for it.
      </Text>
      <GallerySample caption="Single-state confirmation — the notice’s first state alone">
        <LiveQuestion section={singleState} stepKey="state" />
      </GallerySample>
      <GallerySample
        caption={`Multi-state picker — ${
          states.length > 1 ? 'the notice’s own states' : 'four registry states, unsearched'
        }`}>
        <LiveQuestion section={multiState} stepKey="state" />
      </GallerySample>
      <GallerySample caption="Nationwide — every supported jurisdiction behind the search field">
        <LiveQuestion section={nationwide} stepKey="state" />
      </GallerySample>
      <GallerySample caption="Unknown geography — ineligible: the questionnaire is never reached, and a deep link lands here">
        <StateMessage {...REPORT_UNAVAILABLE} />
      </GallerySample>
      {retailers.length > 0 ? (
        <GallerySample caption="Retailer choices — the notice’s own canonical stores, plus not sure">
          <LiveQuestion section={withRetailers} stepKey="retailer" />
        </GallerySample>
      ) : (
        <Text variant="body-small" color="text/secondary">
          No eligible recall in the live feed names a retailer, so the store question cannot be
          shown here.
        </Text>
      )}
      <GallerySample caption="Purchase timeframe — the five closed buckets, one chosen">
        <LiveQuestion
          section={withRetailers}
          stepKey="window"
          initial={{ ...EMPTY_ANSWERS, purchaseWindow: 'past_month' }}
        />
      </GallerySample>
      <GallerySample caption="Review and disclosure — a first submission">
        <ReviewStep
          section={withRetailers}
          answers={complete}
          canSubmit
          busy={null}
          failure={null}
          onSubmit={noop}
          onBack={noop}
          onOpenPrivacy={noop}
          mode="submit"
        />
      </GallerySample>
      <GallerySample caption="Review while editing — the update action and the removal control">
        <ReviewStep
          section={withRetailers}
          answers={complete}
          canSubmit
          busy={null}
          failure={null}
          onSubmit={noop}
          onBack={noop}
          onOpenPrivacy={noop}
          mode="update"
          onRemove={noop}
        />
      </GallerySample>
      <GallerySample caption="Recoverable error — the submission was refused; answers stay">
        <ReviewStep
          section={withRetailers}
          answers={complete}
          canSubmit
          busy={null}
          failure={SUBMIT_FAILURE}
          onSubmit={noop}
          onBack={noop}
          onOpenPrivacy={noop}
          mode="submit"
        />
      </GallerySample>
      <GallerySample caption="Success">
        <OutcomeStep title={SUCCESS_TITLE} body={SUCCESS_BODY} onDone={noop} />
      </GallerySample>
      <GallerySample caption="Reporting paused with an existing report — removal only">
        <PausedStep busy={false} failure={null} onRemove={noop} />
      </GallerySample>
      <GallerySample caption="Reporting paused — a refused removal">
        <PausedStep busy={false} failure={REMOVE_FAILURE} onRemove={noop} />
      </GallerySample>
    </Surface>
  );
}

/** Preferences held in this gallery's memory alone, so the sections can be worked. */
function LivePreferences({ initial }: { initial: UserRecallPreferences }) {
  const [prefs, setPrefs] = useState<UserRecallPreferences>(initial);
  return (
    <View style={styles.formSample}>
      <PersonalizationForm prefs={prefs} onChange={setPrefs} />
    </View>
  );
}

/** The state row alone, its choice held here; the trigger opens the real sheet. */
function LiveState({ initial }: { initial: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return <StateSection value={value} onChange={setValue} />;
}

/** The state selector's contents inline: the sheet's search, Clear and radio rows. */
function LiveStateContent({
  initial,
  initialQuery = '',
}: {
  initial: string | null;
  initialQuery?: string;
}) {
  const [value, setValue] = useState<string | null>(initial);
  const noop = () => {};
  return (
    <StateSelectorContent
      value={value}
      onChange={setValue}
      onDone={noop}
      initialQuery={initialQuery}
    />
  );
}

/** The store row alone, its list held here; the trigger opens the real sheet. */
function LiveStores({ initial }: { initial: string[] }) {
  const [selected, setSelected] = useState<string[]>(initial);
  const toggle = (id: string) =>
    setSelected((prior) => (prior.includes(id) ? prior.filter((r) => r !== id) : [...prior, id]));
  return <StoreSection selected={selected} onToggle={toggle} />;
}

/** The store selector's contents inline, with the sheet's count line above. */
function LiveStoreContent({
  initial,
  initialQuery = '',
}: {
  initial: string[];
  initialQuery?: string;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const toggle = (id: string) =>
    setSelected((prior) => (prior.includes(id) ? prior.filter((r) => r !== id) : [...prior, id]));
  return (
    <View style={styles.formSample}>
      <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
        {storeCountLabel(selected.length)}
      </Text>
      <StoreSelectorContent selected={selected} onToggle={toggle} initialQuery={initialQuery} />
    </View>
  );
}

/**
 * The Personalization screen's sections and selectors in every state the
 * screen can reach. Each sample's preferences live in this gallery's memory:
 * choosing here changes the sample and nothing else — no store is imported,
 * so nothing can be saved or synced, and no sample contacts a backend.
 */
function PersonalizationGallery() {
  const populated: UserRecallPreferences = {
    state: 'CA',
    allergens: ['peanut', 'milk'],
    retailers: ['costco', 'trader-joes'],
  };
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The Personalization screen’s own sections and selectors (components/settings), imported from
        production. Every sample below is simulated in this gallery’s memory: it neither reads nor
        writes this device’s preferences, and choosing here saves nothing. A row opens its real
        sheet over this gallery; the selector samples show the sheet’s contents inline.
      </Text>
      <GallerySample caption="Loading — simulated: a read that has not answered">
        <PreferencesNotReady status="loading" />
      </GallerySample>
      <GallerySample caption="Empty selections — simulated: the store answered with nothing chosen">
        <LivePreferences initial={EMPTY_PREFERENCES} />
      </GallerySample>
      <GallerySample caption="Populated — simulated: California, Peanuts and Milk, Costco and Trader Joe’s">
        <LivePreferences initial={populated} />
      </GallerySample>
      <GallerySample caption="Read failure — simulated: the store could not be read">
        <PreferencesNotReady status="failed" />
      </GallerySample>

      <GallerySample caption="State row, no selection — simulated: nothing chosen; the row opens the real sheet">
        <LiveState initial={null} />
      </GallerySample>
      <GallerySample caption="State row, existing selection — simulated: California">
        <LiveState initial="CA" />
      </GallerySample>
      <GallerySample caption="State selector, search — simulated: “new” typed, four rows match">
        <LiveStateContent initial={null} initialQuery="new" />
      </GallerySample>
      <GallerySample caption="State selector, clear while open — simulated: California checked; Clear selection empties it and the list stays">
        <LiveStateContent initial="CA" />
      </GallerySample>
      <GallerySample caption="State selector, replace — simulated: Nevada checked; choosing another row replaces it (on the sheet, that also closes it)">
        <LiveStateContent initial="NV" />
      </GallerySample>

      <GallerySample caption="Store row, none selected — simulated: the row reads No stores selected and offers Add stores">
        <LiveStores initial={[]} />
      </GallerySample>
      <GallerySample caption="Store row, several selected — simulated: Costco, Trader Joe’s and Walmart, with Edit stores">
        <LiveStores initial={['costco', 'trader-joes', 'walmart']} />
      </GallerySample>
      <GallerySample caption="Store row, long names — simulated: five long catalog names wrapping in the row">
        <LiveStores initial={['whole-foods', 'sprouts', 'giant-food', 'tops', 'pcc']} />
      </GallerySample>
      <GallerySample caption="Store selector, no query — simulated: nothing chosen, the whole catalog in order">
        <LiveStoreContent initial={[]} />
      </GallerySample>
      <GallerySample caption="Store selector, filtered — simulated: “co” typed">
        <LiveStoreContent initial={[]} initialQuery="co" />
      </GallerySample>
      <GallerySample caption="Store selector, several checked in place — simulated: Albertsons, Costco and Kroger checked; checking more never moves a row">
        <LiveStoreContent initial={['albertsons', 'costco', 'kroger']} />
      </GallerySample>
      <GallerySample caption="Store selector, no results — simulated: a search no store matches">
        <LiveStoreContent initial={[]} initialQuery="zzzz" />
      </GallerySample>
    </Surface>
  );
}

/**
 * The Notifications screen's panel in every permission state. The views
 * are handed in; the three callbacks do nothing, so no sample can request
 * permission, register a token, or open system settings.
 */
function NotificationsGallery() {
  const noop = () => {};
  const ready = (
    alerts: 'not_enabled' | 'enabled' | 'denied',
    error: string | null = null,
  ): NotificationsView => ({ status: 'ready', alerts, busy: false, error });
  const views: [caption: string, view: NotificationsView][] = [
    ['Loading — simulated: the status read has not answered', { status: 'loading' }],
    [
      'Not determined — simulated: never asked, so not enabled here; the action is the explicit enable',
      ready('not_enabled'),
    ],
    ['Enabled — simulated: permission granted and this device registered', ready('enabled')],
    [
      'Denied but askable — simulated: the OS reported a denial it can ask again about, which the status model shows as not enabled (the same screen)',
      ready('not_enabled'),
    ],
    [
      'System settings required — simulated: denied and cannot be asked again; the action opens system settings',
      ready('denied'),
    ],
    ['Unavailable / unsupported — simulated: the web', { status: 'unsupported' }],
    [
      'Operation failure — simulated: the enable was attempted and threw; the message reads beneath the action',
      ready('not_enabled', GENERIC_FAILURE),
    ],
  ];
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The Notifications screen’s own panel (components/settings), imported from production. Every
        view below is simulated: nothing here reads the permission, and the actions are wired to
        nothing — no prompt, no registration, no system settings.
      </Text>
      {views.map(([caption, view]) => (
        <GallerySample key={caption} caption={caption}>
          <NotificationsPanel view={view} onEnable={noop} onDisable={noop} onOpenSettings={noop} />
        </GallerySample>
      ))}
    </Surface>
  );
}

/**
 * Development-only: make the REAL root error boundary appear (P3C1.5).
 *
 * The boundary is the one screen that cannot be reached by using the app
 * correctly, so without this the only way to see it was to break something on
 * purpose and rebuild. Pressing the control below throws during render, which
 * is exactly the class of failure `AppErrorBoundary` exists to catch — so
 * what appears is the production failure screen itself, not a copy of it, and
 * its "Try again" really is Expo Router's `retry()` putting the app back.
 *
 * It is not a product surface and cannot become one: the whole body is behind
 * the bare `__DEV__` identifier, so a release bundle drops the throw with it,
 * and the only thing that renders this lives inside the Design Preview hub,
 * which is itself unreachable in a release build.
 */
function ErrorBoundaryProbe() {
  const [thrown, setThrown] = useState(false);
  if (!__DEV__) return null;
  if (thrown) {
    // Deliberate, and only ever reachable from the press below.
    throw new Error('Design Preview: deliberate render failure (development only).');
  }
  return (
    <Button
      label="Throw a render error"
      variant="secondary"
      onPress={() => setThrown(true)}
      accessibilityHint="Shows the real failure screen. Try again returns to the app."
    />
  );
}

/**
 * P2B7H: the three compact-card details this milestone changed, shown where
 * they can be compared rather than hunted for screen by screen.
 *
 *   1. The activity date beside EVERY major status shape — all seven risk
 *      labels, the Public Health Alert notice label, and the Affects You
 *      relevance label — so the metadata hierarchy can be judged against
 *      the thing it sits next to rather than on its own.
 *   2. The icon-only save control in both states, drawn by the PRODUCT's own
 *      `SaveControlAppearance` over a state this gallery decides. Nothing
 *      here reads or writes this device's bookmark list, so both states are
 *      always visible; the live cards in the Feed and Saved galleries are
 *      where a real tap is inspected.
 *   3. The summary rule over source text with and without punctuation,
 *      including the strings it must REFUSE to change.
 *
 * The real risk labels, notice label and relevance label are the production
 * components; the dates are the production `activityDisplay` wording.
 */
function StatusMetadataGallery() {
  const dates = ['Updated Today', 'Updated Aug 21', 'Announced Sep 15'];
  const punctuation: [source: string, note: string][] = [
    ['Import violation.', 'a Lotly line — the stop is dropped'],
    ['Undeclared peanut allergen.', 'a Lotly line — the stop is dropped'],
    ['Potential Listeria monocytogenes contamination.', 'a Lotly line — the stop is dropped'],
    ['Net weight 1.5 oz.', 'a unit abbreviation — kept'],
    ['Recalled by Acme Foods Inc.', 'a company suffix — kept'],
    ['Undeclared milk. Undeclared soy.', 'multi-sentence source text — kept'],
    ['Reason unclear…', 'an ellipsis — kept'],
    ['Produced without required inspection', 'already unpunctuated — unchanged'],
  ];

  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        P2B7H. The production status components with the card&rsquo;s own date token beside them,
        the icon-only save control in both states, and the summary rule over real wording. Nothing
        here reads or writes this device&rsquo;s saved list.
      </Text>

      <GallerySample caption="The date beside every risk label — caption, 12pt, text/secondary">
        <View style={styles.feedCase}>
          {RISK_FILTER_TIERS.map((tier) => {
            const risk = riskView(TIER_SAMPLE[tier], 'FDA', 'recall');
            return (
              <View key={tier} style={styles.treatmentStatusRow}>
                <RiskLabel
                  tier={risk.tier}
                  label={risk.badgeLabel ?? ''}
                  accessibilityLabel={risk.accessibilityLabel}
                />
                <Text variant="caption" color="text/secondary">
                  {dates[0]}
                </Text>
              </View>
            );
          })}
        </View>
      </GallerySample>

      {/* P2B7N: the four status treatments side by side, each built by the
          REAL `riskView` from a real classification and notice type and
          rendered by the production components in the card's own status-row
          order — so this matrix cannot claim a treatment the product does not
          actually produce. The first row is the milestone's whole point: a
          Public Health Alert's `unknown` carries no risk label at all, and
          PUBLIC HEALTH ALERT moves into the leading position with nothing
          left behind it. */}
      <GallerySample caption="P2B7N · status treatments: what each notice type and classification shows">
        <View style={styles.feedCase}>
          {STATUS_TREATMENTS.map((sample) => {
            const risk = riskView(sample.classification, sample.agency, sample.noticeType);
            return (
              <View key={sample.caption} style={styles.feedCase}>
                <View style={styles.treatmentStatusRow}>
                  {risk.badgeLabel ? (
                    <RiskLabel
                      tier={risk.tier}
                      label={risk.badgeLabel}
                      accessibilityLabel={risk.accessibilityLabel}
                    />
                  ) : null}
                  {noticeLabel(sample.noticeType) ? (
                    <NoticeLabel label={noticeLabel(sample.noticeType)!} />
                  ) : null}
                  <Text variant="caption" color="text/secondary">
                    {dates[0]}
                  </Text>
                </View>
                <Text variant="micro-caption" color="text/secondary">
                  {sample.caption}
                </Text>
              </View>
            );
          })}
        </View>
      </GallerySample>

      <GallerySample caption="The date beside the notice label and the relevance label, in all three wordings">
        <View style={styles.feedCase}>
          {dates.map((date) => (
            <View key={date} style={styles.treatmentStatusRow}>
              <NoticeLabel label="Public Health Alert" />
              <Text variant="caption" color="text/secondary">
                {date}
              </Text>
              <RelevanceLabel />
            </View>
          ))}
        </View>
      </GallerySample>

      <GallerySample caption="Icon-only save — unsaved (outline) and saved (filled), the product's own control">
        <View style={styles.treatmentStatusRow}>
          {[false, true].map((saved) => (
            <View key={String(saved)} style={styles.treatmentStatusRow}>
              <SaveControlAppearance state={saveControlState(saved)} />
              <Text variant="caption" color="text/secondary">
                {saveControlState(saved).accessibilityLabel}
                {saveControlState(saved).selected ? ' · selected' : ''}
              </Text>
            </View>
          ))}
        </View>
      </GallerySample>

      <GallerySample caption="Icon-only save, pressed">
        <View style={styles.treatmentStatusRow}>
          <SaveControlAppearance state={saveControlState(false)} pressed />
          <SaveControlAppearance state={saveControlState(true)} pressed />
        </View>
      </GallerySample>

      <GallerySample caption="The summary rule: source text → the card's line (the rule is presentation-only)">
        <View style={styles.feedCase}>
          {punctuation.map(([source, note]) => (
            <View key={source}>
              <Text variant="body-small">{cardSummaryText(source)}</Text>
              <Text variant="caption" color="text/secondary">
                {`${source} — ${note}`}
              </Text>
            </View>
          ))}
        </View>
      </GallerySample>
    </Surface>
  );
}

function GallerySample({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <View style={styles.feedCase}>
      <Text variant="caption" color="text/secondary">
        {caption}
      </Text>
      {children}
    </View>
  );
}

/** The first block of a kind in a registered document — real content, never a sample sentence. */
function documentBlock(slug: string, kind: DocumentBlock['kind']): DocumentBlock | null {
  const doc = documentBySlug(slug);
  if (!doc) return null;
  for (const section of doc.sections) {
    const block = section.blocks.find((candidate) => candidate.kind === kind);
    if (block) return block;
  }
  return null;
}

function documentSection(slug: string, title: string): TrustDocument['sections'][number] | null {
  return documentBySlug(slug)?.sections.find((section) => section.title === title) ?? null;
}

/**
 * The trust documents' renderer (components/document) and the reset panel
 * (components/installation-reset-section), imported from production, over
 * the registry's own content. Every document sample is REAL content — the
 * shortest and the longest registered document in full, and one real block
 * of each kind — because a rendered sample sentence would prove nothing
 * about the documents. The reset panel's states are simulated: each is the
 * panel with its state handed in and its press wired to nothing, so no
 * sample can open the dialog or start a run; the confirming state is the
 * dialog's own words as text, because the dialog itself is the platform's.
 */
function DocumentGallery() {
  const noop = () => {};
  const byLength = [...TRUST_DOCUMENTS].sort((a, b) => documentLength(a) - documentLength(b));
  const shortest = byLength[0];
  const longest = byLength[byLength.length - 1];
  const prose = documentSection('how-affects-me-works', 'How allergen matching works');
  const bulletsBlock = documentBlock('privacy-data-controls', 'bullets');
  const internalLink = documentBlock('how-affects-me-works', 'document-link');
  const externalLink = documentBlock('sources-methodology', 'link');
  const noteBlock = documentBlock('safety-disclaimer', 'note');
  const riskDoc = documentBySlug('risk-levels');
  const riskBlocks = (riskDoc?.sections ?? [])
    .flatMap((section) => section.blocks)
    .filter((block) => block.kind === 'risk-levels');
  return (
    <Surface
      background="background/page"
      radius={16}
      border="border/subtle"
      style={styles.feedGallery}>
      <Text variant="caption" color="text/secondary">
        The trust documents’ shared renderer and blocks (components/document), imported from
        production, over the registry’s own real content. Nothing here is rewritten or invented. The
        reset panel below is the production panel with each state handed in and its press wired to
        nothing: no sample can open the confirmation or start a deletion.
      </Text>
      <GallerySample
        caption={`Short document — real: ${shortest.title}, the shortest registered document, in full`}>
        <DocumentView doc={shortest} />
      </GallerySample>
      <GallerySample
        caption={`Long document — real: ${longest.title}, the longest registered document, in full`}>
        <DocumentView doc={longest} />
      </GallerySample>
      {prose ? (
        <GallerySample caption="Paragraphs and a section heading — real: one section of How Affects Me Works">
          <DocumentSectionView section={prose} />
        </GallerySample>
      ) : null}
      {bulletsBlock ? (
        <GallerySample caption="Bulleted list — real: the first list in Privacy & Data Controls (no document holds a numbered list, so the model has none)">
          <DocumentBlockView block={bulletsBlock} />
        </GallerySample>
      ) : null}
      {internalLink ? (
        <GallerySample caption="Internal link — real: How Affects Me Works’ link to Privacy & Data Controls; tapping opens the real document">
          <DocumentBlockView block={internalLink} />
        </GallerySample>
      ) : null}
      {externalLink ? (
        <GallerySample caption="External link — real: Sources & Methodology’s first official-source link; tapping opens its exact URL in the browser">
          <DocumentBlockView block={externalLink} />
        </GallerySample>
      ) : null}
      {noteBlock ? (
        <GallerySample caption="Information callout — real: the Safety Disclaimer’s medical-advice note (a note block)">
          <DocumentBlockView block={noteBlock} />
        </GallerySample>
      ) : null}
      <GallerySample caption="Warning callout — simulated: the primitive on a labelled sample sentence, for comparison; no document block uses the lime tone, which is personal relevance only">
        <Callout tone="warning">
          Sample warning callout: the lime tone is for personal relevance.
        </Callout>
      </GallerySample>
      {riskBlocks.length > 0 ? (
        <GallerySample caption="Risk-label explanation — real: Risk Levels Explained’s label rows, the five levels and the two states, drawn by the production Risk Label">
          <View style={styles.formSample}>
            {riskBlocks.map((block, index) => (
              <DocumentBlockView key={index} block={block} />
            ))}
          </View>
        </GallerySample>
      ) : null}
      <GallerySample caption="Dense comparison — real: the same label rows are the registry’s only comparison; there is no table block, and nothing on a document scrolls sideways">
        {riskBlocks[0] ? <DocumentBlockView block={riskBlocks[0]} /> : null}
      </GallerySample>
      <GallerySample caption="Reset section, idle — simulated: the panel before a tap; the press is wired to nothing">
        <ResetPanel state="idle" onPress={noop} />
      </GallerySample>
      <GallerySample caption="Reset section, confirming — simulated: the platform dialog’s own words, as text; the dialog opens only from the real screen">
        <Surface radius={12} border="border/strong" style={styles.feedCase}>
          <Text variant="heading-3" accessibilityRole="header">
            {RESET_CONFIRM_TITLE}
          </Text>
          <Text variant="body-small">{RESET_CONFIRM_BODY}</Text>
          <Text variant="body-small-bold" color="action/secondary">
            {`${RESET_CONFIRM_CANCEL} · ${RESET_CONFIRM_DELETE}`}
          </Text>
        </Surface>
      </GallerySample>
      <GallerySample caption="Reset section, busy — simulated: a run in flight; the button is inert and reads Deleting…">
        <ResetPanel state="running" onPress={noop} />
      </GallerySample>
      <GallerySample caption="Reset section, success — simulated: the run finished and the data was deleted">
        <ResetPanel state="deleted" onPress={noop} />
      </GallerySample>
      <GallerySample caption="Reset section, failure — simulated: the server deletion failed, so nothing on the device changed">
        <ResetPanel state="failed" onPress={noop} />
      </GallerySample>
      <GallerySample caption="Root error boundary — real: this throws for real and the production failure screen catches it; Try again is Expo Router’s own retry">
        <ErrorBoundaryProbe />
      </GallerySample>
      <Text variant="caption" color="text/secondary">
        Accessibility-large text is a device setting the gallery cannot simulate: set the
        simulator’s text size and inspect the samples and the real documents.
      </Text>
    </Surface>
  );
}

function documentLength(doc: TrustDocument): number {
  return doc.sections.reduce((total, section) => total + section.blocks.length, 0);
}

/** One question step holding its own answers, so a row can be chosen and inspected. */
function LiveQuestion({
  section,
  stepKey,
  initial = EMPTY_ANSWERS,
}: {
  section: QuestionnaireChoices;
  stepKey: QuestionKey;
  initial?: QuestionnaireAnswers;
}) {
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(initial);
  const steps = questionnaireSteps(section);
  const outcome = questionnaireOutcome(answers, section);
  return (
    <QuestionStep
      section={section}
      stepKey={stepKey}
      stepIndex={Math.max(0, steps.indexOf(stepKey))}
      stepCount={steps.length}
      answers={answers}
      canAdvance={outcome.kind !== 'incomplete' || outcome.next !== stepKey}
      onAnswer={(patch) => setAnswers((prior) => ({ ...prior, ...patch }))}
      onBack={steps.indexOf(stepKey) > 0 ? () => {} : null}
      onNext={() => {}}
    />
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <ThemedText type="small" themeColor="link">
        {label}
      </ThemedText>
    </Pressable>
  );
}

function isFullyFeatured(sections: ConfirmedSections | undefined): boolean {
  return (
    sections !== undefined && sections.healthRisk && sections.affectedProducts && sections.community
  );
}

/** The case's own real attributes — every one of them read, never invented. */
function candidateFacts(
  screened: ScreenedCandidate,
  sections: ConfirmedSections | undefined,
): string {
  const geography =
    screened.candidate.geography.scope === 'nationwide'
      ? 'Nationwide'
      : screened.candidate.geography.scope === 'states'
        ? `${screened.candidate.geography.states.length} state(s)`
        : 'Unknown geography';
  const parts = [
    geography,
    `${screened.retailerChoices.length} retailer(s)`,
    `${screened.candidate.productLineCount} product line(s)`,
  ];
  if (sections !== undefined) {
    parts.push(`Health Risk: ${sections.healthRisk ? 'yes' : 'no'}`);
    parts.push(`Affected Products: ${sections.affectedProducts ? 'yes' : 'no'}`);
    // The disclosure shape, read from the real Detail model.
    parts.push(`${sections.facts.jurisdictionCount} jurisdiction(s)`);
    parts.push(`${sections.facts.productRowCount} product row(s)`);
    parts.push(`longest unpaired cell ${sections.facts.maxCellValues} value(s)`);
    parts.push(`longest pair group ${sections.facts.maxPairLines} line(s)`);
    parts.push(sections.facts.hasHeroImage ? 'hero image' : 'no hero image');
    parts.push(`name ${sections.facts.productNameLength} chars`);
    parts.push(`guide ${sections.facts.healthGuideKey ?? 'none'}`);
  }
  parts.push(`tier ${screened.candidate.riskTier}`);
  parts.push(`fit ${candidateScore(screened)}`);
  return parts.join(' · ');
}

function summaryText(session: DesignPreviewSession): string {
  if (session.simulated === null) return 'not simulated';
  const { summary } = session.simulated;
  if (summary.status === 'reported') return `public count ${summary.count}`;
  if (summary.status === 'below_threshold') return 'public count withheld (below threshold)';
  return 'unavailable';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  content: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  banner: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    gap: Spacing.one,
  },
  sessionBox: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    gap: Spacing.half,
  },
  sessionActions: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  sectionLabel: {
    marginTop: Spacing.three,
  },
  groupLabel: {
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    gap: Spacing.half,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginVertical: Spacing.one,
  },
  swatch: {
    padding: Spacing.three,
  },
  option: {
    padding: Spacing.two,
    borderRadius: Radii.small,
    marginTop: Spacing.one,
    gap: Spacing.half,
  },
  // The Feed galleries sit on the page colour with the Feed's own rhythm.
  imagerySample: {
    gap: spacing[8],
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[16],
  },
  iconCell: {
    alignItems: 'center',
    gap: spacing[4],
    width: 72,
  },
  feedGallery: {
    padding: spacing[16],
    gap: spacing[16],
  },
  feedCase: {
    gap: spacing[8],
    padding: spacing[12],
  },
  // P2B7G: the Detail header's identity-beside-media geometry, reproduced
  // for the title-treatment comparison ([id].tsx identityRow/identity).
  // ── Illness status treatments (P2B7J) ──
  // Detail's own identity-beside-hero geometry, reproduced so the width the
  // treatment gets in the proposed location is the real one.
  illnessIdentityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  illnessIdentity: {
    flex: 1,
    minWidth: 0,
    gap: spacing[8],
  },
  illnessTitleBlock: {
    gap: spacing[4],
  },
  illnessMediaColumn: {
    gap: spacing[4],
    alignItems: 'center',
  },
  illnessLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  illnessStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[8],
  },
  titleIdentityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  titleIdentity: {
    flex: 1,
    minWidth: 0,
    gap: spacing[8],
  },
  titleSampleBlock: {
    gap: spacing[4],
  },
  // P2B7D: the recall card's own geometry, reproduced for the treatment
  // comparison so the three options are judged at the size they would ship
  // at. The footer row is omitted — no treatment reaches it.
  treatmentCard: {
    padding: spacing[12],
    gap: spacing[8],
  },
  treatmentStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[8],
  },
  treatmentContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  treatmentIdentity: {
    flex: 1,
    minWidth: 0,
    gap: spacing[8],
  },
  // Treatment C only: the strongest neutral fill the system offers, which is
  // the media placeholder's own grey. Rejected, and drawn nowhere else.
  filledCategoryTag: {
    alignSelf: 'flex-start',
    backgroundColor: color['background/media-placeholder'],
    borderRadius: radius[4],
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
  },
  // The Personalization sections at the screen's own rhythm.
  formSample: {
    gap: spacing[24],
  },
});
