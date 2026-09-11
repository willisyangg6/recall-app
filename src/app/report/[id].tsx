/**
 * The shopper-report questionnaire (P1D) — one question per screen, then a
 * review step carrying the point-of-submission privacy disclosure.
 *
 * Layout and local answer state only. Every word comes from the tested
 * contract in lib/shopper-report-presentation; which questions this recall
 * asks, and the only choices each may offer, come from the shared detail
 * model (never from anything this screen derives); and the network/queue
 * behavior lives in lib/shopper-report-store, whose submit is idempotent
 * server-side so a retry can never create a second report or move a count.
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
 */

import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MyShopperReport } from '@/domain/shopper-report';
import { fetchCaseDetail } from '@/lib/recall-feed';
import {
  buildDetailModel,
  todayIso,
  type CommunityReportsSection,
} from '@/lib/recall-presentation';
import {
  answerLabel,
  answersFromReport,
  BACK_ACTION,
  DECLINED_BODY,
  DECLINED_TITLE,
  DONE_ACTION,
  EMPTY_ANSWERS,
  isSingleStateCase,
  NEXT_ACTION,
  PRIVACY_DOCUMENT_SLUG,
  PRIVACY_LINK_LABEL,
  purchaseWindowOptions,
  questionnaireOutcome,
  questionnaireSteps,
  questionPrompt,
  REMOVE_CONFIRM_BODY,
  REMOVE_CONFIRM_CANCEL,
  REMOVE_CONFIRM_REMOVE,
  REMOVE_CONFIRM_TITLE,
  REMOVE_FAILURE,
  REMOVED_BODY,
  REMOVED_TITLE,
  REPORT_PAUSED_MESSAGE,
  REPORT_REMOVE_ACTION,
  REPORT_SCREEN_TITLE,
  retailerOptions,
  stateOptions,
  STATE_CONFIRM_HELP,
  STATE_CONFIRM_OPTIONS,
  SUBMIT_ACTION,
  SUBMIT_FAILURE,
  SUBMISSION_DISCLOSURE,
  SUBMITTING_LABEL,
  SUCCESS_BODY,
  SUCCESS_TITLE,
  UPDATE_ACTION,
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

/** One tappable answer. Provisional styling; the selected state is explicit. */
function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}>
      <ThemedView
        type={selected ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.choice}>
        <ThemedText style={selected ? styles.choiceSelected : undefined}>
          {selected ? `✓ ${label}` : label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

/** The jurisdiction question: searchable once the list is long enough to need it. */
function StateQuestion({
  section,
  value,
  onChange,
}: {
  section: CommunityReportsSection;
  value: string | null;
  onChange: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const theme = useTheme();
  const options = stateOptions(section.allowedStateCodes);
  const searchable = options.length > 8;
  const shown =
    query.trim() === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <View style={styles.choices}>
      {searchable ? (
        <TextInput
          style={[styles.search, { color: theme.text }]}
          placeholder="Search states"
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search states"
        />
      ) : null}
      {shown.map((option) => (
        <Choice
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

/** The single-state confirm: "Did you find this product in <State>?" Yes/No. */
function StateConfirmQuestion({
  section,
  answers,
  onAnswer,
}: {
  section: CommunityReportsSection;
  answers: QuestionnaireAnswers;
  onAnswer: (patch: Partial<QuestionnaireAnswers>) => void;
}) {
  const onlyState = section.allowedStateCodes[0];
  return (
    <View style={styles.choices}>
      <ThemedText type="small" themeColor="textSecondary">
        {STATE_CONFIRM_HELP}
      </ThemedText>
      {STATE_CONFIRM_OPTIONS.map((option) => (
        <Choice
          key={option.value}
          label={option.label}
          selected={
            option.value === 'yes' ? answers.stateCode === onlyState : answers.declined === true
          }
          onPress={() =>
            option.value === 'yes'
              ? onAnswer({ stateCode: onlyState, declined: false })
              : onAnswer({ declined: true, stateCode: null })
          }
        />
      ))}
    </View>
  );
}

export default function ShopperReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [section, setSection] = useState<CommunityReportsSection | null>(null);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(EMPTY_ANSWERS);
  const [existing, setExisting] = useState<MyShopperReport | null>(null);
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setFailure(null);
    try {
      await submitReport(id, outcome.draft);
      setScreen({ kind: 'submitted' });
    } catch {
      // Every refusal — offline, case closed mid-flow, gate switched off —
      // ends the same way, because in every one of them the server refused
      // before writing anything.
      setFailure(SUBMIT_FAILURE);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await withdrawReport(id);
      setScreen({ kind: 'removed' });
    } catch {
      setFailure(REMOVE_FAILURE);
    } finally {
      setBusy(false);
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

  const body = () => {
    if (screen.kind === 'loading') {
      return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
    }
    if (screen.kind === 'unavailable') {
      return (
        <ThemedText themeColor="textSecondary">
          Shopper reports are not available for this recall.
        </ThemedText>
      );
    }
    if (screen.kind === 'paused') {
      return (
        <View style={styles.step} accessibilityLiveRegion="polite">
          <ThemedText themeColor="textSecondary">{REPORT_PAUSED_MESSAGE}</ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={REPORT_REMOVE_ACTION}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={confirmRemove}>
            <ThemedText themeColor="link">{REPORT_REMOVE_ACTION}</ThemedText>
          </Pressable>
          {failure ? <ThemedText accessibilityLiveRegion="polite">{failure}</ThemedText> : null}
        </View>
      );
    }
    if (screen.kind === 'declined') {
      return <Outcome title={DECLINED_TITLE} body={DECLINED_BODY} />;
    }
    if (screen.kind === 'submitted') {
      return <Outcome title={SUCCESS_TITLE} body={SUCCESS_BODY} />;
    }
    if (screen.kind === 'removed') {
      return <Outcome title={REMOVED_TITLE} body={REMOVED_BODY} />;
    }
    if (section === null) return null;

    if (screen.kind === 'review') {
      return (
        <View style={styles.step}>
          <ThemedText type="subtitle">Review your report</ThemedText>
          {steps.map((key) => (
            <View key={key} style={styles.reviewRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {questionPrompt(key, section)}
              </ThemedText>
              <ThemedText>{answerLabel(key, answers) ?? ''}</ThemedText>
            </View>
          ))}

          {/* The one-line point-of-submission disclosure: stated here, at
              the moment of submitting, not left to a document a shopper
              would have to go looking for. */}
          <View style={styles.disclosure}>
            <ThemedText type="small" themeColor="textSecondary">
              {SUBMISSION_DISCLOSURE}{' '}
              <ThemedText
                type="small"
                themeColor="link"
                accessibilityRole="link"
                onPress={openPrivacy}>
                {PRIVACY_LINK_LABEL}
              </ThemedText>
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={() => void submit()}>
            <ThemedView type="backgroundSelected" style={styles.button}>
              <ThemedText style={styles.buttonLabel}>
                {busy ? SUBMITTING_LABEL : existing ? UPDATE_ACTION : SUBMIT_ACTION}
              </ThemedText>
            </ThemedView>
          </Pressable>
          {existing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={REPORT_REMOVE_ACTION}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={confirmRemove}>
              <ThemedText themeColor="link">{REPORT_REMOVE_ACTION}</ThemedText>
            </Pressable>
          ) : null}
          {failure ? <ThemedText accessibilityLiveRegion="polite">{failure}</ThemedText> : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => setScreen({ kind: 'question', index: steps.length - 1 })}>
            <ThemedText themeColor="link">{BACK_ACTION}</ThemedText>
          </Pressable>
        </View>
      );
    }

    const key = steps[screen.index];
    const answered = outcome?.kind !== 'incomplete' || outcome.next !== key;
    return (
      <View style={styles.step}>
        <ThemedText type="subtitle" accessibilityRole="header">
          {questionPrompt(key, section)}
        </ThemedText>

        {key === 'state' ? (
          isSingleStateCase(section) ? (
            <StateConfirmQuestion section={section} answers={answers} onAnswer={answer} />
          ) : (
            <StateQuestion
              section={section}
              value={answers.stateCode}
              onChange={(code) => answer({ stateCode: code, declined: false })}
            />
          )
        ) : null}

        {key === 'retailer' ? (
          <View style={styles.choices}>
            {retailerOptions(section.retailerChoices).map((option) => (
              <Choice
                key={option.value}
                label={option.label}
                selected={answers.retailer === option.value}
                onPress={() => answer({ retailer: option.value })}
              />
            ))}
          </View>
        ) : null}

        {key === 'window' ? (
          <View style={styles.choices}>
            {purchaseWindowOptions().map((option) => (
              <Choice
                key={option.value}
                label={option.label}
                selected={answers.purchaseWindow === option.value}
                onPress={() => answer({ purchaseWindow: option.value })}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          {screen.index > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setScreen({ kind: 'question', index: screen.index - 1 })}>
              <ThemedText themeColor="link">{BACK_ACTION}</ThemedText>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !answered }}
            disabled={!answered}
            onPress={() => {
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
            }}>
            <ThemedText themeColor={answered ? 'link' : 'textSecondary'}>{NEXT_ACTION}</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: REPORT_SCREEN_TITLE }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
        keyboardShouldPersistTaps="handled">
        {body()}
      </ScrollView>
    </ThemedView>
  );
}

/** A terminal state: what happened, what it means, and one way out. */
function Outcome({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.step} accessibilityLiveRegion="polite">
      <ThemedText type="subtitle" accessibilityRole="header">
        {title}
      </ThemedText>
      <ThemedText themeColor="textSecondary">{body}</ThemedText>
      <Pressable accessibilityRole="button" onPress={() => router.back()}>
        <ThemedText themeColor="link">{DONE_ACTION}</ThemedText>
      </Pressable>
    </View>
  );
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
  // Provisional language throughout — spacing and the existing themed
  // surfaces only, so the design-system pass can replace this file's styles
  // without touching a single contract.
  step: {
    gap: Spacing.two,
  },
  choices: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  choice: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.small,
  },
  choiceSelected: {
    fontWeight: '600',
  },
  search: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.one,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    marginTop: Spacing.three,
  },
  reviewRow: {
    gap: Spacing.half,
  },
  disclosure: {
    gap: Spacing.one,
    marginTop: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8888',
  },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.medium,
    marginTop: Spacing.two,
  },
  buttonLabel: {
    fontWeight: '600',
  },
});
