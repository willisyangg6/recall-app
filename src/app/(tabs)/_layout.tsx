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
 * WITHIN Feed (the search field and the All / Affects me segmented control),
 * because they narrow one feed rather than being separate places.
 *
 * ## Appearance (P2B0 follow-up)
 *
 * The three destinations are visibly labelled `Feed`, `Saved`, `Profile`
 * (founder decision, 2026-09-14), in the design system's caption type on a
 * white surface: brand navy for the selected tab, secondary grey otherwise,
 * with `border/subtle` as the hairline above. Selection is also carried by
 * react-navigation's `selected` accessibility state, never by colour alone.
 *
 * Icons are still absent: no icon set is installed, and choosing one is a
 * dependency decision for the Feed milestone (DESIGN.md, "Bottom
 * Navigation"). `tabBarIconStyle: display none` reclaims the space
 * react-navigation reserves for the missing icon so the labels sit centred.
 */

import { Tabs } from 'expo-router/js-tabs';

import { color, textStyle } from '@/constants/design-tokens';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: textStyle('caption'),
        tabBarActiveTintColor: color['action/primary'],
        tabBarInactiveTintColor: color['text/secondary'],
        tabBarStyle: {
          backgroundColor: color['background/surface'],
          borderTopColor: color['border/subtle'],
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarLabel: 'Feed',
          tabBarAccessibilityLabel: 'Feed',
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarLabel: 'Saved',
          tabBarAccessibilityLabel: 'Saved',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
          tabBarAccessibilityLabel: 'Profile',
        }}
      />
    </Tabs>
  );
}
