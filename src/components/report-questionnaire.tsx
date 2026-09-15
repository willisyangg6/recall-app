/**
 * The shopper-report questionnaire's steps (P2B3) — the question step, the
 * review step, the terminal outcome, the paused state, and the recoverable
 * failure — as network-free components the screen composes.
 *
 * Every word is the tested contract's (lib/shopper-report-presentation);
 * which questions a recall asks, and the only choices each may offer, arrive
 * as the shared section and are never derived here; and nothing in this file
 * can reach the server — submitting, removing and navigating are callbacks
 * the screen owns. That split is what lets the development Design Preview
 * render a step on its own (a stateless section, a failure, the paused
 * state) without a copy of the questionnaire and without a request.
 *
 * ## Composition
 *
 * A step is a `caption` progress line (the contract's "Question 1 of 3"),
 * the question in `heading-2`, the answers as Choice Rows in one radio
 * group, and the actions — Back as a secondary pill when there is a step to
 * go back to, Next as the primary pill, inert until the question is
 * answered. The jurisdiction picker adds the shared search bar above its
 * list once the list is long enough to need one, and says so when nothing
 * matches. The review step lists the questions asked with the answers given
 * on one white surface, then the one-line disclosure with its inline link,
 * then the primary action (the contract decides whether it reads as a first
 * submission or an update), a failure beneath it when a submission was
 * refused, and — only while editing — the removal control. Nothing is
 * truncated and no height is fixed: every surface is as tall as its text.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ChoiceGroup, ChoiceRow } from '@/components/ui/choice-row';
import { SearchBar } from '@/components/ui/search-bar';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, hitTarget, spacing } from '@/constants/design-tokens';
import {
  BACK_ACTION,
  DONE_ACTION,
  filterStateOptions,
  isSingleStateCase,
  isStateListSearchable,
  NEXT_ACTION,
  PRIVACY_LINK_HINT,
  PRIVACY_LINK_LABEL,
  purchaseWindowOptions,
  questionProgressLabel,
  questionPrompt,
  REMOVING_LABEL,
  REPORT_PAUSED_MESSAGE,
  REPORT_REMOVE_ACTION,
  retailerOptions,
  REVIEW_TITLE,
  reviewRows,
  STATE_CONFIRM_HELP,
  STATE_CONFIRM_OPTIONS,
  STATE_SEARCH_HINT,
  STATE_SEARCH_LABEL,
  STATE_SEARCH_NO_MATCH,
  STATE_SEARCH_PLACEHOLDER,
  stateOptions,
  SUBMISSION_DISCLOSURE,
  SUBMIT_ACTION,
  SUBMITTING_LABEL,
  UPDATE_ACTION,
  type QuestionKey,
  type QuestionnaireAnswers,
  type QuestionnaireChoices,
} from '@/lib/shopper-report-presentation';

// ── One question ────────────────────────────────────────────────────────────

export function QuestionStep({
  section,
  stepKey,
  stepIndex,
  stepCount,
  answers,
  canAdvance,
  onAnswer,
  onBack,
  onNext,
}: {
  section: QuestionnaireChoices;
  stepKey: QuestionKey;
  stepIndex: number;
  stepCount: number;
  answers: QuestionnaireAnswers;
  /** Whether this question is answered well enough to move on (the contract's verdict). */
  canAdvance: boolean;
  onAnswer: (patch: Partial<QuestionnaireAnswers>) => void;
  /** Absent on the first question: there is nothing to go back to. */
  onBack: (() => void) | null;
  onNext: () => void;
}) {
  const prompt = questionPrompt(stepKey, section);
  return (
    <View style={styles.step}>
      <View style={styles.heading}>
        <Text variant="caption" color="text/secondary">
          {questionProgressLabel(stepIndex, stepCount)}
        </Text>
        <Text variant="heading-2" accessibilityRole="header">
          {prompt}
        </Text>
      </View>

      {stepKey === 'state' ? (
        isSingleStateCase(section) ? (
          <StateConfirmChoices
            section={section}
            answers={answers}
            onAnswer={onAnswer}
            prompt={prompt}
          />
        ) : (
          <StatePicker
            section={section}
            value={answers.stateCode}
            onChange={(code) => onAnswer({ stateCode: code, declined: false })}
            prompt={prompt}
          />
        )
      ) : null}

      {stepKey === 'retailer' ? (
        <ChoiceGroup label={prompt}>
          {retailerOptions(section.retailerChoices).map((option) => (
            <ChoiceRow
              key={option.value}
              label={option.label}
              checked={answers.retailer === option.value}
              onPress={() => onAnswer({ retailer: option.value })}
            />
          ))}
        </ChoiceGroup>
      ) : null}

      {stepKey === 'window' ? (
        <ChoiceGroup label={prompt}>
          {purchaseWindowOptions().map((option) => (
            <ChoiceRow
              key={option.value}
              label={option.label}
              checked={answers.purchaseWindow === option.value}
              onPress={() => onAnswer({ purchaseWindow: option.value })}
            />
          ))}
        </ChoiceGroup>
      ) : null}

      <View style={styles.actions}>
        {onBack ? <Button variant="secondary" label={BACK_ACTION} onPress={onBack} /> : null}
        <Button label={NEXT_ACTION} onPress={onNext} disabled={!canAdvance} style={styles.grow} />
      </View>
    </View>
  );
}

/** The single-state confirm: the contract's Yes / No, with its one line of context. */
function StateConfirmChoices({
  section,
  answers,
  onAnswer,
  prompt,
}: {
  section: QuestionnaireChoices;
  answers: QuestionnaireAnswers;
  onAnswer: (patch: Partial<QuestionnaireAnswers>) => void;
  prompt: string;
}) {
  const onlyState = section.allowedStateCodes[0];
  return (
    <View style={styles.choices}>
      <Text variant="body-small" color="text/secondary">
        {STATE_CONFIRM_HELP}
      </Text>
      <ChoiceGroup label={prompt}>
        {STATE_CONFIRM_OPTIONS.map((option) => (
          <ChoiceRow
            key={option.value}
            label={option.label}
            checked={
              option.value === 'yes' ? answers.stateCode === onlyState : answers.declined === true
            }
            onPress={() =>
              option.value === 'yes'
                ? onAnswer({ stateCode: onlyState, declined: false })
                : onAnswer({ declined: true, stateCode: null })
            }
          />
        ))}
      </ChoiceGroup>
    </View>
  );
}

/**
 * The jurisdiction picker: the notice's own states, searchable once the list
 * is long enough to need it. The search field filters the list and can never
 * become an answer — only a row can.
 */
function StatePicker({
  section,
  value,
  onChange,
  prompt,
}: {
  section: QuestionnaireChoices;
  value: string | null;
  onChange: (code: string) => void;
  prompt: string;
}) {
  const [query, setQuery] = useState('');
  const options = stateOptions(section.allowedStateCodes);
  const shown = filterStateOptions(options, query);
  return (
    <View style={styles.choices}>
      {isStateListSearchable(options) ? (
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={STATE_SEARCH_PLACEHOLDER}
          accessibilityLabel={STATE_SEARCH_LABEL}
          accessibilityHint={STATE_SEARCH_HINT}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
        />
      ) : null}
      {shown.length === 0 ? (
        <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
          {STATE_SEARCH_NO_MATCH}
        </Text>
      ) : (
        <ChoiceGroup label={prompt}>
          {shown.map((option) => (
            <ChoiceRow
              key={option.value}
              label={option.label}
              checked={option.value === value}
              onPress={() => onChange(option.value)}
            />
          ))}
        </ChoiceGroup>
      )}
    </View>
  );
}

// ── Review ──────────────────────────────────────────────────────────────────

export type ReviewBusy = 'submit' | 'remove' | null;

export type ReviewStepProps = {
  section: QuestionnaireChoices;
  answers: QuestionnaireAnswers;
  /** The contract's verdict: only a ready draft may be submitted. */
  canSubmit: boolean;
  busy: ReviewBusy;
  /** The refusal to show beneath the action, or null. Answers stay as they were. */
  failure: string | null;
  onSubmit: () => void;
  onBack: () => void;
  onOpenPrivacy: () => void;
} & (
  | { mode: 'submit' }
  /** Editing an existing report: the action updates, and removal is offered. */
  | { mode: 'update'; onRemove: () => void }
);

export function ReviewStep(props: ReviewStepProps) {
  const { section, answers, canSubmit, busy, failure, onSubmit, onBack, onOpenPrivacy } = props;
  const rows = reviewRows(answers, section);
  return (
    <View style={styles.step}>
      <Text variant="heading-2" accessibilityRole="header">
        {REVIEW_TITLE}
      </Text>

      <Surface radius={12} border="border/subtle" style={styles.reviewCard}>
        {rows.map((row, index) => (
          <View
            key={row.key}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${row.prompt} ${row.answer}`}
            style={[styles.reviewRow, index > 0 && styles.reviewRowDivided]}>
            <Text variant="caption" color="text/secondary">
              {row.prompt}
            </Text>
            <Text variant="body">{row.answer}</Text>
          </View>
        ))}
      </Surface>

      {/* The point-of-submission disclosure, stated here at the moment of
          submitting. Two elements, deliberately: the sentence is ordinary
          static text that reads aloud as a statement, and only
          `Learn more.` is interactive — a real link with its own spoken
          name, its own hint, and its own 44pt target from the row it sits
          in. (Making the whole sentence the link announced the statement
          itself as tappable, which it is not.) Both are `body-small` and
          wrap freely, so the pair reads as one disclosure at any type
          size. */}
      <View style={styles.disclosure}>
        <Text variant="body-small" color="text/secondary">
          {SUBMISSION_DISCLOSURE}
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={PRIVACY_LINK_LABEL}
          accessibilityHint={PRIVACY_LINK_HINT}
          onPress={onOpenPrivacy}
          style={styles.disclosureLink}>
          {({ pressed }) => (
            <Text variant="body-small" color="action/secondary" style={pressed && styles.pressed}>
              {PRIVACY_LINK_LABEL}
            </Text>
          )}
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Button variant="secondary" label={BACK_ACTION} onPress={onBack} disabled={busy !== null} />
        <Button
          label={props.mode === 'update' ? UPDATE_ACTION : SUBMIT_ACTION}
          busyLabel={SUBMITTING_LABEL}
          busy={busy === 'submit'}
          disabled={!canSubmit || busy !== null}
          onPress={onSubmit}
          style={styles.grow}
        />
      </View>

      {failure ? <FailureMessage message={failure} /> : null}

      {props.mode === 'update' ? (
        <Button
          variant="secondary"
          label={REPORT_REMOVE_ACTION}
          busyLabel={REMOVING_LABEL}
          busy={busy === 'remove'}
          disabled={busy !== null}
          onPress={props.onRemove}
        />
      ) : null}
    </View>
  );
}

// ── Endings ─────────────────────────────────────────────────────────────────

/** A terminal state: what happened, what it means, and one way out. */
export function OutcomeStep({
  title,
  body,
  onDone,
}: {
  title: string;
  body: string;
  onDone: () => void;
}) {
  return (
    <View style={styles.step} accessibilityLiveRegion="polite">
      <View style={styles.heading}>
        <Text variant="heading-2" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="body" color="text/secondary">
          {body}
        </Text>
      </View>
      <Button label={DONE_ACTION} onPress={onDone} />
    </View>
  );
}

/**
 * Reporting is switched off but this installation still holds a report.
 * Reading and withdrawing are never gated, so removal is the one control
 * offered; there is no form, because a re-submission would be refused.
 */
export function PausedStep({
  busy,
  failure,
  onRemove,
}: {
  busy: boolean;
  failure: string | null;
  onRemove: () => void;
}) {
  return (
    <View style={styles.step} accessibilityLiveRegion="polite">
      <Text variant="body">{REPORT_PAUSED_MESSAGE}</Text>
      <Button
        variant="secondary"
        label={REPORT_REMOVE_ACTION}
        busyLabel={REMOVING_LABEL}
        busy={busy}
        onPress={onRemove}
      />
      {failure ? <FailureMessage message={failure} /> : null}
    </View>
  );
}

/**
 * A recoverable refusal — the server refused before writing, so the answers
 * on screen are still the shopper's and the action can simply be tried
 * again. Announced as an alert; drawn on the white surface with a strong
 * border so it is neither the lime relevance treatment nor the soft-blue
 * information one.
 */
export function FailureMessage({ message }: { message: string }) {
  return (
    <Surface
      radius={8}
      border="border/strong"
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.failure}>
      <Text variant="body-small">{message}</Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: spacing[16],
  },
  heading: {
    gap: spacing[4],
  },
  choices: {
    gap: spacing[12],
  },
  // The action row wraps at accessibility text sizes rather than clipping a
  // label; the primary action takes the remaining width.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[8],
    marginTop: spacing[8],
  },
  grow: {
    flexGrow: 1,
  },
  reviewCard: {
    paddingHorizontal: spacing[16],
  },
  reviewRow: {
    gap: spacing[4],
    paddingVertical: spacing[12],
  },
  reviewRowDivided: {
    borderTopWidth: 1,
    borderTopColor: color['border/subtle'],
  },
  failure: {
    padding: spacing[12],
  },
  // The statement and its link, as one block. The link's own row carries
  // the 44pt target; the sentence above it is not interactive.
  disclosure: {
    gap: spacing[4],
  },
  disclosureLink: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: hitTarget.minimum,
  },
  pressed: {
    opacity: 0.6,
  },
});
