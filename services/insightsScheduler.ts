import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { AppSettings, InsightSlot, InsightsReport } from '../types';
import { generateInsightsReport, toDateKey } from '../engine/correlationEngine';
import { loadAllUserData, saveInsightsReports } from './storage';
import { STARTER_VARIABLES } from '../constants/starterVariables';
import { buildDemoDataset } from '../data/demoDataset';

export const BACKGROUND_INSIGHTS_TASK = 'FLARELENS_SCHEDULED_INSIGHTS_TASK';

export function parseTimeHHMM(hhmm: string, fallbackHour: number): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return { hour: fallbackHour, minute: 0 };
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return { hour, minute };
}

export function formatTime12h(hhmm: string): string {
  const { hour, minute } = parseTimeHHMM(hhmm, 9);
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

export interface ScheduledSlotDescriptor {
  slot: Exclude<InsightSlot, 'manual'>;
  dateKey: string;
  scheduledAt: Date;
  label: string;
}

/**
 * Determines the most recent scheduled analysis boundary (e.g., today 9:00 AM or 9:00 PM,
 * or yesterday 9:00 PM if it is currently before 9:00 AM) so that the user's insights
 * are always computed and ready at the start and end of their day.
 */
export function getMostRecentScheduledSlot(
  settings: AppSettings,
  now: Date = new Date()
): ScheduledSlotDescriptor {
  const morning = parseTimeHHMM(settings.morningInsightTime, 9);
  const evening = parseTimeHHMM(settings.eveningInsightTime, 21);

  const todayMorning = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    morning.hour,
    morning.minute,
    0
  );
  const todayEvening = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    evening.hour,
    evening.minute,
    0
  );

  if (now.getTime() >= todayEvening.getTime()) {
    return {
      slot: 'evening',
      dateKey: toDateKey(now),
      scheduledAt: todayEvening,
      label: `${formatTime12h(settings.eveningInsightTime)} Evening Digest`,
    };
  }

  if (now.getTime() >= todayMorning.getTime()) {
    return {
      slot: 'morning',
      dateKey: toDateKey(now),
      scheduledAt: todayMorning,
      label: `${formatTime12h(settings.morningInsightTime)} Morning Brief`,
    };
  }

  const yesterdayEvening = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    evening.hour,
    evening.minute,
    0
  );
  return {
    slot: 'evening',
    dateKey: toDateKey(yesterdayEvening),
    scheduledAt: yesterdayEvening,
    label: `${formatTime12h(settings.eveningInsightTime)} Evening Digest`,
  };
}

export function getNextScheduledRunInfo(
  settings: AppSettings,
  now: Date = new Date()
): { slot: 'morning' | 'evening'; scheduledAt: Date; label: string; countdownLabel: string } {
  const morning = parseTimeHHMM(settings.morningInsightTime, 9);
  const evening = parseTimeHHMM(settings.eveningInsightTime, 21);

  const candidates = [
    {
      slot: 'morning' as const,
      scheduledAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), morning.hour, morning.minute, 0),
      label: `${formatTime12h(settings.morningInsightTime)} Morning Brief`,
    },
    {
      slot: 'evening' as const,
      scheduledAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), evening.hour, evening.minute, 0),
      label: `${formatTime12h(settings.eveningInsightTime)} Evening Digest`,
    },
    {
      slot: 'morning' as const,
      scheduledAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, morning.hour, morning.minute, 0),
      label: `${formatTime12h(settings.morningInsightTime)} Morning Brief`,
    },
  ];

  const next = candidates.find((c) => c.scheduledAt.getTime() > now.getTime()) ?? candidates[2];
  const diffMin = Math.max(1, Math.round((next.scheduledAt.getTime() - now.getTime()) / 60000));
  const hrs = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  const countdownLabel = hrs > 0 ? `in ${hrs}h ${mins}m` : `in ${mins}m`;

  return { ...next, countdownLabel };
}

export function hasReportForSlot(
  reports: InsightsReport[],
  descriptor: ScheduledSlotDescriptor
): boolean {
  return reports.some(
    (r) => r.dateKey === descriptor.dateKey && r.slot === descriptor.slot
  );
}

/**
 * Schedules daily repeating local notifications at the user's configured
 * Morning (default 9:00 AM) and Evening (default 9:00 PM) insight times.
 */
export async function syncScheduledInsightNotifications(settings: AppSettings): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!settings.notificationsEnabled) return true;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      finalStatus = req.status;
    }
    if (finalStatus !== 'granted') return false;

    const morning = parseTimeHHMM(settings.morningInsightTime, 9);
    const evening = parseTimeHHMM(settings.eveningInsightTime, 21);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Morning Eczema Insights Ready',
        body: 'Your 9:00 AM trigger correlation brief & active flare-risk watchlist are ready.',
        data: { route: '/(tabs)/insights', slot: 'morning' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: morning.hour,
        minute: morning.minute,
      },
    });

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Evening Eczema Digest Ready',
        body: 'Review today’s exposures, food ingredients, and updated exposure-to-flare graphs.',
        data: { route: '/(tabs)/insights', slot: 'evening' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: evening.hour,
        minute: evening.minute,
      },
    });

    return true;
  } catch {
    return false;
  }
}

// Define native background task safely (no-op on web)
if (Platform.OS !== 'web') {
  try {
    TaskManager.defineTask(BACKGROUND_INSIGHTS_TASK, async () => {
      try {
        const persisted = await loadAllUserData();
        const now = new Date();
        const slotDesc = getMostRecentScheduledSlot(persisted.settings, now);

        if (hasReportForSlot(persisted.insightsReports, slotDesc)) {
          return BackgroundFetch.BackgroundFetchResult.NoData;
        }

        const activeData = persisted.settings.useDemoData
          ? buildDemoDataset(now)
          : {
              eczemaLogs: persisted.eczemaLogs,
              measurements: persisted.measurements,
              customVariables: persisted.customVariables,
            };

        const report = generateInsightsReport({
          eczemaLogs: activeData.eczemaLogs,
          measurements: activeData.measurements,
          variableDefinitions: [...STARTER_VARIABLES, ...activeData.customVariables],
          slot: slotDesc.slot,
          scheduledForLabel: slotDesc.label,
          now,
        });

        await saveInsightsReports([report, ...persisted.insightsReports]);
        return BackgroundFetch.BackgroundFetchResult.NewData;
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });
  } catch {
    // Ignore duplicate registration during hot reload
  }
}

export async function registerBackgroundInsightsTask(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_INSIGHTS_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_INSIGHTS_TASK, {
        minimumInterval: 60 * 30, // Check every 30 min so 9am/9pm snapshots run promptly
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
    return true;
  } catch {
    return false;
  }
}
