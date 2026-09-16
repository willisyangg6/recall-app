/**
 * The Personalization screen's sections (P2B6A, selectors reworked in the
 * follow-up), drawn from the system and free of any store: Your state,
 * Allergens to watch, Stores you shop at, the autosave line, and the three
 * whole-screen answers a read can give besides a real one. The route reads
 * and saves; these components are handed the preferences and hand back the
 * edited copy, which is what lets the Design Preview render every state
 * without touching this device.
 *
 * ## One state, chosen on its own sheet
 *
 * The main screen keeps one compact trigger row (the `map-pin` glyph, the
 * chosen state or `Choose your state`, `Select` / `Change`). It opens the
 * state selector: a page sheet titled `Choose your state` with the shared
 * search field (focused as it appears), `Clear selection` while a state is
 * chosen, and the 52 jurisdictions as the questionnaire's radio rows, the
 * current one checked. Choosing a row replaces the state and closes the
 * sheet. `Clear selection` sets the state to null and KEEPS the sheet open,
 * so another state can be chosen at once. `Close` (or a swipe down) exits
 * without changing anything. Clearing the search and clearing the selection
 * are separate controls.
 *
 * ## Any allergens, any stores
 *
 * Allergens are Check Rows on the main screen — nine rows, catalog order.
 * Stores get the same trigger-and-sheet shape as the state, because the
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
 */

import { useCallback, useMemo, useRef, useState } from 'react';
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
import { ChoiceGroup, ChoiceRow } from '@/components/ui/choice-row';
import { SearchBar } from '@/components/ui/search-bar';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import {
  CONSUMER_ALLERGENS,
  stateNameForCode,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { ALLERGEN_SECTION_HELPER, ALLERGEN_SECTION_LABEL } from '@/lib/personalization-copy';
import {
  chosenStores,
  CLOSE_HINT,
  CLOSE_LABEL,
  DONE_HINT,
  DONE_LABEL,
  FAILED_STATE,
  filterStateChoices,
  LOADING_STATE,
  saveStatusText,
  STATE_CHANGE_LABEL,
  stateChoices,
  STATE_CLEAR_LABEL,
  STATE_PLACEHOLDER,
  STATE_SEARCH_HINT,
  STATE_SEARCH_LABEL,
  STATE_SEARCH_NO_MATCH,
  STATE_SEARCH_PLACEHOLDER,
  STATE_SECTION_HELPER,
  STATE_SECTION_LABEL,
  STATE_SELECT_LABEL,
  STATE_SELECTOR_TITLE,
  STATE_TRIGGER_HINT,
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
  UNSUPPORTED_STATE,
  withState,
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
      <StateSection value={prefs.state} onChange={(code) => onChange(withState(prefs, code))} />
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

// ── State ───────────────────────────────────────────────────────────────────

export function StateSection({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // A new key per opening remounts the selector, so every visit starts from
  // a blank search (the sheet's exit animation still plays, since the key
  // changes only on the way in).
  const [session, setSession] = useState(0);
  const { trigger, focusTrigger } = useTriggerFocus();
  const name = stateNameForCode(value);
  const close = useCallback(() => setOpen(false), []);
  const openSheet = () => {
    setSession((prior) => prior + 1);
    setOpen(true);
  };

  return (
    <SettingsSection title={STATE_SECTION_LABEL} description={STATE_SECTION_HELPER}>
      <SelectorTrigger
        ref={trigger}
        icon="map-pin"
        value={name}
        placeholder={STATE_PLACEHOLDER}
        action={name === null ? STATE_SELECT_LABEL : STATE_CHANGE_LABEL}
        accessibilityLabel={stateTriggerLabel(name)}
        accessibilityHint={STATE_TRIGGER_HINT}
        onPress={openSheet}
      />
      <StateSelector
        key={session}
        visible={open}
        value={value}
        onChange={onChange}
        onRequestClose={close}
        onClosed={focusTrigger}
      />
    </SettingsSection>
  );
}

/** The state sheet: the selector's contents on the shared surface. */
export function StateSelector({
  visible,
  value,
  onChange,
  onRequestClose,
  onClosed,
}: {
  visible: boolean;
  value: string | null;
  onChange: (code: string | null) => void;
  onRequestClose: () => void;
  onClosed?: () => void;
}) {
  return (
    <StateSelectorContent
      value={value}
      onChange={onChange}
      onDone={onRequestClose}
      autoFocus
      frame={(controls, list) => (
        <SelectorSheet
          visible={visible}
          title={STATE_SELECTOR_TITLE}
          action={{ label: CLOSE_LABEL, hint: CLOSE_HINT }}
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
 * radio rows — framed by the caller: the sheet on the screen, a plain view
 * in a gallery. The search is never an answer; only a row is.
 */
export function StateSelectorContent({
  value,
  onChange,
  onDone,
  autoFocus = false,
  initialQuery = '',
  frame = inline,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  /** Called after a row is chosen: the selection is complete. */
  onDone: () => void;
  autoFocus?: boolean;
  /** A search already typed — for galleries and tests; the sheet starts blank. */
  initialQuery?: string;
  frame?: (controls: React.ReactNode, list: React.ReactNode) => React.ReactElement;
}) {
  const [query, setQuery] = useState(initialQuery);
  const choices = useMemo(() => stateChoices(), []);
  const shown = filterStateChoices(choices, query);

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
        returnKeyType="done"
        autoFocus={autoFocus}
      />
      {value !== null ? (
        // Clears the choice and stays open, so another state can be chosen at once.
        <Button variant="secondary" label={STATE_CLEAR_LABEL} onPress={() => onChange(null)} />
      ) : null}
    </>
  );

  const list =
    shown.length === 0 ? (
      <Text variant="body-small" color="text/secondary" accessibilityLiveRegion="polite">
        {STATE_SEARCH_NO_MATCH}
      </Text>
    ) : (
      <ChoiceGroup label={STATE_SELECTOR_TITLE}>
        {shown.map((choice) => (
          <ChoiceRow
            key={choice.code}
            label={choice.name}
            checked={choice.code === value}
            onPress={() => {
              onChange(choice.code);
              onDone();
            }}
          />
        ))}
      </ChoiceGroup>
    );

  return frame(controls, list);
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
          />
        ))}
      </View>
    </SettingsSection>
  );
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
        />
      ))
    );

  return frame(controls, list);
}

/** A gallery's frame: the controls, the count, and the list in one column. */
function inline(controls: React.ReactNode, list: React.ReactNode): React.ReactElement {
  return (
    <View style={styles.inline}>
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
    return <StateMessage tone="loading" title={LOADING_STATE.title} body={LOADING_STATE.body} />;
  }
  if (status === 'failed') {
    return <StateMessage tone="error" title={FAILED_STATE.title} body={FAILED_STATE.body} />;
  }
  return <StateMessage title={UNSUPPORTED_STATE.title} body={UNSUPPORTED_STATE.body} />;
}

const styles = StyleSheet.create({
  rows: {
    gap: spacing[8],
  },
  inline: {
    gap: spacing[12],
  },
});
