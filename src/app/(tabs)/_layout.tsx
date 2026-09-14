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
 * The Feed's own header is styled here too (the warm page colour, no
 * shadow, the heading type), because a screen's header is navigation chrome
 * the navigator owns. Saved and Profile keep the platform header until their
 * own milestones.
 */

import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/icon';
import { color, hitTarget, layout, spacing, textStyle } from '@/constants/design-tokens';

/** A tab's glyph in the selected or unselected icon colour. */
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return <Icon name={name} size={24} color={focused ? 'icon/primary' : 'icon/secondary'} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // The navigator's title style accepts only family, size and weight, so the
  // heading token is picked apart rather than spread.
  const { fontFamily, fontSize, fontWeight } = textStyle('heading-3');

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
          headerStyle: { backgroundColor: color['background/page'] },
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily, fontSize, fontWeight, color: color['text/primary'] },
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarLabel: 'Saved',
          tabBarAccessibilityLabel: 'Saved',
          tabBarIcon: ({ focused }) => <TabIcon name="bookmark" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
          tabBarAccessibilityLabel: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon name="user" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
