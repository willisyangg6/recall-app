import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ComparePhotos, PhotoGallery } from '@/components/photo-gallery';
import { RiskBadge } from '@/components/risk-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { classifyIllnessReport } from '@/domain/illness';
import {
  brandLine,
  companyLine,
  extractAttachmentLinks,
  humanizeAllCaps,
  productDisplayName,
} from '@/lib/consumer-summary';
import {
  buildConsumerCase,
  joinValues,
  type ConsumerDistribution,
  type LotCodeSet,
} from '@/lib/consumer-projection';
import type { PackageField } from '@/lib/consumer-schema';
import type { CodeLocation } from '@/lib/fact-types';
import type { PhotoRole, ProductPhoto } from '@/lib/product-photos';
import {
  allergenLabelForToken,
  stateNameForCode,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { retailerById } from '@/domain/retailer-catalog';
import { buildWhatHappened } from '@/lib/what-happened';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';
import { fetchCaseDetail, type CaseDetail } from '@/lib/recall-feed';
import { evaluatePersonalRelevance } from '@/lib/relevance';
import { agencyLabel as agencyLabelFor, riskView } from '@/lib/risk-display';
import { buildShareMessage } from '@/lib/share-message';
import {
  formatDate,
  healthRiskSummary,
  illnessDisplay,
  noticeTypeLabel,
  reasonLine,
  stateLabel,
} from '@/lib/recall-display';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; detail: CaseDetail };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="small" themeColor="textSecondary">
        {title.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
}

/**
 * A collapsed set of printed codes. Large sets stay behind their own step —
 * useful, never a wall of codes — and when the source paired each code with a
 * calendar date, both are shown: the date is what a person can read, the code
 * is what is actually stamped on their package.
 */
function CodeSet({
  codes,
  expanded,
  onToggle,
}: {
  codes: LotCodeSet | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!codes) return null;
  return (
    <View style={styles.step}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle}>
        <ThemedText themeColor="link" type="small">
          {expanded
            ? `Hide ${codes.label.toLowerCase()}s`
            : `${codes.label}s · ${codes.count} affected — view`}
        </ThemedText>
      </Pressable>
      {expanded ? (
        <ThemedView type="backgroundElement" style={styles.identifierRow}>
          {codes.pairs.length > 0 ? (
            codes.pairs.map((pair) => (
              <ThemedText key={pair.code} type="small">
                {pair.code} · {pair.date}
              </ThemedText>
            ))
          ) : (
            <ThemedText type="small">{codes.codes.join(', ')}</ThemedText>
          )}
        </ThemedView>
      ) : null}
    </View>
  );
}

/**
 * The approved package fields, and nothing else.
 *
 * This component accepts `PackageField[]` rather than arbitrary label/value
 * pairs on purpose: every label it can print comes from a closed table, so no
 * source heading, table column, or parser heuristic can introduce a field here.
 * Missing values simply do not appear — the structure never changes shape.
 */
function PackageFields({ fields }: { fields: PackageField[] }) {
  return (
    <>
      {fields.map((field) => (
        <ThemedText key={field.key} type="small">
          {field.label}: {field.value}
        </ThemedText>
      ))}
    </>
  );
}

/**
 * Where a recall reached, as structured facts rather than one generated
 * paragraph: the places first, then the named sellers, then the platforms, then
 * the broad routes. Each block appears only when the source supported it.
 */
function WhereItWasSold({
  distribution,
  showAll,
  onToggleAll,
  showLocations,
  onToggleLocations,
}: {
  distribution: ConsumerDistribution;
  showAll: boolean;
  onToggleAll: () => void;
  showLocations: boolean;
  onToggleLocations: () => void;
}) {
  const retailers = showAll ? distribution.retailers : distribution.retailersShown;
  const locations = distribution.retailLocations;
  return (
    <>
      {distribution.areaText ? <ThemedText>{distribution.areaText}</ThemedText> : null}
      {distribution.scopeType === 'states' && distribution.states.length > LISTED_STATES ? (
        <ThemedText type="small" themeColor="textSecondary">
          {joinValues(distribution.states)}
        </ThemedText>
      ) : null}

      {/* City/borough places, typed as geography by the projection — a name
          can appear here only through the closed place taxonomy, never
          because it looked like a proper noun. */}
      {distribution.areas.length > 0 ? (
        <View style={styles.step}>
          <ThemedText type="small" themeColor="textSecondary">
            AREAS
          </ThemedText>
          <ThemedText type="small">{joinValues(distribution.areas)}.</ThemedText>
        </View>
      ) : null}

      {distribution.retailers.length > 0 ? (
        <View style={styles.step}>
          <ThemedText type="small" themeColor="textSecondary">
            {distribution.retailersHidden > 0
              ? 'RETAILERS INCLUDE'
              : distribution.retailers.length === 1
                ? 'RETAILER'
                : 'RETAILERS'}
          </ThemedText>
          {retailers.map((retailer) => (
            <ThemedText key={retailer} type="small">
              {retailer}
            </ThemedText>
          ))}
          {distribution.retailersHidden > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showAll }}
              onPress={onToggleAll}>
              <ThemedText themeColor="link" type="small">
                {showAll
                  ? 'Show fewer retailers'
                  : `View all ${distribution.retailers.length} retailers`}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Specific store addresses are the most useful thing a notice can say
          about reach, and the least readable to leave open by default. */}
      {locations.length > 0 ? (
        <View style={styles.step}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showLocations }}
            onPress={onToggleLocations}>
            <ThemedText themeColor="link" type="small">
              {showLocations
                ? 'Hide locations'
                : `${locations.length} location${locations.length === 1 ? '' : 's'} — view`}
            </ThemedText>
          </Pressable>
          {showLocations ? (
            <ThemedView type="backgroundElement" style={styles.identifierRow}>
              {locations.slice(0, LISTED_LOCATIONS).map((location) => (
                <ThemedText key={location} type="small">
                  {location}
                </ThemedText>
              ))}
              {locations.length > LISTED_LOCATIONS ? (
                <ThemedText type="small" themeColor="textSecondary">
                  + {locations.length - LISTED_LOCATIONS} more
                </ThemedText>
              ) : null}
            </ThemedView>
          ) : null}
        </View>
      ) : null}

      {distribution.onlinePlatforms.length > 0 ? (
        <View style={styles.step}>
          <ThemedText type="small" themeColor="textSecondary">
            ONLINE
          </ThemedText>
          <ThemedText type="small">{joinValues(distribution.onlinePlatforms)}</ThemedText>
        </View>
      ) : null}

      {distribution.channels.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Also sold through {joinValues(distribution.channels)}.
        </ThemedText>
      ) : null}
    </>
  );
}

/** Above this many states, the lead line states a count and the list follows. */
const LISTED_STATES = 12;
/** A disclosure of two hundred addresses is not a disclosure. */
const LISTED_LOCATIONS = 25;

/**
 * Where to look on the package, and what the code looks like — two different
 * questions, so they get two lines rather than one run-on phrase.
 */
function FindTheCode({ location, plural }: { location: CodeLocation | null; plural: boolean }) {
  if (!location) return null;
  return (
    <View style={styles.step}>
      <ThemedText type="small" themeColor="textSecondary">
        {plural ? 'FIND THE CODES' : 'FIND THE CODE'}
      </ThemedText>
      <ThemedText type="small">{location.text}</ThemedText>
      {location.appearance ? (
        <ThemedText type="small" themeColor="textSecondary">
          Look for: {location.appearance}
        </ThemedText>
      ) : null}
    </View>
  );
}

export default function RecallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Progressive disclosure: package-specific identifiers appear only after
  // the user asks "do I have this product?" — never as always-visible clutter.
  const [showChecker, setShowChecker] = useState(false);
  // Nested disclosure: large code sets stay collapsed even inside the checker,
  // keyed by the version they belong to so each opens independently.
  const [openCodeSets, setOpenCodeSets] = useState<Set<string>>(new Set());
  const [showAllRetailers, setShowAllRetailers] = useState(false);
  const [showLocations, setShowLocations] = useState(false);
  const [prefs, setPrefs] = useState<UserRecallPreferences | null>(null);
  const toggleCodeSet = (key: string) =>
    setOpenCodeSets((prior) => {
      const next = new Set(prior);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await fetchCaseDetail(id);
        if (cancelled) return;
        setState(detail ? { status: 'ready', detail } : { status: 'missing' });
      } catch (error) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load this recall.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    // Read-only preference load for the "Why this may affect you" section;
    // never prompts for anything.
    if (preferencesAvailable()) void loadPreferences().then(setPrefs);
  }, []);

  if (state.status !== 'ready') {
    return (
      <ThemedView style={styles.messageContainer}>
        <ThemedText themeColor="textSecondary" style={styles.centeredText}>
          {state.status === 'loading'
            ? 'Loading…'
            : state.status === 'missing'
              ? 'This recall could not be found.'
              : state.message}
        </ThemedText>
      </ThemedView>
    );
  }

  const { projection, affectedProducts } = state.detail;
  // Two layers: the consumer tier leads the screen, the agency's own
  // classification is preserved verbatim further down.
  const risk = riskView(projection.classification, projection.sourceAgency);
  // `?? null`: projections persisted before productDescription/brands existed
  // omit the keys; absence means unknown.
  const product = productDisplayName(projection.productDescription ?? null, projection.title);
  const company = companyLine(projection.recallingFirm.displayName, projection.title);
  const brands = brandLine(projection.brands ?? [], projection.recallingFirm.displayName, product);
  const reason = reasonLine(
    projection.reasonText,
    projection.hazardCategory,
    projection.pathogenOrAllergen,
  );
  // Structured, source-grounded summary — never raw press-release prose. The
  // authoritative legal firm name and full source text stay in the projection.
  const happened = buildWhatHappened({
    title: projection.title,
    noticeType: projection.noticeType,
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmDisplayName: projection.recallingFirm.displayName,
    summaryText: projection.summaryText,
    productDescription: projection.productDescription ?? null,
  });
  const illness = illnessDisplay(classifyIllnessReport(projection.summaryText));
  // Deterministic hazard-family template — never source prose fragments.
  const healthRisk = healthRiskSummary(
    projection.hazardCategory,
    projection.pathogenOrAllergen,
    projection.reasonText,
  );
  const attachments = extractAttachmentLinks(projection.summaryHtml);
  const agencyLabel = agencyLabelFor(projection.sourceAgency);
  // Consumer Projection V2: photos, distribution, package identification, and
  // the consumer action, all derived from data already persisted with the case
  // (no re-ingestion) and routed into our own semantic concepts rather than
  // whatever the source happened to call its columns.
  const consumer = buildConsumerCase(projection, affectedProducts);
  // Official label pages the backend rendered from source PDFs (FSIS) join
  // the same Product Photos experience as FDA photography — no PDF-specific
  // component, and the original PDF stays linked as provenance.
  const labelVisuals: ProductPhoto[] = state.detail.visuals.map((visual, index) => ({
    url: visual.url,
    alt: 'Official product label',
    order: consumer.photos.length + index,
    role: visual.role as PhotoRole,
    width: visual.width,
    height: visual.height,
    aspectRatio:
      visual.width !== null && visual.height !== null && visual.height > 0
        ? visual.width / visual.height
        : null,
  }));
  const gallery = [...consumer.photos, ...labelVisuals];

  // Personal relevance lines, grounded only in preferences + case facts.
  // Preference wording, not medical advice ("your selected allergen", never
  // "dangerous for you"); a retailer line only when the notice itself names
  // the store; and geographic exclusion renders nothing at all.
  const personalLines: string[] = [];
  if (prefs !== null) {
    const relevance = evaluatePersonalRelevance(
      {
        geography: projection.geography,
        pathogenOrAllergen: projection.pathogenOrAllergen,
        retailerNames: projection.retailerNames ?? [],
        hazardCategory: projection.hazardCategory,
        reasonText: projection.reasonText,
      },
      prefs,
    );
    if (relevance.reasons.length > 0) {
      for (const token of relevance.matchedAllergens) {
        personalLines.push(`Contains your selected allergen: ${allergenLabelForToken(token)}`);
      }
      for (const retailerId of relevance.matchedRetailers) {
        const retailer = retailerById(retailerId);
        if (retailer) personalLines.push(`Sold at ${retailer.name}`);
      }
      if (projection.geography.scope === 'nationwide') {
        personalLines.push('Distributed nationwide');
      } else if (relevance.geographic === 'matches' && prefs.state !== null) {
        personalLines.push(`Sold in ${stateNameForCode(prefs.state)}`);
      } else if (relevance.geographic === 'unknown' && personalLines.length > 0) {
        personalLines.push(
          'Distribution details are limited — the notice doesn’t say where it was sold',
        );
      }
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {noticeTypeLabel(projection.noticeType)} · {stateLabel(projection.state)}
          {projection.state === 'closed' && projection.closedYear
            ? ` (${projection.closedYear})`
            : ''}
        </ThemedText>
        <ThemedText type="title">{product}</ThemedText>
        <ThemedText themeColor="textSecondary">{company}</ThemedText>
        {brands ? (
          <ThemedText type="small" themeColor="textSecondary">
            Brand: {brands}
          </ThemedText>
        ) : null}
        {/* Retailers belong to "Where it was sold" and appear there only.
            Repeating them here made the header's shape vary from recall to
            recall and said the same thing twice. */}
        <ThemedText type="small" themeColor="textSecondary">
          Announced {formatDate(projection.publishedAt)}
          {projection.lastPublicActivityAt > projection.publishedAt
            ? ` · Updated ${formatDate(projection.lastPublicActivityAt)}`
            : ''}
        </ThemedText>

        {/* Consumer risk tier — the primary risk language, prominent and
            near the top. Text always carries the meaning; the color is a
            second channel only. */}
        {risk.headlineLabel ? (
          <View style={styles.riskBlock}>
            <RiskBadge
              tier={risk.tier}
              label={risk.headlineLabel}
              accessibilityLabel={risk.accessibilityLabel}
              size="large"
            />
            {risk.note ? (
              <ThemedText type="small" themeColor="textSecondary">
                {risk.note}
              </ThemedText>
            ) : null}
          </View>
        ) : null}

        {projection.state === 'retracted' ? (
          <ThemedView type="backgroundSelected" style={styles.callout}>
            <ThemedText>{agencyLabel} has retracted this notice.</ThemedText>
          </ThemedView>
        ) : null}

        {/* Personal relevance: only rendered when there is something true and
            personal to say. Never an empty box, and never a "doesn't affect
            you" — absence of a match is not proof of safety. */}
        {personalLines.length > 0 ? (
          <Section title="Why this may affect you">
            {personalLines.map((line) => (
              <ThemedText key={line}>· {line}</ThemedText>
            ))}
          </Section>
        ) : null}

        {/* Official product photography is primary recognition information,
            so it sits above the explanation rather than behind a control. */}
        {gallery.length > 0 ? (
          <Section title={gallery.length > 1 ? 'Product photos' : 'Product photo'}>
            <PhotoGallery photos={gallery} />
          </Section>
        ) : null}

        <Section title="What happened">
          {reason ? <ThemedText style={styles.reasonLead}>{reason}</ThemedText> : null}
          <ThemedText>{happened.text}</ThemedText>
          {happened.update ? (
            <ThemedText type="small" themeColor="textSecondary">
              {happened.update}
            </ThemedText>
          ) : null}
          {/* How much was recalled has exactly one consumer home, and
              this is it. FSIS quantityText is the amount RECOVERED — a
              different fact — and is deliberately not shown. */}
          {projection.sourceAgency === 'FDA' &&
          consumer.quantityText &&
          !happened.text.includes(consumer.quantityText.match(/[\d,]+/)?.[0] ?? '\u0000') ? (
            <ThemedText type="small" themeColor="textSecondary">
              The recall covers {consumer.quantityText}.
            </ThemedText>
          ) : null}
        </Section>

        <Section title="Where it was sold">
          <WhereItWasSold
            distribution={consumer.distribution}
            showAll={showAllRetailers}
            onToggleAll={() => setShowAllRetailers((value) => !value)}
            showLocations={showLocations}
            onToggleLocations={() => setShowLocations((value) => !value)}
          />
        </Section>

        {/* Hidden entirely when nothing a person can actually check survived
            the schema. A clean omission beats a residual blob of source text. */}
        {consumer.packageCheck.render ? (
          <Section title="Check your package">
            {/* The task the section exists for, stated plainly, then a
                recognizable summary. Identifiers stay behind the control so the
                page never reads as a wall of codes. */}
            <ThemedText type="small" themeColor="textSecondary">
              {consumer.packageCheck.scopeStatement}
            </ThemedText>
            <ThemedText style={styles.productName}>{humanizeAllCaps(product)}</ThemedText>
            {consumer.variantNames.length > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Affected versions: {joinValues(consumer.variantNames)}
                {consumer.packageCheck.variants.length > consumer.variantNames.length
                  ? ` · ${consumer.packageCheck.variants.length} affected packages`
                  : ''}
              </ThemedText>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showChecker }}
              onPress={() => setShowChecker((value) => !value)}>
              <ThemedText themeColor="link">
                {showChecker ? 'Hide package details' : 'Do you have this product?'}
              </ThemedText>
            </Pressable>

            {showChecker ? (
              <View style={styles.checker}>
                <ComparePhotos photos={consumer.packageCheck.photos} />

                {/* Facts proven to apply to every affected version — every
                    version's own source row states the same value — render
                    once, here, above the cards. In variant mode this block
                    and the cards are the ONLY places a package fact can
                    appear; nothing renders loosely after the cards. */}
                {consumer.packageCheck.sharedFields.length > 0 ? (
                  <ThemedView type="backgroundElement" style={styles.productRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Applies to all affected versions
                    </ThemedText>
                    <PackageFields fields={consumer.packageCheck.sharedFields} />
                  </ThemedView>
                ) : null}

                {/* Every version card has the same shape, drawn from the same
                    closed field vocabulary. A version missing a value simply
                    omits that line; it never gains a different one because
                    another source table had another column. */}
                {consumer.packageCheck.variants.map((variant, index) => (
                  <ThemedView key={index} type="backgroundElement" style={styles.productRow}>
                    <ThemedText style={styles.productName}>{variant.name}</ThemedText>
                    {variant.photo ? <PhotoGallery photos={[variant.photo]} size={110} /> : null}
                    <PackageFields fields={variant.fields} />
                    <CodeSet
                      codes={variant.lotCodes}
                      expanded={openCodeSets.has(`v${index}`)}
                      onToggle={() => toggleCodeSet(`v${index}`)}
                    />
                    {/* Only reached when this version's codes sit somewhere the
                        others' do not; a shared location is shown once below. */}
                    {variant.codeLocation ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {variant.codeLocation.text}
                      </ThemedText>
                    ) : null}
                  </ThemedView>
                ))}
                {consumer.packageCheck.fields.length > 0 ? (
                  <ThemedView type="backgroundElement" style={styles.productRow}>
                    <PackageFields fields={consumer.packageCheck.fields} />
                  </ThemedView>
                ) : null}

                {/* Production codes are opaque, so the calendar dates they
                    stand for lead and the codes follow behind a tap. */}
                {consumer.packageCheck.productionDates ? (
                  <ThemedText type="small">
                    Affected production dates: {consumer.packageCheck.productionDates}
                  </ThemedText>
                ) : null}
                <CodeSet
                  codes={consumer.packageCheck.productionCodes}
                  expanded={openCodeSets.has('production')}
                  onToggle={() => toggleCodeSet('production')}
                />
                <CodeSet
                  codes={consumer.packageCheck.lotCodes}
                  expanded={openCodeSets.has('lot')}
                  onToggle={() => toggleCodeSet('lot')}
                />

                {/* Where the codes are, stated once when it is true of every
                    affected version. Omitted entirely when the notice never
                    says — a wrong place to look is worse than none. */}
                <FindTheCode
                  location={consumer.packageCheck.codeLocation}
                  plural={consumer.packageCheck.variants.length > 1}
                />

                {attachments.map((attachment) => (
                  <ThemedText
                    key={attachment.url}
                    themeColor="link"
                    accessibilityRole="link"
                    onPress={() => Linking.openURL(attachment.url)}>
                    {attachment.label}
                  </ThemedText>
                ))}
              </View>
            ) : null}
          </Section>
        ) : null}

        <Section title="What you should do">
          <ThemedText>{consumer.action.text}</ThemedText>
          {consumer.action.origin === 'app' ? (
            <ThemedText type="small" themeColor="textSecondary">
              This is our recommendation — the notice did not state a consumer instruction.
            </ThemedText>
          ) : null}
          {consumer.action.secondary ? (
            <ThemedText type="small" themeColor="textSecondary">
              {consumer.action.secondary}
            </ThemedText>
          ) : null}
        </Section>

        <Section title="Illness reports">
          <ThemedText>{illness.headline}</ThemedText>
          {illness.detail ? (
            <ThemedText themeColor="textSecondary">{illness.detail}</ThemedText>
          ) : null}
        </Section>

        {healthRisk ? (
          <Section title="Health risk">
            <ThemedText themeColor="textSecondary">{healthRisk}</ThemedText>
          </Section>
        ) : null}

        {/* Regulatory language, kept deeper in the page and never collapsed
            into one class when the agency assigned several. */}
        {risk.official ? (
          <Section title={risk.official.heading}>
            <ThemedText>{risk.official.text}</ThemedText>
            {risk.official.note ? (
              <ThemedText type="small" themeColor="textSecondary">
                {risk.official.note}
              </ThemedText>
            ) : null}
          </Section>
        ) : null}

        <Section title="Official source">
          <ThemedText
            themeColor="link"
            accessibilityRole="link"
            onPress={() => Linking.openURL(projection.officialUrl)}>
            View the official {agencyLabel} notice
          </ThemedText>
          {/* Native share (C6): canonical facts + the official URL only —
              built by lib/share-message (tested contract), never including
              the reader's personalization or any claim they are affected.
              Cancellation and platforms without a share sheet (some web
              browsers) reject the promise; both are silently absorbed so the
              detail page can never crash from sharing. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const share = buildShareMessage({
                productName: product,
                firmDisplayName: projection.recallingFirm.displayName,
                brands: projection.brands ?? [],
                whatHappened: happened.text,
                consumerAction: consumer.action.origin === 'source' ? consumer.action.text : null,
                agencyLabel,
                officialUrl: projection.officialUrl,
              });
              Share.share(
                { title: share.title, message: share.message },
                { subject: share.title },
              ).catch(() => {
                // Dismissed, or no share sheet on this platform — never an error.
              });
            }}>
            <ThemedView type="backgroundElement" style={styles.shareButton}>
              <ThemedText>Share this recall</ThemedText>
            </ThemedView>
          </Pressable>
          {product !== projection.title ? (
            <ThemedText type="small" themeColor="textSecondary">
              Official title: “{projection.title}”
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Source:{' '}
            {projection.sourceAgency === 'FSIS'
              ? 'U.S. Department of Agriculture'
              : 'U.S. Food and Drug Administration'}
          </ThemedText>
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // No alignItems: 'center' here — centering the cross axis made the
  // ScrollView size to its content's intrinsic width, so long text defined a
  // canvas wider than the screen instead of wrapping. Width is constrained by
  // the content container.
  container: {
    flex: 1,
  },
  // flex: 1 so the ScrollView takes the screen height and can actually scroll.
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
  messageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  centeredText: {
    textAlign: 'center',
  },
  section: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  callout: {
    padding: Spacing.three,
    borderRadius: Radii.medium,
    marginTop: Spacing.two,
  },
  riskBlock: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  reasonLead: {
    fontWeight: '600',
  },
  checker: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  step: {
    gap: Spacing.half,
    marginTop: Spacing.one,
  },
  identifierRow: {
    padding: Spacing.two,
    borderRadius: Radii.small,
  },
  productRow: {
    padding: Spacing.two,
    borderRadius: Radii.small,
    gap: Spacing.half,
  },
  productName: {
    fontWeight: '600',
  },
  shareButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radii.medium,
  },
});
