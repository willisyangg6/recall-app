/**
 * The shopper-report questionnaire (P1D; the Lotly composition from P2B3) —
 * one question per screen, then a review step carrying the point-of-
 * submission privacy disclosure.
 *
 * This file is the flow and its data: which screen is showing, the answers
 * so far, the one server-authoritative load, and the two mutations. How a
 * step looks lives in components/report-questionnaire (network-free, so the
 * development preview can render a step alone); every word comes from the
 * tested contract in lib/shopper-report-presentation; which questions this
 * recall asks, and the only choices each may offer, come from the shared
 * detail model (never from anything this screen derives); and the
 * network/queue behavior lives in lib/shopper-report-store, whose submit is
 * idempotent server-side so a retry can never create a second report or
 * move a count.
 *
 * ## State is first, and a single-state recall's state question IS the ask
 *
 * There is no separate "did you find this product?" step (founder
 * correction, 2026-09-10): tapping the add-report action already states
 * that intent. For a recall naming exactly one official state, the state
 * question doubles as the whole find/decline confirmation ("Did you find
 * this product in California?" — Yes/No); "No" ends the flow immediately
 * with nothing stored and nothing counted. For a multi-state or nationwide
 * recall there is no decline path at all — picking a state from the list is
 * itself the complete answer, exactly like the multi-state case never asked
 * a generic yes/no either.
 *
 * ## Gating
 *
 * The screen re-reads the server's thresholded summary before showing the
 * form. While the production feature gate is off every summary is
 * `unavailable`, so a direct deep link to this route lands on an honest
 * "not available" state instead of a form whose submission the server would
 * refuse. The one exception: reading and withdrawing one's own report are
 * never gated (docs/recall-shopper-reports.md §5), so an installation that
 * already has a live report reaches a reduced screen offering only removal
 * — never a form whose submission would be refused. The app holds no local
 * copy of the gate.
 *
 * ## Composition (P2B3)
 *
 * The warm page under the navigator's own header, `spacing/16` margins, the
 * content column capped at `max-content-width`, and the bottom safe-area
 * inset added to the content padding. The scroll view keeps the jurisdiction
 * search field and its list above the keyboard and dismisses the keyboard on
 * a drag; a tap on a row while the keyboard is up chooses the row. No step
 * has a fixed height and no transition is animated, so there is no motion
 * for Reduce Motion to disable — the platform's own screen transition is the
 * only one, and it already honours the setting.
 */

import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  OutcomeStep,
  PausedStep,
  QuestionStep,
  ReviewStep,
  type ReviewBusy,
} from '@/components/report-questionnaire';
import { StateMessage } from '@/components/state-message';
import { Surface } from '@/components/ui/surface';
import { layout, spacing } from '@/constants/design-tokens';
import type { MyShopperReport } from '@/domain/shopper-report';
import { fetchCaseDetail } from '@/lib/recall-feed';
import {
  buildDetailModel,
  todayIso,
  type CommunityReportsSection,
} from '@/lib/recall-presentation';
import {
  answersFromReport,
  DECLINED_BODY,
  DECLINED_TITLE,
  EMPTY_ANSWERS,
  PRIVACY_DOCUMENT_SLUG,
  questionnaireOutcome,
  questionnaireSteps,
  REMOVE_CONFIRM_BODY,
  REMOVE_CONFIRM_CANCEL,
  REMOVE_CONFIRM_REMOVE,
  REMOVE_CONFIRM_TITLE,
  REMOVE_FAILURE,
  REMOVED_BODY,
  REMOVED_TITLE,
  REPORT_LOADING,
  REPORT_SCREEN_TITLE,
  REPORT_UNAVAILABLE,
  SUBMIT_FAILURE,
  SUCCESS_BODY,
  SUCCESS_TITLE,
  type QuestionKey,
  type QuestionnaireAnswers,
} from '@/lib/shopper-report-presentation';
import {
  loadMyReport,
  loadReportSummary,
  submitReport,
  withdrawReport,
} from '@/lib/shopper-report-store';

type Screen =
  | { kind: 'loading' }
  /** The case is ineligible, or the feature is off with no existing report. */
  | { kind: 'unavailable' }
  /** The feature is off, but this installation has a report it can still remove. */
  | { kind: 'paused' }
  | { kind: 'question'; index: number }
  | { kind: 'review' }
  | { kind: 'declined' }
  | { kind: 'submitted' }
  | { kind: 'removed' };

export default function ShopperReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [section, setSection] = useState<CommunityReportsSection | null>(null);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(EMPTY_ANSWERS);
  const [existing, setExisting] = useState<MyShopperReport | null>(null);
  // Which mutation is in flight, so the control that started it can say so
  // and neither control can fire while the other is settling.
  const [busy, setBusy] = useState<ReviewBusy>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The case's own eligibility (from the shared model), the server's
        // summary (which is `unavailable` whenever the feature is switched
        // off), and this installation's own report — read unconditionally,
        // since reading it is never gated and an owner may need it even
        // while the feature is off.
        const [detail, summary, mine] = await Promise.all([
          fetchCaseDetail(id),
          loadReportSummary(id),
          loadMyReport(id),
        ]);
        if (cancelled) return;
        const decided =
          detail === null
            ? null
            : buildDetailModel(detail, { today: todayIso(), affectsYou: false }).sections
                .communityReports;
        if (decided === null) {
          setScreen({ kind: 'unavailable' });
          return;
        }
        if (summary.status === 'unavailable') {
          // Collection and the public summary are gated; an owner's own
          // read and their removal control are not. There is nothing else
          // useful to offer here — a re-submission would be refused
          // regardless of what the form said.
          if (mine === null) {
            setScreen({ kind: 'unavailable' });
            return;
          }
          setExisting(mine);
          setScreen({ kind: 'paused' });
          return;
        }
        setSection(decided);
        // An existing report pre-fills the form: editing starts from what the
        // server holds, so a shopper never retypes an answer to change one.
        if (mine !== null) {
          setExisting(mine);
          setAnswers(answersFromReport(mine));
        }
        setScreen({ kind: 'question', index: 0 });
      } catch {
        if (!cancelled) setScreen({ kind: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const steps: QuestionKey[] = section ? questionnaireSteps(section) : [];
  const outcome = section ? questionnaireOutcome(answers, section) : null;

  const answer = useCallback((patch: Partial<QuestionnaireAnswers>) => {
    setFailure(null);
    setAnswers((prior) => ({ ...prior, ...patch }));
  }, []);

  const submit = async () => {
    if (busy || outcome?.kind !== 'ready') return;
    setBusy('submit');
    setFailure(null);
    try {
      await submitReport(id, outcome.draft);
      setScreen({ kind: 'submitted' });
    } catch {
      // Every refusal — offline, case closed mid-flow, gate switched off —
      // ends the same way, because in every one of them the server refused
      // before writing anything. The answers stay exactly as they were.
      setFailure(SUBMIT_FAILURE);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy('remove');
    setFailure(null);
    try {
      await withdrawReport(id);
      setScreen({ kind: 'removed' });
    } catch {
      setFailure(REMOVE_FAILURE);
    } finally {
      setBusy(null);
    }
  };

  // The one confirmation gate before a destructive call, mirroring the
  // "Reset app and delete my data" pattern: Cancel performs no mutation.
  const confirmRemove = () => {
    if (busy) return;
    Alert.alert(REMOVE_CONFIRM_TITLE, REMOVE_CONFIRM_BODY, [
      { text: REMOVE_CONFIRM_CANCEL, style: 'cancel' },
      { text: REMOVE_CONFIRM_REMOVE, style: 'destructive', onPress: () => void remove() },
    ]);
  };

  const openPrivacy = () =>
    router.push({ pathname: '/document/[slug]', params: { slug: PRIVACY_DOCUMENT_SLUG } });

  const done = () => router.back();

  const body = () => {
    if (screen.kind === 'loading') {
      return <StateMessage {...REPORT_LOADING} tone="loading" />;
    }
    if (screen.kind === 'unavailable') {
      return <StateMessage {...REPORT_UNAVAILABLE} />;
    }
    if (screen.kind === 'paused') {
      return <PausedStep busy={busy === 'remove'} failure={failure} onRemove={confirmRemove} />;
    }
    if (screen.kind === 'declined') {
      return <OutcomeStep title={DECLINED_TITLE} body={DECLINED_BODY} onDone={done} />;
    }
    if (screen.kind === 'submitted') {
      return <OutcomeStep title={SUCCESS_TITLE} body={SUCCESS_BODY} onDone={done} />;
    }
    if (screen.kind === 'removed') {
      return <OutcomeStep title={REMOVED_TITLE} body={REMOVED_BODY} onDone={done} />;
    }
    if (section === null) return null;

    if (screen.kind === 'review') {
      const shared = {
        section,
        answers,
        canSubmit: outcome?.kind === 'ready',
        busy,
        failure,
        onSubmit: () => void submit(),
        onBack: () => setScreen({ kind: 'question', index: steps.length - 1 }),
        onOpenPrivacy: openPrivacy,
      };
      // Removal exists only here, and only while editing an existing report.
      return existing ? (
        <ReviewStep {...shared} mode="update" onRemove={confirmRemove} />
      ) : (
        <ReviewStep {...shared} mode="submit" />
      );
    }

    const key = steps[screen.index];
    const answered = outcome?.kind !== 'incomplete' || outcome.next !== key;
    return (
      <QuestionStep
        section={section}
        stepKey={key}
        stepIndex={screen.index}
        stepCount={steps.length}
        answers={answers}
        canAdvance={answered}
        onAnswer={answer}
        onBack={
          screen.index > 0 ? () => setScreen({ kind: 'question', index: screen.index - 1 }) : null
        }
        onNext={() => {
          // A single-state "No" ends the flow here: nothing is stored,
          // nothing is counted, and the server is never contacted.
          if (outcome?.kind === 'declined') {
            setScreen({ kind: 'declined' });
            return;
          }
          if (screen.index + 1 < steps.length) {
            setScreen({ kind: 'question', index: screen.index + 1 });
            return;
          }
          setScreen({ kind: 'review' });
        }}
      />
    );
  };

  return (
    <Surface background="background/page" style={styles.page}>
      <Stack.Screen options={{ title: REPORT_SCREEN_TITLE }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets>
        {body()}
      </ScrollView>
    </Surface>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  // flexGrow lets a whole-screen state centre itself; content-driven
  // otherwise, so a long question or list simply scrolls.
  content: {
    flexGrow: 1,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: spacing[16],
    gap: spacing[16],
  },
});
