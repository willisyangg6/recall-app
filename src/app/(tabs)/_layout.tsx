/**
 * The three-destination bottom navigation (P2A): Feed, Saved, Profile — in
 * that order, with Feed initial.
 *
 * `(tabs)` is a ROUTE GROUP, so it contributes nothing to any URL: Feed stays
 * `/` and Profile stays `/profile`, exactly the paths they had before the tab
 * bar existed. Nothing else moved into the group, which is what keeps the bar
 * honest — Recall Details, the shopper-report questionnaire, the settings
 * pages, and the trust documents all live at the root stack, so they push
 * OVER the tabs and can never become a fourth destination. A route cannot
 * become a tab here by accident; it has to be moved into this folder.
 *
 * Search and Affects Me are deliberately not destinations. Both are controls
 * WITHIN Feed (the search field and the All / Affects me chips), because
 * they narrow one feed rather than being separate places.
 *
 * ## Appearance (P2B1)
 *
 * Figma `nav bar` (163:259), adapted to the founder's decision that the
 * destinations are visibly labelled: each tab is its 24pt glyph — the
 * design's own exported home, bookmark and user icons — over its `Feed` /
 * `Saved` / `Profile` label in caption type, on a white surface 72pt tall
 * above the home indicator, brand navy when selected and secondary grey
 * otherwise, with `border/subtle` as the hairline above. Selection is also
 * carried by react-navigation's `selected` accessibility state, never by
 * colour alone, and every tab item is a full-height 44pt-or-larger target.
 *
 * The three destinations' own headers are styled here too (the warm page
 * colour, no shadow, the heading type), because a screen's header is
 * navigation chrome the navigator owns — one `screenHeader` shared by Feed,
 * Saved and (from P2B5) Profile, so the three titles can never drift apart.
 */

import { Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/icon';
import { color, hitTarget, layout, spacing, textStyle } from '@/constants/design-tokens';

/** A tab's glyph in the selected or unselected icon colour. */
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return <Icon name={name} size={24} color={focused ? 'icon/primary' : 'icon/secondary'} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // Re-read on every text-size change, so the header below resizes when the
  // reader changes their setting rather than only at the next cold launch.
  const { fontScale } = useWindowDimensions();
  // The navigator's title style accepts only family, size and weight, so the
  // heading token is picked apart rather than spread. `lineHeight` is
  // deliberately NOT passed to the title: React Native does not scale a fixed
  // lineHeight with Dynamic Type, so handing one over would clip the glyphs
  // inside their own line box. It is used below for the bar's height instead.
  const { fontFamily, fontSize, fontWeight, lineHeight } = textStyle('heading-3');

  /**
   * How tall the bar has to be for the title to fit at the reader's text size
   * (P3C1.5).
   *
   * The header title honours Dynamic Type — DESIGN.md requires 200% text
   * without clipping, and there is no `maxFontSizeMultiplier` anywhere — but
   * the bar itself was a flat 44pt, so at the accessibility sizes the title's
   * line box was taller than the bar that contained it and Feed and Saved
   * both clipped their titles vertically.
   *
   * The bar grows with the text instead of the text shrinking to the bar:
   * `heading-3`'s own line box, scaled, plus the bar's breathing room above
   * and below, and never less than the platform's 44pt at ordinary sizes.
   * It is expressed as `minHeight` rather than `height` because
   * `getDefaultHeaderHeight` already accounts for the status bar, notch and
   * landscape; a minimum raises that floor when the text needs it and leaves
   * the platform's own answer alone when it does not. The inset is added
   * because the value covers the whole header, status bar included.
   */
  // `TextStyle` types both as optional; the token always carries them, and a
  // 0 here would simply leave the platform's 44pt floor in charge.
  const titleLineBox = Math.ceil(Number(lineHeight ?? fontSize ?? 0) * fontScale);
  const headerMinHeight =
    insets.top + Math.max(layout.navHeaderHeight, titleLineBox + spacing[8] * 2);

  /** A restyled screen's header: the warm page, no shadow, the heading type. */
  const screenHeader = {
    headerStyle: { backgroundColor: color['background/page'], minHeight: headerMinHeight },
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily, fontSize, fontWeight, color: color['text/primary'] },
  };

  return (
    <Tabs
      screenOptions={{
        tabBarLabelStyle: textStyle('caption'),
        tabBarLabelPosition: 'below-icon',
        tabBarActiveTintColor: color['action/primary'],
        tabBarInactiveTintColor: color['text/secondary'],
        tabBarStyle: {
          backgroundColor: color['background/surface'],
          borderTopColor: color['border/subtle'],
          // A numeric height replaces the navigator's own inset handling, so
          // the home indicator's inset is added back here.
          height: layout.bottomNavHeight + insets.bottom,
          paddingTop: spacing[8],
        },
        tabBarItemStyle: {
          minHeight: hitTarget.minimum,
          gap: spacing[4],
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarLabel: 'Feed',
          tabBarAccessibilityLabel: 'Feed',
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
          ...screenHeader,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarLabel: 'Saved',
          tabBarAccessibilityLabel: 'Saved',
          tabBarIcon: ({ focused }) => <TabIcon name="bookmark" focused={focused} />,
          ...screenHeader,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
          tabBarAccessibilityLabel: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon name="user" focused={focused} />,
          ...screenHeader,
        }}
      />
    </Tabs>
  );
}
