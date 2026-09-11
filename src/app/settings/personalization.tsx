/**
 * Personalization (P2A) — state, allergens to watch, and stores.
 *
 * Split out of the former combined "Alerts" screen so Profile can offer
 * Personalization and Notifications as separate destinations. The controls,
 * the copy, the autosave behavior, and the preference store are UNCHANGED:
 * this screen owns the same `UserRecallPreferences` fields it always did, in
 * the same order, through the same `savePreferences` path. Nothing about
 * matching, relevance, or Affects Me moved with it.
 *
 * Choosing a state, an allergen, or a store never prompts for a permission —
 * preferences are plain app state, useful on Feed even while push alerts stay
 * off. The one permission prompt in the app lives on the Notifications screen,
 * behind its explicit button.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

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
import { ALLERGEN_SECTION_HELPER, ALLERGEN_SECTION_LABEL } from '@/lib/personalization-copy';
import { loadPreferences, preferencesAvailable, savePreferences } from '@/lib/preferences-store';

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

export default function PersonalizationScreen() {
  const [prefs, setPrefs] = useState<UserRecallPreferences | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useFocusEffect(
    useCallback(() => {
      // Reloaded on every focus (not just mount): after the data reset ran on
      // the Privacy & Data Controls screen, coming back here must show the
      // cleared state, not a stale in-memory copy.
      if (preferencesAvailable()) void loadPreferences().then(setPrefs);
    }, []),
  );

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
          <ThemedText type="subtitle">Personalization</ThemedText>
          <ThemedText themeColor="textSecondary">
            Personalization is available in the Recall mobile app.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <ThemedText themeColor="textSecondary">
            Powers the “Affects me” view on Feed — and, once alerts are on, limits notifications to
            recalls relevant to you. All recalls always stay available.
          </ThemedText>

          {prefs !== null ? (
            <>
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
