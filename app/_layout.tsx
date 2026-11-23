import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from '../context/AppContext';
import { COLORS } from '../constants/theme';

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: COLORS.surface },
          headerTintColor: COLORS.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: COLORS.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="add-variable"
          options={{
            presentation: 'modal',
            title: 'Add Custom Variable',
          }}
        />
        <Stack.Screen
          name="variable/[id]"
          options={{
            title: 'Variable Correlation',
            headerBackTitle: 'Back',
          }}
        />
      </Stack>
    </AppProvider>
  );
}
