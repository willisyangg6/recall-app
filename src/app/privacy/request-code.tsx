/**
 * "Get a request code" (2026-10-13, privacy requests, proposal §3.2): a
 * one-time code for ONE email request, a copy of the data or its deletion,
 * created by the server with this installation's own credential.
 *
 * The code is verification material, handled that way here: it lives only
 * in this screen's state, is shown once, and is never written to storage or
 * a log. Leaving the screen drops it; the server keeps only its SHA-256, so
 * not even Lotly can show it again. "Email the code" opens a ready message
 * to the support address. Nothing is created until the person chooses a
 * purpose and taps Create code; an installation that has never been given an
 * id has nothing to request, and the screen says so without minting one.
 */

import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ChoiceGroup, ChoiceRow } from '@/components/ui/choice-row';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { layout, spacing } from '@/constants/design-tokens';
import { peekInstallationId } from '@/lib/installation-id';
import {
  formatRequestCode,
  REQUEST_CODE_CREATE_LABEL,
  REQUEST_CODE_CREATING_LABEL,
  REQUEST_CODE_EMAIL_LABEL,
  REQUEST_CODE_FACTS,
  REQUEST_CODE_FAILURE,
  REQUEST_CODE_INTRO,
  REQUEST_CODE_NOTHING_HELD,
  REQUEST_CODE_NO_MAIL_APP,
  REQUEST_CODE_PURPOSE_QUESTION,
  REQUEST_PURPOSE_LABEL,
  requestCodeShownCopy,
  requestEmailUrl,
  type RequestPurpose,
} from '@/lib/privacy-requests';
import { createPrivacyRequestCode } from '@/lib/push-api';

type Outcome =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'nothing' }
  | { status: 'failed' }
  | { status: 'created'; code: string; purpose: RequestPurpose; expiresAt: string };

const PURPOSES: readonly RequestPurpose[] = ['access', 'delete'];

export default function RequestCodeScreen() {
  const insets = useSafeAreaInsets();
  const [purpose, setPurpose] = useState<RequestPurpose | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ status: 'idle' });
  const [noMailApp, setNoMailApp] = useState(false);

  // No mail account on the device (or no Mail app) rejects the URL; say so,
  // the code stays on screen to copy.
  const email = (url: string) => {
    setNoMailApp(false);
    Linking.openURL(url).catch(() => setNoMailApp(true));
  };

  const create = async () => {
    if (!purpose || outcome.status === 'creating') return;
    setOutcome({ status: 'creating' });
    try {
      const installationId = await peekInstallationId();
      if (!installationId) {
        setOutcome({ status: 'nothing' });
        return;
      }
      const created = await createPrivacyRequestCode(installationId, purpose);
      setOutcome({ status: 'created', ...created });
    } catch {
      setOutcome({ status: 'failed' });
    }
  };

  return (
    <Surface background="background/page" style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}>
        <Text variant="body-small" color="text/secondary">
          {REQUEST_CODE_INTRO}
        </Text>

        <ChoiceGroup label={REQUEST_CODE_PURPOSE_QUESTION}>
          <Text variant="body-small-bold">{REQUEST_CODE_PURPOSE_QUESTION}</Text>
          {PURPOSES.map((option) => (
            <ChoiceRow
              key={option}
              label={REQUEST_PURPOSE_LABEL[option]}
              checked={purpose === option}
              onPress={() => {
                setPurpose(option);
                // A code belongs to one purpose: changing the answer hides the
                // one on screen rather than leaving it beside the wrong choice.
                setOutcome((prior) => (prior.status === 'creating' ? prior : { status: 'idle' }));
              }}
            />
          ))}
        </ChoiceGroup>

        <Button
          label={REQUEST_CODE_CREATE_LABEL}
          busy={outcome.status === 'creating'}
          busyLabel={REQUEST_CODE_CREATING_LABEL}
          disabled={purpose === null || outcome.status === 'creating'}
          onPress={() => void create()}
        />

        {outcome.status === 'failed' ? (
          <Text variant="body-small" accessibilityLiveRegion="polite">
            {REQUEST_CODE_FAILURE}
          </Text>
        ) : null}

        {outcome.status === 'nothing' ? (
          <Text variant="body-small" accessibilityLiveRegion="polite">
            {REQUEST_CODE_NOTHING_HELD}
          </Text>
        ) : null}

        {outcome.status === 'created' ? (
          <Surface radius={12} border="border/strong" style={styles.panel}>
            <Text variant="body-small" accessibilityLiveRegion="polite">
              {requestCodeShownCopy(outcome.purpose, outcome.expiresAt)}
            </Text>
            <Text
              variant="heading-2"
              selectable
              style={styles.code}
              accessibilityLabel={formatRequestCode(outcome.code).split('').join(' ')}>
              {formatRequestCode(outcome.code)}
            </Text>
            <Button
              variant="secondary"
              label={REQUEST_CODE_EMAIL_LABEL}
              onPress={() => email(requestEmailUrl(outcome.purpose, outcome.code))}
            />
            {noMailApp ? (
              <Text variant="body-small" accessibilityLiveRegion="polite">
                {REQUEST_CODE_NO_MAIL_APP}
              </Text>
            ) : null}
          </Surface>
        ) : null}

        <View style={styles.facts}>
          {REQUEST_CODE_FACTS.map((fact) => (
            <Text key={fact} variant="caption" color="text/secondary">
              {`•  ${fact}`}
            </Text>
          ))}
        </View>
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
  content: {
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: layout.pageMargin,
    paddingTop: spacing[16],
    gap: spacing[16],
  },
  panel: {
    padding: spacing[16],
    gap: spacing[12],
  },
  code: {
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  facts: {
    gap: spacing[8],
  },
});
