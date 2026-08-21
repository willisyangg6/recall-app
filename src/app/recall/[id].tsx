import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import {
  companyDisplayName,
  parseProductLine,
  productSummaryFromTitle,
} from '@/lib/consumer-summary';
import { fetchCaseDetail, type CaseDetail } from '@/lib/recall-feed';
import {
  formatDate,
  geographyDetail,
  noticeTypeLabel,
  reasonLine,
  riskPresentation,
  stateLabel,
} from '@/lib/recall-display';
import type { AffectedProduct } from '@/domain/recall-types';

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
 * One affected-product row: label name emphasized, package and identifying
 * details (dates, lot codes, establishment numbers) preserved beneath it.
 * Lines the deterministic parser can't split are shown verbatim — never
 * dropped or truncated.
 */
function ProductRow({ product }: { product: AffectedProduct }) {
  const parsed = parseProductLine(product.rawText);
  if (!parsed) {
    return (
      <ThemedView type="backgroundElement" style={styles.productRow}>
        <ThemedText type="small">{product.rawText.trim()}</ThemedText>
      </ThemedView>
    );
  }
  return (
    <ThemedView type="backgroundElement" style={styles.productRow}>
      <ThemedText style={styles.productName}>{parsed.name}</ThemedText>
      {parsed.packageText ? (
        <ThemedText type="small" themeColor="textSecondary">
          {parsed.packageText}
        </ThemedText>
      ) : null}
      {parsed.detailText ? (
        <ThemedText type="small" themeColor="textSecondary">
          {parsed.detailText}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

export default function RecallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
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
  const risk = riskPresentation(projection.classification.value);
  const product = productSummaryFromTitle(projection.title) ?? projection.title;
  const company = companyDisplayName(projection.recallingFirm.displayName);
  const reason = reasonLine(
    projection.reasonText,
    projection.hazardCategory,
    projection.pathogenOrAllergen,
  );
  // Show the identified concern separately only when the reason line doesn't
  // already name it — no repeated information.
  const concernShownInReason =
    projection.pathogenOrAllergen !== null &&
    (reason ?? '')
      .toLowerCase()
      .includes(projection.pathogenOrAllergen.toLowerCase().replace(/^undeclared\s+/, ''));
  const agencyLabel = projection.sourceAgency === 'FSIS' ? 'USDA FSIS' : 'FDA';

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
        {company ? <ThemedText themeColor="textSecondary">{company}</ThemedText> : null}
        <ThemedText type="small" themeColor="textSecondary">
          Announced {formatDate(projection.publishedAt)}
          {projection.lastPublicActivityAt > projection.publishedAt
            ? ` · Updated ${formatDate(projection.lastPublicActivityAt)}`
            : ''}
        </ThemedText>

        {projection.state === 'retracted' ? (
          <ThemedView type="backgroundSelected" style={styles.callout}>
            <ThemedText>
              {agencyLabel} has retracted this notice. See the official page for details.
            </ThemedText>
          </ThemedView>
        ) : null}

        <Section title="Why">
          <ThemedText>{reason ?? 'Reason not stated — see the official notice.'}</ThemedText>
          {projection.pathogenOrAllergen && !concernShownInReason ? (
            <ThemedText themeColor="textSecondary">
              Identified concern: {projection.pathogenOrAllergen}
            </ThemedText>
          ) : null}
        </Section>

        {risk ? (
          <Section title="Risk level">
            <ThemedText>{risk.label}</ThemedText>
            {risk.explanation ? (
              <ThemedText themeColor="textSecondary">{risk.explanation}</ThemedText>
            ) : null}
          </Section>
        ) : null}

        <Section title="Where sold">
          <ThemedText>{geographyDetail(projection.geography)}</ThemedText>
        </Section>

        <Section title="What to do">
          <ThemedText>
            {projection.consumerAction ??
              'No specific instructions were extracted — check the official notice.'}
          </ThemedText>
        </Section>

        {projection.illnessStatement ? (
          <Section title="Reported illnesses">
            <ThemedText>{projection.illnessStatement}</ThemedText>
          </Section>
        ) : null}

        <Section title="Affected products">
          {affectedProducts.length === 0 ? (
            <ThemedText themeColor="textSecondary">
              The product list is only in the official notice (often as an attachment) — open it
              below.
            </ThemedText>
          ) : (
            affectedProducts.map((item, index) => <ProductRow key={index} product={item} />)
          )}
        </Section>

        {projection.recallingFirm.displayName ? (
          <Section title="Company">
            <ThemedText>{company ?? projection.recallingFirm.displayName}</ThemedText>
            {company && company !== projection.recallingFirm.displayName ? (
              <ThemedText type="small" themeColor="textSecondary">
                Legal name: {projection.recallingFirm.displayName}
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
          {product !== projection.title ? (
            <ThemedText type="small" themeColor="textSecondary">
              Official title: “{projection.title}”
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Source: U.S. Department of Agriculture
          </ThemedText>
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // No alignItems: 'center' here — centering the cross axis made the
  // ScrollView size to its content's intrinsic width, so long text defined a
  // canvas wider than the screen (the observed right-edge clipping) instead of
  // wrapping. Width is constrained by the content container instead.
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
  productRow: {
    padding: Spacing.two,
    borderRadius: Radii.small,
    gap: Spacing.half,
  },
  productName: {
    fontWeight: '600',
  },
});
