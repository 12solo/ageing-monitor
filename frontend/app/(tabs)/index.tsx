import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, RefreshControl, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api, Experiment } from "@/src/api/client";
import { colors, fonts, radii, spacing } from "@/src/theme";

// ─── Ageing method → icon ─────────────────────────────────────────────────
function methodIcon(condition: string): { name: string; color: string } {
  const c = condition.toLowerCase();
  if (c.includes("hydrothermal") || c.includes("water bath"))
    return { name: "water-outline",       color: colors.cyan };
  if (c.includes("oven"))
    return { name: "thermometer-outline",  color: "#f59e0b" };
  if (c.includes("uv") || c.includes("uva") || c.includes("uvc"))
    return { name: "sunny-outline",        color: "#a78bfa" };
  return { name: "flask-outline",          color: colors.textMuted };
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h >= 24) {
    const days = Math.floor(h / 24);
    const remH = h % 24;
    return `${days}d ${pad(remH)}h ${pad(m)}m`;
  }
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function progressFraction(exp: Experiment, now: number): number {
  const total = exp.end_time - exp.start_time;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - exp.start_time) / total));
}

function ExperimentRow({
  exp, now, onPress, onDelete, onRemove,
}: {
  exp: Experiment; now: number;
  onPress: () => void; onDelete: () => void; onRemove: () => void;
}) {
  const { name: iconName, color: iconColor } = methodIcon(exp.condition);

  if (exp.removed_at) {
    const remaining = Math.max(0, Math.ceil((120_000 - (now - exp.removed_at)) / 1000));
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onPress}
        style={[styles.card, styles.cardRemoved]}>
        <View style={styles.removedHeader}>
          <Ionicons name="checkmark-circle" size={28} color={colors.green} />
          <Text style={styles.removedTitle}>SAMPLE REMOVED</Text>
        </View>
        <Text style={styles.removedSub}>{exp.batch} · clearing in {remaining}s</Text>
      </TouchableOpacity>
    );
  }

  const msRemaining = exp.end_time - now;
  const isComplete  = msRemaining <= 0;
  const frac        = progressFraction(exp, now);
  const barColor    = isComplete ? colors.red : frac > 0.9 ? colors.amber : colors.cyan;

  const endDate = new Date(exp.end_time);
  const endStr  = endDate.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <TouchableOpacity testID={`exp-card-${exp.id}`} activeOpacity={0.85}
      onPress={onPress} style={[styles.card, { borderLeftColor: iconColor }]}>

      {/* Header row */}
      <View style={styles.rowBetween}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <Ionicons name={iconName as any} size={18} color={iconColor} />
          <View style={{ flex: 1 }}>
            <Text style={styles.overline}>SAMPLE ID</Text>
            <Text style={styles.batch} numberOfLines={1}>{exp.batch}</Text>
          </View>
        </View>
        <TouchableOpacity testID={`exp-delete-${exp.id}`} hitSlop={10}
          onPress={onDelete} style={styles.deleteBtn}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Meta */}
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>RESEARCHER</Text>
        <Text style={styles.metaValue}>{exp.researcher}</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>CONDITION</Text>
        <Text style={styles.metaValue} numberOfLines={2}>{exp.condition}</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>DURATION</Text>
        <Text style={styles.metaValue}>{exp.hours >= 24
          ? `${(exp.hours / 24).toFixed(exp.hours % 24 === 0 ? 0 : 1)} days`
          : `${exp.hours} h`}
        </Text>
      </View>

      {/* Timer */}
      <Text style={[styles.timer, { color: barColor }]}>
        {isComplete ? "READY TO REMOVE" : formatRemaining(msRemaining)}
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${frac * 100}%`, backgroundColor: barColor }]} />
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.dueLabel}>DUE {endStr}</Text>
      </View>

      {isComplete ? (
        <TouchableOpacity testID={`exp-remove-btn-${exp.id}`} onPress={onRemove} style={styles.primaryBtn}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.bg} />
          <Text style={styles.primaryBtnText}>CONFIRM SAMPLE REMOVED</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.primaryBtn, styles.primaryBtnDisabled]}>
          <Ionicons name="hourglass-outline" size={18} color={colors.textMuted} />
          <Text style={[styles.primaryBtnText, { color: colors.textMuted }]}>AGEING IN PROGRESS</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function ActiveExperimentsScreen() {
  const router = useRouter();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [now,         setNow]         = useState(Date.now());
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const items   = await api.listExperiments();
      const cutoff  = Date.now() - 120_000;
      const toPurge = items.filter((e) => e.removed_at && e.removed_at <= cutoff);
      await Promise.all(toPurge.map((e) => api.deleteExperiment(e.id).catch(() => null)));
      setExperiments(items.filter((e) => !(e.removed_at && e.removed_at <= cutoff)));
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load experiments");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  useEffect(() => {
    if (experiments.some((e) => e.removed_at && now - e.removed_at >= 120_000)) load();
  }, [now, experiments, load]);

  const handleDelete = (exp: Experiment) => {
    Alert.alert("Abort timer?", `Delete ${exp.batch}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive",
        onPress: async () => {
          try { await api.deleteExperiment(exp.id); await load(); }
          catch (e: any) { Alert.alert("Error", e?.message || "Failed to delete"); }
        }},
    ]);
  };

  const handleRemove = async (exp: Experiment) => {
    try { await api.markRemoved(exp.id); await load(); }
    catch (e: any) { Alert.alert("Error", e?.message || "Failed to mark removed"); }
  };

  const active = experiments.filter((e) => !e.removed_at);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.overline}>STATUS</Text>
          <Text style={styles.headerTitle}>{active.length} ACTIVE</Text>
        </View>
        <TouchableOpacity testID="new-experiment-fab"
          onPress={() => router.push("/new-experiment")} style={styles.fab}>
          <Ionicons name="add" size={22} color={colors.bg} />
          <Text style={styles.fabText}>NEW</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.cyan} /></View>
      ) : experiments.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="flask-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>NO ACTIVE EXPERIMENTS</Text>
          <Text style={styles.emptySub}>Start an ageing timer to begin tracking a sample.</Text>
          <TouchableOpacity style={[styles.primaryBtn, { marginTop: spacing.lg, paddingHorizontal: 24 }]}
            onPress={() => router.push("/new-experiment")}>
            <Text style={styles.primaryBtnText}>START AGEING TIMER</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={experiments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} tintColor={colors.cyan}
              onRefresh={() => { setRefreshing(true); load(); }} />
          }
          renderItem={({ item }) => (
            <ExperimentRow exp={item} now={now}
              onPress={() => router.push(`/experiment/${item.id}`)}
              onDelete={() => handleDelete(item)}
              onRemove={() => handleRemove(item)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  header:      { paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
                 flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                 borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: "700", letterSpacing: 0.5 },
  overline:    { color: colors.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: "700", marginBottom: 2 },
  fab:         { flexDirection: "row", alignItems: "center", backgroundColor: colors.cyan,
                 paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radii.sm, gap: 6 },
  fabText:     { color: colors.bg, fontWeight: "800", letterSpacing: 1 },

  errorBox:    { margin: spacing.lg, padding: spacing.md, backgroundColor: colors.redMuted,
                 borderRadius: radii.sm, borderLeftWidth: 3, borderLeftColor: colors.red },
  errorText:   { color: colors.text },

  center:      { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyTitle:  { color: colors.text, marginTop: spacing.md, fontSize: 14, letterSpacing: 2, fontWeight: "700" },
  emptySub:    { color: colors.textMuted, marginTop: spacing.xs, textAlign: "center", maxWidth: 280 },

  card:        { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                 borderLeftWidth: 4, borderLeftColor: colors.cyan, borderRadius: radii.md, padding: spacing.lg },
  cardRemoved: { borderLeftColor: colors.green, backgroundColor: colors.greenMuted, alignItems: "center" },
  removedHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  removedTitle: { color: colors.green, fontWeight: "800", letterSpacing: 2 },
  removedSub:  { color: colors.text, marginTop: 6 },

  rowBetween:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  batch:       { color: colors.text, fontSize: 18, fontWeight: "700", fontFamily: fonts.mono },
  deleteBtn:   { padding: 6 },

  metaRow:     { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  metaLabel:   { color: colors.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },
  metaValue:   { color: colors.textSecondary, fontSize: 13, maxWidth: "65%", textAlign: "right" },

  timer:       { marginTop: spacing.lg, fontSize: 34, fontFamily: fonts.mono,
                 fontWeight: "700", letterSpacing: 1, textAlign: "center" },
  progressTrack: { marginTop: spacing.sm, height: 6, backgroundColor: colors.surfaceElevated,
                   borderRadius: 3, overflow: "hidden" },
  progressFill:  { height: "100%" },
  dueLabel:    { color: colors.textMuted, fontSize: 11, letterSpacing: 1.2, marginTop: spacing.sm },

  primaryBtn:  { marginTop: spacing.md, backgroundColor: colors.cyan, paddingVertical: 12,
                 borderRadius: radii.sm, flexDirection: "row", alignItems: "center",
                 justifyContent: "center", gap: 8 },
  primaryBtnDisabled: { backgroundColor: colors.surfaceElevated },
  primaryBtnText: { color: colors.bg, fontWeight: "800", letterSpacing: 1.2 },
});
