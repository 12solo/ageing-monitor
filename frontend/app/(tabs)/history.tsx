import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, Experiment } from "@/src/api/client";
import { colors, fonts, radii, spacing } from "@/src/theme";

function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await api.listExperiments();
      // Only show removed (history)
      setItems(all.filter((e) => e.removed_at));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleDelete = (item: Experiment) => {
    Alert.alert(
      "Delete record?",
      `${item.batch} will be removed from history. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteExperiment(item.id);
              await load();
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Failed to delete");
            }
          },
        },
      ],
    );
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await api.exportCsv();
      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ageing_monitor_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
        if (!dir) throw new Error("No writable directory available");
        const fileUri = `${dir}ageing_monitor_${Date.now()}.csv`;
        await FileSystem.writeAsStringAsync(fileUri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "text/csv",
            dialogTitle: "Export Ageing Monitor CSV",
            UTI: "public.comma-separated-values-text",
          });
        } else {
          Alert.alert("Saved", `CSV written to ${fileUri}`);
        }
      }
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Unknown error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.toolbar}>
        <View>
          <Text style={styles.overline}>RECORDS</Text>
          <Text style={styles.title}>{items.length} COMPLETED</Text>
        </View>
        <TouchableOpacity
          testID="export-csv-btn"
          onPress={handleExport}
          disabled={exporting}
          style={[styles.exportBtn, exporting && { opacity: 0.6 }]}
        >
          {exporting ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <>
              <Ionicons name="download-outline" size={18} color={colors.bg} />
              <Text style={styles.exportText}>EXPORT CSV</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.cyan} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="archive-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>NO HISTORY YET</Text>
          <Text style={styles.emptySub}>
            Completed experiments will appear here once samples are removed.
          </Text>
        </View>
      ) : (
        <FlatList
          testID="history-list"
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              testID={`history-card-${item.id}`}
              onPress={() => router.push(`/experiment/${item.id}`)}
              style={styles.card}
              activeOpacity={0.85}
            >
              <View style={styles.row}>
                <Text style={styles.batch}>{item.batch}</Text>
                <View style={styles.row}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.hours}h</Text>
                  </View>
                  <TouchableOpacity
                    testID={`history-delete-${item.id}`}
                    onPress={() => handleDelete(item)}
                    hitSlop={10}
                    style={styles.deleteBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.red} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.condition} numberOfLines={1}>
                {item.condition}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>RESEARCHER</Text>
                <Text style={styles.metaValue}>{item.researcher}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>START</Text>
                <Text style={styles.metaValue}>{formatDate(item.start_time)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>REMOVED</Text>
                <Text style={styles.metaValue}>{formatDate(item.removed_at)}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  overline: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: 2,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.cyan,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.sm,
  },
  exportText: { color: colors.bg, fontWeight: "800", letterSpacing: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyTitle: {
    color: colors.text,
    marginTop: spacing.md,
    fontSize: 14,
    letterSpacing: 2,
    fontWeight: "700",
  },
  emptySub: {
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: "center",
    maxWidth: 280,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.green,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  batch: { color: colors.text, fontSize: 17, fontWeight: "700", fontFamily: fonts.mono },
  badge: {
    backgroundColor: colors.cyanMuted,
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { color: colors.cyan, fontWeight: "700", fontSize: 12 },
  deleteBtn: { padding: 8, marginLeft: 4 },
  condition: { color: colors.textSecondary, marginTop: 4 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  metaLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },
  metaValue: { color: colors.textSecondary, fontSize: 13 },
});
