/**
 * "Show what Lotly's server holds" (2026-10-13, privacy requests, proposal
 * §3.1): everything the server keeps for this installation, read through
 * `export_installation_data` and shown in plain language, with "Share as
 * file" writing the same JSON the operator emails for an email request.
 *
 * Reading changes nothing. An installation that has never been given an id
 * has nothing on the server, so the screen says so without asking (and
 * without minting an id just to look). The shared file goes to the cache
 * folder only for the share sheet and is deleted when the sheet closes:
 * it holds the allergen choices, so it does not linger.
 */

import { useCallback, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { layout, spacing } from '@/constants/design-tokens';
import { peekInstallationId } from '@/lib/installation-id';
import {
  buildExportDocument,
  exportFileName,
  parseServerDataExport,
  SERVER_DATA_EMPTY,
  SERVER_DATA_FAILURE,
  SERVER_DATA_INTRO,
  SERVER_DATA_LOADING_LABEL,
  SERVER_DATA_REDACTION_NOTE,
  SERVER_DATA_RETRY_LABEL,
  SERVER_DATA_SHARE_FAILURE,
  SERVER_DATA_SHARE_LABEL,
  serverDataSections,
  serverHoldsNothing,
  type ServerDataExport,
} from '@/lib/privacy-requests';
import { exportInstallationData } from '@/lib/push-api';

type View_ =
  | { status: 'loading' }
  | { status: 'nothing' }
  | { status: 'failed' }
  | { status: 'ready'; data: ServerDataExport };

export default function ServerDataScreen() {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View_>({ status: 'loading' });
  const [sharing, setSharing] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);

  // Reads and settles the view; the initial state is already `loading`, and
  // a retry sets it before calling, so nothing here sets state synchronously.
  const read = useCallback(async () => {
    try {
      const installationId = await peekInstallationId();
      if (!installationId) {
        setView({ status: 'nothing' });
        return;
      }
      const data = parseServerDataExport(await exportInstallationData(installationId));
      if (!data) throw new Error('Unexpected server data.');
      setView(serverHoldsNothing(data) ? { status: 'nothing' } : { status: 'ready', data });
    } catch {
      setView({ status: 'failed' });
    }
  }, []);

  // Read on every focus, as Notifications does: coming back after the reset
  // must show what the server holds now, not a copy from before it.
  useFocusEffect(
    useCallback(() => {
      void read();
    }, [read]),
  );

  const retry = () => {
    setView({ status: 'loading' });
    void read();
  };

  const share = async (data: ServerDataExport) => {
    setSharing(true);
    setShareFailed(false);
    const file = new File(Paths.cache, exportFileName(data));
    try {
      if (file.exists) file.delete();
      file.write(JSON.stringify(buildExportDocument(data), null, 2));
      await Share.share({ url: file.uri });
    } catch {
      setShareFailed(true);
    } finally {
      try {
        if (file.exists) file.delete();
      } catch {
        // The cache folder is the system's to clear; nothing else to do.
      }
      setSharing(false);
    }
  };

  return (
    <Surface background="background/page" style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing[24] + insets.bottom }]}>
        <Text variant="body-small" color="text/secondary">
          {SERVER_DATA_INTRO}
        </Text>

        {view.status === 'loading' ? (
          <Text variant="body-small" accessibilityLiveRegion="polite">
            {SERVER_DATA_LOADING_LABEL}…
          </Text>
        ) : null}

        {view.status === 'nothing' ? (
          <Text variant="body" accessibilityLiveRegion="polite">
            {SERVER_DATA_EMPTY}
          </Text>
        ) : null}

        {view.status === 'failed' ? (
          <View style={styles.group}>
            <Text variant="body-small" accessibilityLiveRegion="polite">
              {SERVER_DATA_FAILURE}
            </Text>
            <Button variant="secondary" label={SERVER_DATA_RETRY_LABEL} onPress={retry} />
          </View>
        ) : null}

        {view.status === 'ready' ? (
          <>
            {serverDataSections(view.data).map((section) => (
              <Surface key={section.title} radius={12} border="border/default" style={styles.panel}>
                <Text variant="body-small-bold" accessibilityRole="header">
                  {section.title}
                </Text>
                {section.lines.map((line, index) => (
                  <Text key={`${section.title}-${index}`} variant="body-small" selectable>
                    {line}
                  </Text>
                ))}
              </Surface>
            ))}
            <Text variant="caption" color="text/secondary">
              {SERVER_DATA_REDACTION_NOTE}
            </Text>
            <Button
              label={SERVER_DATA_SHARE_LABEL}
              busy={sharing}
              busyLabel={SERVER_DATA_SHARE_LABEL}
              disabled={sharing}
              onPress={() => void share(view.data)}
            />
            {shareFailed ? (
              <Text variant="body-small" accessibilityLiveRegion="polite">
                {SERVER_DATA_SHARE_FAILURE}
              </Text>
            ) : null}
          </>
        ) : null}
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
    gap: spacing[12],
  },
  group: {
    gap: spacing[12],
  },
  panel: {
    padding: spacing[16],
    gap: spacing[4],
  },
});
