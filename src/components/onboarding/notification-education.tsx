/**
 * Screen 7, Notification education (P2B7X.1): shown once, after the first
 * verified purchase or restore, and never before.
 *
 * The small success state (`Subscription active`, as written, on the lime
 * surface — the one place lime means success), the headline and body, a small
 * preview of what a Lotly alert looks like (a white card: the app name,
 * the title and the body the brief fixes), the primary `Turn on
 * notifications`, the secondary `Not now`, and the reassurance line.
 *
 * ## The permission rule
 *
 * Only the primary action may invoke Apple's prompt, and it does so
 * through the route's `onEnable` — the same `enableRecallAlerts` path the
 * Notifications screen uses, which prompts only when the system can still
 * ask. `Not now` calls `onSkip` and nothing else: no read of the permission,
 * no request, no registration. Both routes end on the Feed; the route
 * decides that, this component only reports the choice. While the enable
 * runs, both actions are inert and the primary shows its progress word.
 */

import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { color, layout, radius, spacing } from '@/constants/design-tokens';
import {
  EDUCATION_BODY,
  EDUCATION_BUSY,
  EDUCATION_CTA,
  EDUCATION_CTA_HINT,
  EDUCATION_HEADLINE,
  EDUCATION_PREVIEW_APP,
  EDUCATION_PREVIEW_BODY,
  EDUCATION_PREVIEW_LABEL,
  EDUCATION_PREVIEW_TITLE,
  EDUCATION_REASSURANCE,
  EDUCATION_SECONDARY,
  EDUCATION_SECONDARY_HINT,
  EDUCATION_SUCCESS,
} from '@/lib/onboarding-copy';
import { OnboardingFrame } from './onboarding-frame';

export function NotificationEducation({
  busy,
  onEnable,
  onSkip,
}: {
  /** The enable is in flight (the system prompt may be up). */
  busy: boolean;
  /** The ONE path to the system permission prompt on this screen. */
  onEnable: () => void;
  /** Proceeds without asking anything. */
  onSkip: () => void;
}) {
  return (
    <OnboardingFrame
      headline={EDUCATION_HEADLINE}
      body={EDUCATION_BODY}
      lead={
        <View
          style={styles.success}
          accessible
          accessibilityRole="text"
          accessibilityLabel={EDUCATION_SUCCESS}>
          <Text variant="body-small-bold" style={styles.successText}>
            {EDUCATION_SUCCESS}
          </Text>
        </View>
      }
      footer={
        <>
          <Button
            label={EDUCATION_CTA}
            accessibilityHint={EDUCATION_CTA_HINT}
            busy={busy}
            busyLabel={EDUCATION_BUSY}
            onPress={onEnable}
          />
          <Button
            variant="secondary"
            label={EDUCATION_SECONDARY}
            accessibilityHint={EDUCATION_SECONDARY_HINT}
            disabled={busy}
            onPress={onSkip}
          />
          <Text variant="caption" color="text/secondary" style={styles.reassurance}>
            {EDUCATION_REASSURANCE}
          </Text>
        </>
      }>
      <NotificationPreview />
    </OnboardingFrame>
  );
}

/** What an alert looks like: the app name, the title, the body. */
export function NotificationPreview() {
  return (
    <View style={styles.previewBlock}>
      <Text variant="caption" color="text/secondary">
        {EDUCATION_PREVIEW_LABEL}
      </Text>
      <Surface
        radius={16}
        border="border/subtle"
        elevation="card"
        style={styles.preview}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${EDUCATION_PREVIEW_APP}. ${EDUCATION_PREVIEW_TITLE}. ${EDUCATION_PREVIEW_BODY}`}>
        <View style={styles.previewHeader}>
          <View style={styles.previewIcon} />
          <Text variant="caption" color="text/secondary">
            {EDUCATION_PREVIEW_APP}
          </Text>
        </View>
        <Text variant="body-small-bold">{EDUCATION_PREVIEW_TITLE}</Text>
        <Text variant="body-small">{EDUCATION_PREVIEW_BODY}</Text>
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  // The success mark: the relevance/success lime, the compact-label geometry.
  success: {
    alignSelf: 'flex-start',
    minHeight: layout.riskLabelHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
    borderRadius: radius[4],
    borderWidth: 1,
    backgroundColor: color['background/accent'],
    borderColor: color['action/accent'],
  },
  successText: {
    color: color['text/primary'],
  },
  previewBlock: {
    gap: spacing[8],
  },
  preview: {
    padding: spacing[12],
    gap: spacing[4],
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
  },
  // A small brand square standing for the app icon, which is not final.
  previewIcon: {
    width: 16,
    height: 16,
    borderRadius: radius[4],
    backgroundColor: color['background/brand'],
  },
  reassurance: {
    textAlign: 'center',
  },
});
