/**
 * The community shopper-report block (P1D) that renders beneath the official
 * "Where it was sold" statement on Recall Detail.
 *
 * Deliberately isolated: this file is layout, the runtime fetch, and nothing
 * else. Every word comes from lib/shopper-report-presentation (a tested
 * contract), the case's eligibility and the choices a report may name come
 * from the shared presentation model, and the network/queue behavior lives in
 * lib/shopper-report-store. That keeps the provisional styling here easy to
 * replace wholesale in the design-system pass without touching any contract.
 *
 * ## Two gates, and the silent default
 *
 * The block renders only when the shared model gave the case a section AND
 * `communityReportsView` finds something to show. While the production
 * feature gate is off, every summary is `unavailable`, so this block renders
 * nothing anywhere in the app for an installation with no report — no
 * heading, no control, no spacing, and no trace that the feature exists. The
 * app holds no local copy of that gate: the server is the only switch. The
 * one exception (also decided by the view model, not here): an installation
 * that already has a live report can still reach the edit action even while
 * the gate is off, because reading and withdrawing one's own data are never
 * gated.
 *
 * A failed summary read is treated exactly like `unavailable` — the block
 * stays absent rather than showing an error about a feature the shopper
 * never asked for.
 *
 * ## Freshness
 *
 * The summary and this installation's own report are re-read on focus, so
 * returning from the questionnaire (or from a data reset) shows the current
 * truth rather than a stale total. Reads never mint an installation id.
 */

import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import type { MyShopperReport, ShopperReportSummary } from '@/domain/shopper-report';
import type { CommunityReportsSection } from '@/lib/recall-presentation';
import { communityReportsView } from '@/lib/shopper-report-presentation';
import { loadMyReport, loadReportSummary } from '@/lib/shopper-report-store';

interface Loaded {
  summary: ShopperReportSummary;
  report: MyShopperReport | null;
}

export function CommunityReportsBlock({ section }: { section: CommunityReportsSection }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const [summary, report] = await Promise.all([
            loadReportSummary(section.caseId),
            loadMyReport(section.caseId),
          ]);
          if (!cancelled) setLoaded({ summary, report });
        } catch {
          // Unreachable backend, refused read, anything at all: stay silent.
          // This block is additive context, never an error surface.
          if (!cancelled) setLoaded({ summary: { status: 'unavailable' }, report: null });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [section.caseId]),
  );

  // Nothing is rendered before the server has answered: a placeholder would
  // flash a feature that may not be available at all.
  if (loaded === null) return null;
  const view = communityReportsView(loaded.summary, loaded.report);
  if (view === null) return null;

  return (
    <View style={styles.block} accessibilityLabel="Community shopper reports">
      {view.countLine ? <ThemedText>{view.countLine}</ThemedText> : null}
      {view.prompt ? <ThemedText>{view.prompt}</ThemedText> : null}
      <View style={styles.actions}>
        <Link href={{ pathname: '/report/[id]', params: { id: section.caseId } }} asChild>
          <Pressable accessibilityRole="button" accessibilityLabel={view.actionLabel}>
            <ThemedView type="backgroundElement" style={styles.button}>
              <ThemedText style={styles.buttonLabel}>{view.actionLabel}</ThemedText>
            </ThemedView>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Provisional spacing only — separated from the official statement above
  // so community context never reads as part of the government notice.
  block: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  button: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.medium,
  },
  buttonLabel: {
    fontWeight: '600',
  },
});
