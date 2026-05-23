// Local notifications helper. Web fallback: no-op.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

let configured = false;

async function configure() {
  if (configured || Platform.OS === "web") {
    configured = true;
    return;
  }
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  configured = true;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  await configure();
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function scheduleCompletionNotification(
  experimentId: string,
  batch: string,
  endTimeMs: number,
): Promise<string | null> {
  if (Platform.OS === "web") return null;
  await configure();
  const granted = await requestNotificationPermission();
  if (!granted) return null;
  const seconds = Math.max(1, Math.floor((endTimeMs - Date.now()) / 1000));
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Ageing complete",
        body: `${batch}: time to remove the sample.`,
        data: { experimentId },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
    return id;
  } catch (e) {
    console.warn("scheduleCompletionNotification failed", e);
    return null;
  }
}

export async function cancelNotification(notificationId: string | null | undefined) {
  if (!notificationId || Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (e) {
    console.warn("cancelNotification failed", e);
  }
}
