/**
 * The consent question as a sheet (2026-10-13): the onboarding Allergens
 * step's Continue and Edit preferences' Save open it when allergens are
 * chosen and no decision is recorded. The same transparent-Modal pattern as
 * the choosers (allergen-chooser-sheet.tsx). Closing without choosing
 * records nothing and stays where the shopper was.
 */

import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AllergenConsentChoice } from '@/components/allergen-consent/allergen-consent-choice';
import { Icon } from '@/components/ui/icon';
import { color, hitTarget, layout, radius, spacing } from '@/constants/design-tokens';
import { useSheetMotion } from '@/hooks/use-sheet-motion';
import { SEARCH_CLOSE_LABEL } from '@/lib/onboarding-copy';
import { SHEET_BACKDROP_OPACITY } from '@/lib/retailer-grid';
import { chooserTop } from '@/lib/states-presentation';

export function AllergenConsentSheet({
  visible,
  onlyChoice,
  busy,
  onGrant,
  onDecline,
  onClose,
}: {
  visible: boolean;
  onlyChoice: boolean;
  busy?: boolean;
  onGrant: () => void;
  onDecline: () => void;
  /** Close, the backdrop or Android back: no decision. */
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const top = chooserTop(insets.top);
  const { shown, progress, onShow, onDismiss } = useSheetMotion(visible);

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onShow={onShow}
      onDismiss={onDismiss}
      statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.backdrop,
            {
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, SHEET_BACKDROP_OPACITY],
              }),
            },
          ]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              top,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [height - top, 0],
                  }),
                },
              ],
            },
          ]}>
          {shown ? (
            <View style={styles.contents}>
              <View style={styles.header}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={SEARCH_CLOSE_LABEL}
                  onPress={onClose}
                  style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
                  <Icon name="x" size={20} color="icon/primary" />
                </Pressable>
              </View>
              <ScrollView
                style={styles.body}
                contentContainerStyle={[
                  styles.bodyContent,
                  { paddingBottom: insets.bottom + spacing[24] },
                ]}>
                <AllergenConsentChoice
                  onlyChoice={onlyChoice}
                  busy={busy}
                  onGrant={onGrant}
                  onDecline={onDecline}
                />
              </ScrollView>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color['text/primary'],
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color['background/page'],
    borderTopLeftRadius: radius[16],
    borderTopRightRadius: radius[16],
  },
  contents: {
    flex: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: layout.pageMargin - spacing[8],
    paddingTop: spacing[8],
  },
  close: {
    width: hitTarget.minimum,
    height: hitTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: layout.pageMargin,
  },
});
