import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotoGallery, PhotoThumbnail } from '@/components/photo-gallery';
import { RiskBadge } from '@/components/risk-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import type { UserRecallPreferences } from '@/domain/preferences';
import type { LotCodeSet } from '@/lib/consumer-projection';
import { loadPreferences, preferencesAvailable } from '@/lib/preferences-store';
import { fetchCaseDetail, type CaseDetail } from '@/lib/recall-feed';
import {
  buildDetailModel,
  todayIso,
  type AffectedProductItem,
  type DetailModel,
  type WhereSoldModel,
} from '@/lib/recall-presentation';
import { evaluatePersonalRelevance } from '@/lib/relevance';

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
 * Where a recall reached (P2a founder decision): ONLY the full state
 * representation renders at this stage — full state names, "Nationwide", or
 * the honest unspecified line, with no trailing period. Named retailers,
 * store addresses, online routes, and channel evidence stay preserved in the
 * model for the later collapsed retailer-list milestone; no channel nouns and
 * no dead retailer control render here.
 */
function WhereItWasSold({ model }: { model: WhereSoldModel }) {
  return model.lead ? <ThemedText>{model.lead}</ThemedText> : null;
}

/**
 * One affected product/package/version in the horizontal rail: only populated
 * approved fields, always in the stable P1 order (Product, size, identifying
 * date under its source-specific label, barcode, lot/batch codes). Empty
 * fields simply do not render — the card never shows placeholder columns.
 */
function AffectedProductCard({
  item,
  codesExpanded,
  onToggleCodes,
}: {
  item: AffectedProductItem;
  codesExpanded: boolean;
  onToggleCodes: () => void;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.productCard}>
      {/* Null when the model demoted a measurement-only version name into the
          Size field — the card renders its fields with no Product line. */}
      {item.name ? <ThemedText style={styles.productName}>{item.name}</ThemedText> : null}
      {item.photo ? <PhotoGallery photos={[item.photo]} size={110} /> : null}
      {item.fields.map((field) => (
        <ThemedText key={field.key} type="small">
          {field.label}: {field.value}
        </ThemedText>
      ))}
      <CodeSet codes={item.codes} expanded={codesExpanded} onToggle={onToggleCodes} />
      {/* Only reached when this version's codes sit somewhere the others' do
          not; a shared location is shown once below the rail. */}
      {item.codeLocation ? (
        <ThemedText type="small" themeColor="textSecondary">
          {item.codeLocation.text}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

export default function RecallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Nested disclosure: large code sets stay collapsed inside their cards,
  // keyed by the item they belong to so each opens independently.
  const [openCodeSets, setOpenCodeSets] = useState<Set<string>>(new Set());
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

  useFocusEffect(
    useCallback(() => {
      // Read-only preference load for the affects-you banner; never prompts
      // for anything. On focus (not just mount) so a detail screen beneath
      // the stack cannot keep stale personalization after a Settings edit or
      // a C7.1 data reset.
      if (preferencesAvailable()) void loadPreferences().then(setPrefs);
    }, []),
  );

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

  const { projection } = state.detail;
  // The one deterministic mapping shared with Home (lib/recall-presentation):
  // the screen renders the model and derives no recall wording of its own.
  // Same predicate as Affects me membership — matching logic unchanged.
  const affectsYou =
    prefs !== null &&
    evaluatePersonalRelevance(
      {
        geography: projection.geography,
        pathogenOrAllergen: projection.pathogenOrAllergen,
        retailerNames: projection.retailerNames ?? [],
        hazardCategory: projection.hazardCategory,
        reasonText: projection.reasonText,
      },
      prefs,
    ).affectsMe;
  const model: DetailModel = buildDetailModel(state.detail, { today: todayIso(), affectsYou });
  const products = model.affectedProducts;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}>
        {/* Header (P2a founder decision): the risk badge upper-left with the
            ONE material activity date beside it, then product name, consumer
            brand, and the single official-source link. The "Recall · Active"
            metadata line and every explanatory risk note are gone — the badge
            states the risk by itself. A Public Health Alert keeps its
            explicit notice label (standing rule). */}
        <View style={styles.badgeRow}>
          {model.risk.headlineLabel ? (
            <RiskBadge
              tier={model.risk.tier}
              label={model.risk.headlineLabel}
              accessibilityLabel={model.risk.accessibilityLabel}
              size="large"
            />
          ) : null}
          {model.noticeTypeLabel === 'Public Health Alert' ? (
            <ThemedText type="small" themeColor="textSecondary">
              {model.noticeTypeLabel}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {model.activity.text}
          </ThemedText>
        </View>

        {model.retracted ? (
          <ThemedView type="backgroundSelected" style={styles.callout}>
            <ThemedText>{model.agencyLabel} has retracted this notice.</ThemedText>
          </ThemedView>
        ) : null}

        <ThemedText type="title">{model.productName}</ThemedText>
        <ThemedText themeColor="textSecondary">{model.brand.text}</ThemedText>
        <ThemedText
          themeColor="link"
          accessibilityRole="link"
          onPress={() => Linking.openURL(model.officialSource.url)}>
          {model.officialSource.label}
        </ThemedText>

        {/* The primary hero renders ONCE, near the title; no image repeats
            lower on the page (P2c owns full image-role allocation). */}
        {model.heroImageUrl ? (
          <PhotoThumbnail uri={model.heroImageUrl} alt={model.productName} size={160} />
        ) : null}

        {model.affectsYou ? (
          <ThemedView type="backgroundSelected" style={styles.callout}>
            <ThemedText>{model.affectsYouBanner}</ThemedText>
          </ThemedView>
        ) : null}

        <Section title="What happened">
          <ThemedText>{model.whatHappened.text}</ThemedText>
          {model.whatHappened.update ? (
            <ThemedText type="small" themeColor="textSecondary">
              {model.whatHappened.update}
            </ThemedText>
          ) : null}
          {model.illnessLine ? <ThemedText>{model.illnessLine}</ThemedText> : null}
          {model.quantityLine ? (
            <ThemedText type="small" themeColor="textSecondary">
              {model.quantityLine}
            </ThemedText>
          ) : null}
        </Section>

        {/* Where it was sold: only the full state representation (P2a founder
            decision). Retailers, addresses, online routes, and channel
            evidence stay in the model for the later retailer-list milestone. */}
        <Section title="Where it was sold">
          <WhereItWasSold model={model.whereSold} />
        </Section>

        {/* Affected Products: the gated P0A data only — no helper, coverage,
            or disclaimer prose (P2a founder decision). The coverage state
            stays internal to the model for correctness and QA. P2b replaces
            these cards with the compact versions table. */}
        <Section title="Affected Products">
          {products.appliesToAll.length > 0 ? (
            <ThemedView type="backgroundElement" style={styles.productRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Applies to all affected versions
              </ThemedText>
              {products.appliesToAll.map((field) => (
                <ThemedText key={field.key} type="small">
                  {field.label}: {field.value}
                </ThemedText>
              ))}
            </ThemedView>
          ) : null}
          {products.items.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.productRail}>
              {products.items.map((item, index) => (
                <AffectedProductCard
                  key={index}
                  item={item}
                  codesExpanded={openCodeSets.has(`v${index}`)}
                  onToggleCodes={() => toggleCodeSet(`v${index}`)}
                />
              ))}
            </ScrollView>
          ) : null}
          {/* Production codes are opaque, so the calendar dates they stand
              for lead and the codes follow behind a tap. */}
          {products.productionDates ? (
            <ThemedText type="small">
              Affected production dates: {products.productionDates}
            </ThemedText>
          ) : null}
          <CodeSet
            codes={products.productionCodes}
            expanded={openCodeSets.has('production')}
            onToggle={() => toggleCodeSet('production')}
          />
          <CodeSet
            codes={products.caseCodes}
            expanded={openCodeSets.has('lot')}
            onToggle={() => toggleCodeSet('lot')}
          />
          {model.attachments.map((attachment) => (
            <ThemedText
              key={attachment.url}
              themeColor="link"
              accessibilityRole="link"
              onPress={() => Linking.openURL(attachment.url)}>
              {attachment.label}
            </ThemedText>
          ))}
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
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
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
  // The horizontal Affected Products rail: fixed-width cards so several peek
  // into view and the rail invites a scroll. Final dimensions/polish deferred.
  productRail: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  productCard: {
    width: 240,
    padding: Spacing.two,
    borderRadius: Radii.small,
    gap: Spacing.half,
  },
  productName: {
    fontWeight: '600',
  },
});
