/**
 * The Personalization screen's sections (P2B6A, selectors reworked in the
 * follow-up), drawn from the system and free of any store: States you shop
 * in, Allergens to watch, Stores you shop at, the autosave line, and the three
 * whole-screen answers a read can give besides a real one. The route reads
 * and saves; these components are handed the preferences and hand back the
 * edited copy, which is what lets the Design Preview render every state
 * without touching this device.
 *
 * ## Any number of states, chosen on their own sheet (P2B7U)
 *
 * The main screen keeps one compact trigger row (the `map-pin` glyph, the
 * first two chosen names and `+N`, or `No states selected`; `Add states` /
 * `Edit states`). It opens the state selector: a page sheet titled `Choose
 * your states` with the shared search field (focused as it appears), a count
 * line in words, `Clear selection`, and the 52 jurisdictions as Check Rows in
 * canonical order.
 *
 * ## `Clear selection` is permanently allocated (P2B7V)
 *
 * It renders in the same place on every visit, whether or not anything is
 * checked. It used to appear only once a state was chosen, which meant
 * checking the FIRST state inserted a 44pt pill above the list and clearing
 * the LAST one removed it — so all 52 rows jumped down and back up under the
 * shopper's finger at exactly the moment they were aiming at one.
 *
 * With nothing checked the control is inert: pressing it changes no state,
 * saves nothing, dismisses nothing, dirties nothing, and announces nothing.
 * The no-op is enforced twice on purpose — the control is `disabled`, and the
 * handler itself returns the same draft reference when there is nothing to
 * clear — so removing either guard alone cannot make an empty clear mutate.
 *
 * This sheet is the one place in the app that edits a DRAFT. Opening it
 * copies the saved selection; every tap changes the copy and nothing else,
 * and the sheet stays open however many are tapped. `Done` — the trailing
 * action, which stays reachable while the list scrolls and the keyboard is
 * up — writes the whole draft once and closes, however many times it is
 * pressed. Any other exit (the swipe down, Android back) discards the draft
 * and leaves the saved states exactly as they were.
 *
 * Why a draft here and not for stores: a store list is composed one chain at
 * a time and each check is independently meaningful, so autosave suits it.
 * A jurisdiction list is picked from 52 rows in one sitting, usually as a
 * replacement of the previous answer, and each intermediate state of that
 * edit is a DIFFERENT set of recalls in Affects me. Saving each tap would
 * mean the shopper's feed briefly answered for a selection they were still
 * assembling, and a half-finished edit would have been synced as the
 * delivery-safety horizon.
 *
 * ## Any allergens, any stores
 *
 * Allergens are Check Rows on the main screen — nine rows, catalog order.
 * Stores get the same trigger-and-sheet shape as the states, because the
 * catalog is long: the main screen shows every chosen store by name (or
 * `No stores selected`) with one action, `Add stores` / `Edit stores`, and
 * the sheet titled `Choose stores` holds the search field, a count line in
 * words, and the whole catalog as Check Rows in its canonical order. A
 * checked row stays exactly where it is; the search narrows the same stable
 * list; clearing the search restores it with every selection intact; `Done`
 * closes. Every check autosaves through the route as it always did, so no
 * dismissal is a save step and none can lose a choice.
 *
 * ## Focus
 *
 * When a sheet closes, focus returns to the trigger row that opened it, so
 * a screen-reader user lands where they left. No height is fixed anywhere.
 *
 * ## Shared with onboarding (P2B7X.1)
 *
 * The States and Retailers onboarding steps render `StateSelectorContent`
 * and `StoreSelectorContent` in their own frames, so a selector edited on
 * first launch and one edited later under Profile are the same rows, the
 * same search and the same `Clear selection`. Two things came with that
 * sharing and therefore reach this screen too: every allergen row carries
 * its glyph (`AllergenGlyph`, one Lucide family — lib/allergen-icons.ts),
 * and every store row carries its mark or the `home` fallback
 * (`RetailerLogo`). Recall cards and Detail are untouched by either.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  StyleSheet,
  View,
  type View as ViewType,
} from 'react-native';

import { SelectorSheet } from '@/components/settings/selector-sheet';
import { SelectorTrigger } from '@/components/settings/selector-trigger';
import { SettingsSection } from '@/components/settings/settings-section';
import { StateMessage } from '@/components/state-message';
import { Button } from '@/components/ui/button';
import { CheckRow } from '@/components/ui/check-row';
import { Icon } from '@/components/ui/icon';
import { RetailerLogo } from '@/components/ui/retailer-logo';
import { SearchBar } from '@/components/ui/search-bar';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import { allergenIconName } from '@/lib/allergen-icons';
import {
  CONSUMER_ALLERGENS,
  stateNamesForCodes,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { ALLERGEN_SECTION_HELPER, ALLERGEN_SECTION_LABEL } from '@/lib/personalization-copy';
import {
  chosenStores,
  clearStateDraft,
  DONE_HINT,
  DONE_LABEL,
  FAILED_STATE,
  filterStateChoices,
  LOADING_STATE,
  saveStatusText,
  stateActionLabel,
  stateChoices,
  stateCountLabel,
  STATE_CLEAR_HINT,
  STATE_CLEAR_LABEL,
  STATE_DONE_HINT,
  STATE_PLACEHOLDER,
  STATE_SEARCH_HINT,
  STATE_SEARCH_LABEL,
  STATE_SEARCH_NO_MATCH,
  STATE_SEARCH_PLACEHOLDER,
  STATE_SECTION_HELPER,
  STATE_SECTION_LABEL,
  STATE_SELECTOR_TITLE,
  STATE_TRIGGER_HINT,
  stateSummary,
  stateTriggerLabel,
  storeActionLabel,
  storeCountLabel,
  storeRows,
  STORE_SEARCH_HINT,
  STORE_SEARCH_LABEL,
  STORE_SEARCH_NO_MATCH,
  STORE_SEARCH_PLACEHOLDER,
  STORE_SECTION_HELPER,
  STORE_SECTION_LABEL,
  STORE_SELECTOR_TITLE,
  STORES_TRIGGER_HINT,
  storeSummary,
  storeTriggerLabel,
  toggleAllergen,
  toggleRetailer,
  toggleStateCode,
  UNSUPPORTED_STATE,
  withStates,
  type PreferencesLoadState,
  type SaveState,
} from '@/lib/personalization-screen';

// ── The whole form ──────────────────────────────────────────────────────────

export function PersonalizationForm({
  prefs,
  onChange,
}: {
  prefs: UserRecallPreferences;
  /** Receives the edited copy; the caller decides what saving means. */
  onChange: (next: UserRecallPreferences) => void;
}) {
  return (
    <>
      <StateSection
        selected={prefs.states}
        onCommit={(codes) => onChange(withStates(prefs, codes))}
      />
      <AllergenSection
        selected={prefs.allergens}
        onToggle={(token) => onChange(toggleAllergen(prefs, token))}
      />
      <StoreSection
        selected={prefs.retailers}
        onToggle={(id) => onChange(toggleRetailer(prefs, id))}
      />
    </>
  );
}

/** Focus back on the row that opened a sheet, once the sheet is gone. */
function useTriggerFocus() {
  const trigger = useRef<ViewType>(null);
  const focusTrigger = useCallback(() => {
    const tag = findNodeHandle(trigger.current);
    if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
  }, []);
  return { trigger, focusTrigger };
}

// ── States ──────────────────────────────────────────────────────────────────

export function StateSection({
  selected,
  onCommit,
}: {
  selected: readonly string[];
  /** The whole committed selection, once, when the sheet's Done is pressed. */
  onCommit: (codes: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // A new key per opening remounts the selector, so every visit starts from
  // a blank search AND from a fresh draft copied off the saved selection —
  // which is also what makes a dismissed edit vanish (the sheet's exit
  // animation still plays, since the key changes only on the way in).
  const [session, setSession] = useState(0);
  const { trigger, focusTrigger } = useTriggerFocus();
  const names = stateNamesForCodes(selected);
  const close = useCallback(() => setOpen(false), []);
  // Done commits once. A second press — a double tap, or one landing while
  // the sheet animates away — must not save again or close again. The latch
  // is released when the row is pressed, which is the only way back in.
  const committed = useRef(false);
  const openSheet = () => {
    committed.current = false;
    setSession((prior) => prior + 1);
    setOpen(true);
  };
  // The one place a state edit is saved: commit, then close. Nothing else in
  // this section calls onCommit, so there is no second save path.
  const commit = useCallback(
    (codes: string[]) => {
      if (committed.current) return;
      committed.current = true;
      onCommit(codes);
      setOpen(false);
    },
    [onCommit],
  );

  return (
    <SettingsSection title={STATE_SECTION_LABEL} description={STATE_SECTION_HELPER}>
      <SelectorTrigger
        ref={trigger}
        icon="map-pin"
        value={selected.length === 0 ? null : stateSummary(selected)}
        placeholder={STATE_PLACEHOLDER}
        action={stateActionLabel(selected)}
        accessibilityLabel={stateTriggerLabel(names)}
        accessibilityHint={STATE_TRIGGER_HINT}
        onPress={openSheet}
      />
      <StateSelector
        key={session}
        visible={open}
        selected={selected}
        onCommit={commit}
        onRequestClose={close}
        onClosed={focusTrigger}
      />
    </SettingsSection>
  );
}

/** The state sheet: the selector's contents on the shared surface. */
export function StateSelector({
  visible,
  selected,
  onCommit,
  onRequestClose,
  onClosed,
}: {
  visible: boolean;
  selected: readonly string[];
  onCommit: (codes: string[]) => void;
  onRequestClose: () => void;
  onClosed?: () => void;
}) {
  return (
    <StateSelectorContent
      selected={selected}
      onCommit={onCommit}
      autoFocus
      frame={({ controls, list, status, onDone }) => (
        <SelectorSheet
          visible={visible}
          title={STATE_SELECTOR_TITLE}
          status={status}
          action={{ label: DONE_LABEL, hint: STATE_DONE_HINT }}
          onAction={onDone}
          onRequestClose={onRequestClose}
          onClosed={onClosed}
          controls={controls}>
          {list}
        </SelectorSheet>
      )}
    />
  );
}

/**
 * What the state selector holds — the search, `Clear selection`, and the
 * checkbox rows — framed by the caller: the sheet on the screen, a plain
 * view in a gallery.
 *
 * The draft lives here and nowhere else. It is seeded from the saved
 * selection at mount and is the only thing a tap, a `Clear selection` or a
 * search can reach; the caller learns about it exactly once, when `Done`
 * hands the whole list over. The rows come from the query alone, so a state
 * checked before a search was typed stays checked while the search hides it.
 */
export function StateSelectorContent({
  selected,
  onCommit,
  onDraftChange,
  autoFocus = false,
  initialQuery = '',
  frame = inlineStates,
}: {
  selected: readonly string[];
  /** Called once, with the complete draft, when the selection is committed. */
  onCommit: (codes: string[]) => void;
  /**
   * Called with the draft after EVERY change (a row, or Clear selection) —
   * for the onboarding step (P2B7X.1), which saves progressively and has no
   * Done. The sheet passes nothing here and keeps its draft private.
   */
  onDraftChange?: (codes: readonly string[]) => void;
  autoFocus?: boolean;
  /** A search already typed — for galleries and tests; the sheet starts blank. */
  initialQuery?: string;
  frame?: (parts: {
    controls: React.ReactNode;
    list: React.ReactNode;
    status: string;
    onDone: () => void;
  }) => React.ReactElement;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [draft, setDraft] = useState<readonly string[]>(selected);
  const choices = useMemo(() => stateChoices(), []);
  const shown = filterStateChoices(choices, query);
  // The whole draft, handed over once. Pressing twice is the SECTION's
  // problem, not this component's: it owns the latch, because it owns both
  // halves of what Done does (the save and the dismissal) and a guard that
  // stopped only one of them would be no guard at all.
  const onDone = useCallback(() => onCommit([...draft]), [draft, onCommit]);
  // The draft's every change, reported once per change to a caller that
  // asked. Reported from an effect rather than from each setter so the
  // report always carries the settled value, and never for the initial
  // seed (a mount is not an edit).
  const reported = useRef<readonly string[]>(draft);
  useEffect(() => {
    if (reported.current === draft) return;
    reported.current = draft;
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);
  // Empties the DRAFT and nothing else. With an empty draft it is a TRUE
  // no-op — the guard is here as well as on the disabled control, so the
  // behaviour survives someone later removing `disabled` (P2B7V).
  const onClear = useCallback(() => setDraft(clearStateDraft), []);

  // The controls slot is a FIXED two-element column: the search field, then
  // `Clear selection`. Neither is conditional and neither may become
  // conditional — that is the whole point (P2B7V). Rendering the clear action
  // only while something was checked made choosing the first state and
  // clearing the last one each insert or remove a 44pt pill above the list,
  // which shifted all 52 rows under the shopper's finger. The control is
  // therefore permanently allocated and merely INERT when there is nothing to
  // clear, so the list never moves for either reason.
  const controls = (
    <>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder={STATE_SEARCH_PLACEHOLDER}
        accessibilityLabel={STATE_SEARCH_LABEL}
        accessibilityHint={STATE_SEARCH_HINT}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="search"
        autoFocus={autoFocus}
      />
      <Button
        variant="secondary"
        label={STATE_CLEAR_LABEL}
        accessibilityHint={STATE_CLEAR_HINT}
        disabled={draft.length === 0}
        onPress={onClear}
      />
    </>
  );

  const list =
    shown.length === 0 ? (
      <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
        {STATE_SEARCH_NO_MATCH}
      </Text>
    ) : (
      shown.map((choice) => (
        <CheckRow
          key={choice.code}
          label={choice.name}
          checked={draft.includes(choice.code)}
          onPress={() => setDraft((prior) => toggleStateCode(prior, choice.code))}
        />
      ))
    );

  return frame({ controls, list, status: stateCountLabel(draft.length), onDone });
}

// ── Allergens ───────────────────────────────────────────────────────────────

export function AllergenSection({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (token: string) => void;
}) {
  return (
    <SettingsSection title={ALLERGEN_SECTION_LABEL} description={ALLERGEN_SECTION_HELPER}>
      <View style={styles.rows}>
        {CONSUMER_ALLERGENS.map((option) => (
          <CheckRow
            key={option.token}
            label={option.label}
            checked={selected.includes(option.token)}
            onPress={() => onToggle(option.token)}
            leading={
              <AllergenGlyph token={option.token} checked={selected.includes(option.token)} />
            }
          />
        ))}
      </View>
    </SettingsSection>
  );
}

/**
 * One allergen's glyph (P2B7X.1): the family's icon for the token, in the
 * same 20pt box on every row, `icon/primary` when the row is checked and
 * `icon/secondary` otherwise — one treatment for all nine, with the
 * checkbox still carrying the state. Decorative: the row speaks its label.
 */
export function AllergenGlyph({ token, checked }: { token: string; checked: boolean }) {
  const name = allergenIconName(token);
  if (name === null) return null;
  return <Icon name={name} size={20} color={checked ? 'icon/primary' : 'icon/secondary'} />;
}

// ── Stores ──────────────────────────────────────────────────────────────────

export function StoreSection({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const { trigger, focusTrigger } = useTriggerFocus();
  const names = chosenStores(selected).map((store) => store.name);
  const close = useCallback(() => setOpen(false), []);
  const openSheet = () => {
    setSession((prior) => prior + 1);
    setOpen(true);
  };

  return (
    <SettingsSection title={STORE_SECTION_LABEL} description={STORE_SECTION_HELPER}>
      <SelectorTrigger
        ref={trigger}
        value={selected.length === 0 ? null : storeSummary(selected)}
        placeholder={storeSummary([])}
        action={storeActionLabel(selected)}
        accessibilityLabel={storeTriggerLabel(names)}
        accessibilityHint={STORES_TRIGGER_HINT}
        onPress={openSheet}
      />
      <StoreSelector
        key={session}
        visible={open}
        selected={selected}
        onToggle={onToggle}
        onRequestClose={close}
        onClosed={focusTrigger}
      />
    </SettingsSection>
  );
}

/** The store sheet: the selector's contents on the shared surface. */
export function StoreSelector({
  visible,
  selected,
  onToggle,
  onRequestClose,
  onClosed,
}: {
  visible: boolean;
  selected: readonly string[];
  onToggle: (id: string) => void;
  onRequestClose: () => void;
  onClosed?: () => void;
}) {
  return (
    <StoreSelectorContent
      selected={selected}
      onToggle={onToggle}
      frame={(controls, list) => (
        <SelectorSheet
          visible={visible}
          title={STORE_SELECTOR_TITLE}
          status={storeCountLabel(selected.length)}
          action={{ label: DONE_LABEL, hint: DONE_HINT }}
          onRequestClose={onRequestClose}
          onClosed={onClosed}
          controls={controls}>
          {list}
        </SelectorSheet>
      )}
    />
  );
}

/**
 * What the store selector holds — the search and the stable checkbox list —
 * framed by the caller. The rows are the catalog's, in the catalog's order;
 * checking one changes its state and nothing about its place.
 */
export function StoreSelectorContent({
  selected,
  onToggle,
  initialQuery = '',
  frame = inline,
}: {
  selected: readonly string[];
  onToggle: (id: string) => void;
  /** A search already typed — for galleries and tests; the sheet starts blank. */
  initialQuery?: string;
  frame?: (controls: React.ReactNode, list: React.ReactNode) => React.ReactElement;
}) {
  const [query, setQuery] = useState(initialQuery);
  const rows = storeRows(query);

  const controls = (
    <SearchBar
      value={query}
      onChangeText={setQuery}
      placeholder={STORE_SEARCH_PLACEHOLDER}
      accessibilityLabel={STORE_SEARCH_LABEL}
      accessibilityHint={STORE_SEARCH_HINT}
      autoCapitalize="words"
      autoCorrect={false}
      returnKeyType="search"
    />
  );

  const list =
    rows.length === 0 ? (
      <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
        {STORE_SEARCH_NO_MATCH}
      </Text>
    ) : (
      rows.map((retailer) => (
        <CheckRow
          key={retailer.id}
          label={retailer.name}
          checked={selected.includes(retailer.id)}
          onPress={() => onToggle(retailer.id)}
          leading={<RetailerLogo retailerId={retailer.id} name={retailer.name} />}
        />
      ))
    );

  return frame(controls, list);
}

/** A gallery's frame: the controls and the list in one column. */
function inline(controls: React.ReactNode, list: React.ReactNode): React.ReactElement {
  return (
    <View style={styles.inline}>
      <View style={styles.rows}>{controls}</View>
      <View style={styles.rows}>{list}</View>
    </View>
  );
}

/**
 * The state selector's gallery frame: the count line the sheet would show
 * above the same controls and list. There is no Done here — a gallery sample
 * has nothing to save to.
 */
function inlineStates({
  controls,
  list,
  status,
}: {
  controls: React.ReactNode;
  list: React.ReactNode;
  status: string;
}): React.ReactElement {
  return (
    <View style={styles.inline}>
      <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
        {status}
      </Text>
      <View style={styles.rows}>{controls}</View>
      <View style={styles.rows}>{list}</View>
    </View>
  );
}

// ── The autosave line ───────────────────────────────────────────────────────

export function SaveStatusLine({ state }: { state: SaveState }) {
  const text = saveStatusText(state);
  if (text === null) return null;
  return (
    <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

// ── Not ready: loading, failed, unsupported ─────────────────────────────────

/** The screen's answer while there are no preferences to edit — never an empty form. */
export function PreferencesNotReady({
  status,
}: {
  status: Exclude<PreferencesLoadState['status'], 'ready'>;
}) {
  if (status === 'loading') {
    return (
      <StateMessage
        scrollable={false}
        tone="loading"
        title={LOADING_STATE.title}
        body={LOADING_STATE.body}
      />
    );
  }
  if (status === 'failed') {
    return (
      <StateMessage
        scrollable={false}
        tone="error"
        title={FAILED_STATE.title}
        body={FAILED_STATE.body}
      />
    );
  }
  return (
    <StateMessage
      scrollable={false}
      title={UNSUPPORTED_STATE.title}
      body={UNSUPPORTED_STATE.body}
    />
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: spacing[8],
  },
  inline: {
    gap: spacing[12],
  },
});
