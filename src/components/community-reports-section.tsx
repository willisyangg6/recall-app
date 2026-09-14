/**
 * The community shopper-report block (P1D) that renders beneath the official
 * "Where it was sold" statement on Recall Detail.
 *
 * Deliberately isolated: this file is layout, the runtime fetch, and nothing
 * else. Every word comes from lib/shopper-report-presentation (a tested
 * contract), the case's eligibility and the choices a report may name come
 * from the shared presentation model, and the network/queue behavior lives in
 * lib/shopper-report-store. That keeps the styling here easy to replace
 * without touching any contract.
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
 *
 * ## Appearance (P2B2)
 *
 * Part of the Where It Was Sold section, in its body type: the disclosed
 * count or the invitation as `body-small`, then the add/edit action as a
 * `caption` text action in `action/secondary` — the same treatment as the
 * section's other in-place controls, and the link styling Figma gives the
 * community line. It sits `spacing/12` under the official statement so
 * community context reads as its own line, never as part of the government
 * notice. The action is one caption line tall and reaches the 44pt target
 * through `hitSlop`.
 */

import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { hitSlopToMinimum, spacing, typography } from '@/constants/design-tokens';
import type { MyShopperReport, ShopperReportSummary } from '@/domain/shopper-report';
import type { CommunityReportsSection } from '@/lib/recall-presentation';
import { communityReportsView } from '@/lib/shopper-report-presentation';
import { loadMyReport, loadReportSummary } from '@/lib/shopper-report-store';

interface Loaded {
  summary: ShopperReportSummary;
  report: MyShopperReport | null;
}

const ACTION_HIT_SLOP = hitSlopToMinimum(typography.caption.lineHeight);

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
      {view.countLine ? <Text variant="body-small">{view.countLine}</Text> : null}
      {view.prompt ? <Text variant="body-small">{view.prompt}</Text> : null}
      <Link href={{ pathname: '/report/[id]', params: { id: section.caseId } }} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={view.actionLabel}
          hitSlop={ACTION_HIT_SLOP}
          style={styles.action}>
          {({ pressed }) => (
            <Text variant="caption" color="action/secondary" style={pressed && styles.pressed}>
              {view.actionLabel}
            </Text>
          )}
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  // The section's own gap is spacing/8; this margin makes the separation
  // from the official statement spacing/12, the design's community rhythm.
  block: {
    gap: spacing[4],
    marginTop: spacing[4],
  },
  action: {
    alignSelf: 'flex-start',
  },
  pressed: {
    opacity: 0.6,
  },
});
