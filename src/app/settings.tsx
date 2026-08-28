import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import {
  CONSUMER_ALLERGENS,
  stateNameForCode,
  SUPPORTED_STATE_CODES,
  type UserRecallPreferences,
} from '@/domain/preferences';
import { retailerById, searchRetailers } from '@/domain/retailer-catalog';
import { useTheme } from '@/hooks/use-theme';
import type { AlertStatus } from '@/lib/alert-status';
import { ALLERGEN_SECTION_HELPER, ALLERGEN_SECTION_LABEL } from '@/lib/personalization-copy';
import { loadPreferences, preferencesAvailable, savePreferences } from '@/lib/preferences-store';
import { disableRecallAlerts, enableRecallAlerts, getAlertStatus } from '@/lib/push-registration';

type ControlState =
  | { status: 'loading' }
  | { status: 'ready'; alerts: AlertStatus; busy: boolean; error: string | null };

/** Autosave feedback: silent when idle, honest when offline. */
type SaveState = 'idle' | 'saving' | 'saved' | 'local_only';

function Chip({
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
      <ThemedView type={selected ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
        <ThemedText type="small" style={selected ? styles.chipSelected : undefined}>
          {selected ? `✓ ${label}` : label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
      {children.toUpperCase()}
    </ThemedText>
  );
}

/** One home state, chosen from the same 52 jurisdictions geography uses. */
function StatePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const theme = useTheme();

  const entries = SUPPORTED_STATE_CODES.map((code) => ({
    code,
    name: stateNameForCode(code) as string,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const filtered =
    query.trim() === ''
      ? entries
      : entries.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase()));

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setQuery('');
          setOpen(true);
        }}>
        <ThemedView type="backgroundElement" style={styles.pickerRow}>
          <ThemedText>{stateNameForCode(value) ?? 'Choose your state'}</ThemedText>
          <ThemedText type="small" themeColor="link">
            {value ? 'Change' : 'Select'}
          </ThemedText>
        </ThemedView>
      </Pressable>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.pickerOpen}>
      <TextInput
        style={[styles.search, { color: theme.text }]}
        placeholder="Search states"
        placeholderTextColor={theme.textSecondary}
        value={query}
        onChangeText={setQuery}
        autoFocus
        accessibilityLabel="Search states"
      />
      <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
        {value !== null ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onChange(null);
              setOpen(false);
            }}>
            <ThemedText themeColor="link" style={styles.pickerItem}>
              Clear selection
            </ThemedText>
          </Pressable>
        ) : null}
        {filtered.map((entry) => (
          <Pressable
            key={entry.code}
            accessibilityRole="button"
            onPress={() => {
              onChange(entry.code);
              setOpen(false);
            }}>
            <ThemedText style={styles.pickerItem}>
              {entry.code === value ? `✓ ${entry.name}` : entry.name}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
        <ThemedText type="small" themeColor="link">
          Close
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

/** Searchable multi-select over the canonical retailer catalog. */
function RetailerPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const theme = useTheme();
  const results = searchRetailers(query).slice(0, query.trim() === '' ? 8 : 12);

  return (
    <View style={styles.retailerBlock}>
      {selected.length > 0 ? (
        <View style={styles.chipRow}>
          {selected.map((id) => (
            <Chip
              key={id}
              label={retailerById(id)?.name ?? id}
              selected
              onPress={() => onToggle(id)}
            />
          ))}
        </View>
      ) : null}
      <TextInput
        style={[styles.search, { color: theme.text }]}
        placeholder="Search stores (e.g. Costco)"
        placeholderTextColor={theme.textSecondary}
        value={query}
        onChangeText={setQuery}
        accessibilityLabel="Search stores"
      />
      <View style={styles.chipRow}>
        {results
          .filter((retailer) => !selected.includes(retailer.id))
          .map((retailer) => (
            <Chip
              key={retailer.id}
              label={retailer.name}
              selected={false}
              onPress={() => onToggle(retailer.id)}
            />
          ))}
      </View>
    </View>
  );
}

/**
 * Alerts + personalization. The permission prompt still fires only from the
 * "Enable recall alerts" button; choosing a state, allergens, or stores
 * never prompts for anything — preferences are plain app state, useful on
 * Home even while push alerts stay off.
 */
export default function SettingsScreen() {
  const [state, setState] = useState<ControlState>({ status: 'loading' });
  const [prefs, setPrefs] = useState<UserRecallPreferences | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const load = useCallback(async () => {
    const alerts = await getAlertStatus();
    setState({ status: 'ready', alerts, busy: false, error: null });
    if (preferencesAvailable()) setPrefs(await loadPreferences());
  }, []);

  useEffect(() => {
    // Read-only status check on mount; resolves after the async gap.
    void load();
  }, [load]);

  const run = useCallback(async (action: () => Promise<AlertStatus>) => {
    setState((prev) => (prev.status === 'ready' ? { ...prev, busy: true, error: null } : prev));
    try {
      const alerts = await action();
      setState({ status: 'ready', alerts, busy: false, error: null });
    } catch (error) {
      setState((prev) =>
        prev.status === 'ready'
          ? {
              ...prev,
              busy: false,
              error: error instanceof Error ? error.message : 'Something went wrong.',
            }
          : prev,
      );
    }
  }, []);

  // Autosave: local write always succeeds; a failed server sync is reported
  // honestly and retried on the next launch (never a lost preference).
  const update = useCallback((next: UserRecallPreferences) => {
    setPrefs(next);
    setSaveState('saving');
    void savePreferences(next).then(
      (result) => setSaveState(result.synced ? 'saved' : 'local_only'),
      () => setSaveState('local_only'),
    );
  }, []);

  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.content}>
          <ThemedText type="subtitle">Recall alerts</ThemedText>
          <ThemedText themeColor="textSecondary">
            Push alerts and personalization are available in the Recall mobile app.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <ThemedText type="subtitle">Recall alerts</ThemedText>
          <ThemedText themeColor="textSecondary">
            Get a push notification when a new recall is announced or an existing one changes in a
            way that matters — nothing else, no marketing.
          </ThemedText>

          {state.status === 'loading' ? (
            <ThemedText themeColor="textSecondary">Checking status…</ThemedText>
          ) : (
            <>
              {state.alerts === 'enabled' ? (
                <>
                  <ThemedText>Recall alerts are on for this device.</ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    disabled={state.busy}
                    onPress={() => run(disableRecallAlerts)}>
                    <ThemedView type="backgroundElement" style={styles.button}>
                      <ThemedText>{state.busy ? 'Working…' : 'Turn off alerts'}</ThemedText>
                    </ThemedView>
                  </Pressable>
                </>
              ) : state.alerts === 'denied' ? (
                <>
                  <ThemedText>
                    Notifications for Recall are turned off in your system settings.
                  </ThemedText>
                  <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}>
                    <ThemedView type="backgroundSelected" style={styles.button}>
                      <ThemedText style={styles.buttonEmphasis}>Open system settings</ThemedText>
                    </ThemedView>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={state.busy}
                  onPress={() => run(enableRecallAlerts)}>
                  <ThemedView type="backgroundSelected" style={styles.button}>
                    <ThemedText style={styles.buttonEmphasis}>
                      {state.busy ? 'Working…' : 'Enable recall alerts'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              )}
              {state.error ? (
                <ThemedText themeColor="textSecondary">{state.error}</ThemedText>
              ) : null}
            </>
          )}

          {prefs !== null ? (
            <>
              <SectionLabel>Personalization</SectionLabel>
              <ThemedText themeColor="textSecondary">
                Powers the “Affects me” view on Home — and, once alerts are on, limits notifications
                to recalls relevant to you. All recalls always stay available.
              </ThemedText>

              <SectionLabel>Your state</SectionLabel>
              <StatePicker
                value={prefs.state}
                onChange={(code) => update({ ...prefs, state: code })}
              />

              {/* Household-aware copy (C5.2B), owned by lib/personalization-copy
                  so the exact wording is a tested contract rather than a string
                  that can drift. Copy only: no names, profiles, or new fields. */}
              <SectionLabel>{ALLERGEN_SECTION_LABEL}</SectionLabel>
              <ThemedText type="small" themeColor="textSecondary">
                {ALLERGEN_SECTION_HELPER}
              </ThemedText>
              <View style={styles.chipRow}>
                {CONSUMER_ALLERGENS.map((option) => {
                  const selected = prefs.allergens.includes(option.token);
                  return (
                    <Chip
                      key={option.token}
                      label={option.label}
                      selected={selected}
                      onPress={() =>
                        update({
                          ...prefs,
                          allergens: selected
                            ? prefs.allergens.filter((t) => t !== option.token)
                            : [...prefs.allergens, option.token],
                        })
                      }
                    />
                  );
                })}
              </View>

              <SectionLabel>Stores you shop at</SectionLabel>
              <ThemedText type="small" themeColor="textSecondary">
                Recalls that name these stores get flagged. Notices don’t always say where a product
                was sold, so no flag never means “not sold there.”
              </ThemedText>
              <RetailerPicker
                selected={prefs.retailers}
                onToggle={(id) =>
                  update({
                    ...prefs,
                    retailers: prefs.retailers.includes(id)
                      ? prefs.retailers.filter((r) => r !== id)
                      : [...prefs.retailers, id],
                  })
                }
              />

              {saveState !== 'idle' ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {saveState === 'saving'
                    ? 'Saving…'
                    : saveState === 'saved'
                      ? 'Saved.'
                      : 'Saved on this device — will sync when back online.'}
                </ThemedText>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </ThemedView>
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
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.medium,
  },
  buttonEmphasis: {
    fontWeight: '600',
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radii.small,
  },
  chipSelected: {
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Radii.medium,
  },
  pickerOpen: {
    padding: Spacing.two,
    borderRadius: Radii.medium,
    gap: Spacing.one,
  },
  pickerList: {
    maxHeight: 280,
  },
  pickerItem: {
    paddingVertical: Spacing.one,
  },
  search: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  retailerBlock: {
    gap: Spacing.one,
  },
});
