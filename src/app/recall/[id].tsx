import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { classifyIllnessReport, healthEducationText } from '@/domain/illness';
import type { AffectedProduct } from '@/domain/recall-types';
import {
  companyLine,
  extractAttachmentLinks,
  humanizeAllCaps,
  parseProductLine,
  productSummaryFromTitle,
} from '@/lib/consumer-summary';
import { buildWhatHappened } from '@/lib/what-happened';
import { fetchCaseDetail, type CaseDetail } from '@/lib/recall-feed';
import {
  consumerActionDisplay,
  formatDate,
  geographyDetail,
  illnessDisplay,
  noticeTypeLabel,
  reasonLine,
  riskPresentation,
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
 * One affected product as a "check your package" block: label name
 * emphasized, package described, identifiers (use-by dates, lots,
 * establishment numbers) as labeled rows, placement noted. Lines the
 * deterministic parser can't split are shown verbatim — never dropped — and
 * unconsumed source prose is preserved as a residual line.
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
      <ThemedText style={styles.productName}>{humanizeAllCaps(parsed.name)}</ThemedText>
      {parsed.packageText ? (
        <ThemedText type="small" themeColor="textSecondary">
          Package: {parsed.packageText}
        </ThemedText>
      ) : null}
      {parsed.identifiers.map((identifier, index) => (
        <ThemedText key={index} type="small">
          {identifier.label}: {identifier.value}
        </ThemedText>
      ))}
      {parsed.locationText ? (
        <ThemedText type="small" themeColor="textSecondary">
          Where: {parsed.locationText}
        </ThemedText>
      ) : null}
      {parsed.residualText ? (
        <ThemedText type="small" themeColor="textSecondary">
          {parsed.residualText}
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
  const company = companyLine(projection.recallingFirm.displayName, projection.title);
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
  });
  const illness = illnessDisplay(classifyIllnessReport(projection.summaryText));
  const education = healthEducationText(projection.summaryText);
  const action = consumerActionDisplay(projection.consumerAction);
  const attachments = extractAttachmentLinks(projection.summaryHtml);
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
        <ThemedText themeColor="textSecondary">{company}</ThemedText>
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

        <Section title="What happened">
          {reason ? <ThemedText style={styles.reasonLead}>{reason}</ThemedText> : null}
          <ThemedText>{happened.text}</ThemedText>
          {happened.update ? (
            <ThemedText type="small" themeColor="textSecondary">
              {happened.update}
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

        <Section title="Where it was sold">
          <ThemedText>{geographyDetail(projection.geography)}</ThemedText>
        </Section>

        <Section title="Check your package">
          {affectedProducts.length === 0 ? (
            <ThemedText themeColor="textSecondary">
              {attachments.length > 0
                ? 'The affected-product list is in the official attachment below.'
                : 'The product list is only in the official notice — open it below.'}
            </ThemedText>
          ) : (
            affectedProducts.map((item, index) => <ProductRow key={index} product={item} />)
          )}
          {attachments.map((attachment) => (
            <ThemedText
              key={attachment.url}
              themeColor="link"
              accessibilityRole="link"
              onPress={() => Linking.openURL(attachment.url)}>
              {attachment.label}
            </ThemedText>
          ))}
        </Section>

        <Section title="What you should do">
          <ThemedText>
            {action?.primary ??
              'No specific instructions were extracted — check the official notice.'}
          </ThemedText>
          {action?.secondary ? (
            <ThemedText type="small" themeColor="textSecondary">
              {action.secondary}
            </ThemedText>
          ) : null}
        </Section>

        <Section title="Illness reports">
          <ThemedText>{illness.headline}</ThemedText>
          {illness.detail ? (
            <ThemedText themeColor="textSecondary">{illness.detail}</ThemedText>
          ) : null}
        </Section>

        {education ? (
          <Section title="Health risk">
            <ThemedText themeColor="textSecondary">{education}</ThemedText>
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
  reasonLead: {
    fontWeight: '600',
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
