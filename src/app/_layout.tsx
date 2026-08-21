import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Recall Alerts' }} />
        <Stack.Screen name="recall/[id]" options={{ title: 'Recall Details' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
