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
 * ## Provisional appearance
 *
 * Labels only, no icons: the app installs no icon set, and adding one for
 * this milestone would be a dependency ahead of the design system rather
 * than a product need. `tabBarIconStyle: display none` reclaims the space
 * react-navigation reserves for the missing icon so the labels sit centred.
 * Dimensions, colors, and iconography are the design-system pass's to
 * decide; nothing here encodes a final visual decision.
 */

import { Tabs } from 'expo-router/js-tabs';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 13 },
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
