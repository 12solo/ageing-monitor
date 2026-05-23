import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, Researcher } from "@/src/api/client";
import { scheduleCompletionNotification, requestNotificationPermission } from "@/src/notifications";
import { colors, fonts, radii, spacing } from "@/src/theme";

// ─── Materials ───────────────────────────────────────────────────────────────
const PBS_VARIANTS   = ["PBS", "PBS-CSS", "PBS-MP", "PBS-OP", "PBS-WP"] as const;
const ECO_VARIANTS   = ["ECO-CSS", "ECO-MP", "ECO-OP", "ECO-WP"] as const;
const ALL_MATERIALS  = [...PBS_VARIANTS, ...ECO_VARIANTS] as const;
type Material = (typeof ALL_MATERIALS)[number];

// ─── Ageing methods ──────────────────────────────────────────────────────────
type AgeingMethod = "hydrothermal" | "oven" | "uv";

const AGEING_METHODS: { key: AgeingMethod; label: string; icon: string; unit: string }[] = [
  { key: "hydrothermal", label: "Hydrothermal\n(Water Bath)",  icon: "water-outline",       unit: "°C" },
  { key: "oven",         label: "Oven\nAgeing",               icon: "thermometer-outline",  unit: "°C" },
  { key: "uv",           label: "UV\nAgeing",                 icon: "sunny-outline",        unit: "" },
];

// Hydrothermal temperatures
const HYDRO_TEMPS = ["37°C", "50°C", "60°C", "70°C", "80°C", "90°C"];
// Oven temperatures
const OVEN_TEMPS  = ["40°C", "50°C", "60°C", "70°C", "80°C", "100°C", "120°C"];
// UV types
const UV_TYPES    = ["UVA", "UVC", "UVA+UVC"];

function buildCondition(method: AgeingMethod, temp: string, uvType: string): string {
  if (method === "hydrothermal") return `Hydrothermal ageing – Water bath at ${temp}`;
  if (method === "oven")         return `Oven ageing at ${temp}`;
  if (method === "uv")           return `UV ageing – ${uvType}`;
  return "";
}

export default function NewExperimentScreen() {
  const router = useRouter();

  // ── form state ──
  const [material, setMaterial] = useState<Material | "">("");
  const [batchSuffix, setBatchSuffix] = useState("");          // optional trailing ID
  const [researcher, setResearcher] = useState("Solomon");
  const [researchers, setResearchers] = useState<Researcher[]>([]);

  const [method, setMethod]   = useState<AgeingMethod | "">("");
  const [temp, setTemp]       = useState("");
  const [uvType, setUvType]   = useState("UVA");

  const [hours, setHours]       = useState("");
  const [durationUnit, setDurationUnit] = useState<"hours" | "days">("days");
  const [submitting, setSubmitting] = useState(false);

  // derived batch label
  const batch = material
    ? batchSuffix.trim()
      ? `${material}-${batchSuffix.trim()}`
      : material
    : batchSuffix.trim();

  // derived condition string
  const condition =
    method === "hydrothermal" ? buildCondition("hydrothermal", temp, "") :
    method === "oven"         ? buildCondition("oven", temp, "")         :
    method === "uv"           ? buildCondition("uv", "", uvType)         : "";

  const loadResearchers = useCallback(async () => {
    try {
      const items = await api.listResearchers();
      setResearchers(items);
      if (items.length && !items.find((r) => r.name === researcher)) {
        setResearcher(items[0].name);
      }
    } catch { /* ignore */ }
  }, [researcher]);

  useEffect(() => {
    loadResearchers();
    requestNotificationPermission();
  }, [loadResearchers]);

  const handleSubmit = async () => {
    const raw = parseFloat(hours);
    const h = durationUnit === "days" ? raw * 24 : raw;
    if (!batch.trim()) { Alert.alert("Missing data", "Please select a material."); return; }
    if (!method)       { Alert.alert("Missing data", "Please select an ageing method."); return; }
    if ((method === "hydrothermal" || method === "oven") && !temp) {
      Alert.alert("Missing data", "Please select a temperature."); return;
    }
    if (!researcher.trim()) { Alert.alert("Missing data", "Please enter a researcher name."); return; }
    if (isNaN(h) || h <= 0) { Alert.alert("Missing data", "Please enter a valid duration."); return; }

    setSubmitting(true);
    try {
      const created = await api.createExperiment({
        batch: batch.trim(),
        researcher: researcher.trim(),
        condition,
        hours: h,
      });
      await scheduleCompletionNotification(created.id, created.batch, created.end_time);
      router.back();
    } catch (e: any) {
      Alert.alert("Failed", e?.message || "Could not start experiment");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !!batch.trim() &&
    !!method &&
    ((method !== "hydrothermal" && method !== "oven") || !!temp) &&
    !!researcher.trim() &&
    !!hours && !isNaN(parseFloat(hours)) && parseFloat(hours) > 0;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}>
          <Text style={styles.overline}>NEW PROTOCOL</Text>
          <Text style={styles.title}>START AGEING TIMER</Text>
          <Text style={styles.sub}>
            Select material, ageing method and temperature, then set the duration.
          </Text>

          {/* ── STEP 1: Material ── */}
          <SectionHeader n={1} label="MATERIAL" />

          <Text style={styles.groupLabel}>PBS variants</Text>
          <View style={styles.chips}>
            {PBS_VARIANTS.map((m) => (
              <Chip key={m} label={m} active={material === m} onPress={() => setMaterial(m)} />
            ))}
          </View>

          <Text style={[styles.groupLabel, { marginTop: 10 }]}>ECO variants</Text>
          <View style={styles.chips}>
            {ECO_VARIANTS.map((m) => (
              <Chip key={m} label={m} active={material === m} onPress={() => setMaterial(m)} />
            ))}
          </View>

          <Text style={[styles.label, { marginTop: spacing.md }]}>SAMPLE ID (optional suffix)</Text>
          <TextInput
            style={[styles.input, { fontFamily: fonts.mono }]}
            value={batchSuffix}
            onChangeText={setBatchSuffix}
            placeholder="e.g. 01, A, 230524"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
          />
          {batch ? (
            <Text style={styles.previewPill}>
              Sample ID: <Text style={{ color: colors.cyan }}>{batch}</Text>
            </Text>
          ) : null}

          {/* ── STEP 2: Ageing Method ── */}
          <SectionHeader n={2} label="AGEING METHOD" />
          <View style={styles.methodRow}>
            {AGEING_METHODS.map((m) => (
              <TouchableOpacity
                key={m.key}
                onPress={() => { setMethod(m.key); setTemp(""); }}
                style={[styles.methodCard, method === m.key && styles.methodCardActive]}
              >
                <Ionicons
                  name={m.icon as any}
                  size={26}
                  color={method === m.key ? colors.cyan : colors.textMuted}
                />
                <Text style={[styles.methodLabel, method === m.key && styles.methodLabelActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Temperature picker (hydrothermal or oven) */}
          {(method === "hydrothermal" || method === "oven") && (
            <>
              <Text style={styles.label}>TEMPERATURE</Text>
              <View style={styles.chips}>
                {(method === "hydrothermal" ? HYDRO_TEMPS : OVEN_TEMPS).map((t) => (
                  <Chip key={t} label={t} active={temp === t} onPress={() => setTemp(t)} />
                ))}
              </View>
            </>
          )}

          {/* UV type picker */}
          {method === "uv" && (
            <>
              <Text style={styles.label}>UV TYPE</Text>
              <View style={styles.chips}>
                {UV_TYPES.map((u) => (
                  <Chip key={u} label={u} active={uvType === u} onPress={() => setUvType(u)} />
                ))}
              </View>
            </>
          )}

          {/* Condition preview */}
          {condition ? (
            <View style={styles.conditionPreview}>
              <Text style={styles.conditionPreviewLabel}>CONDITION</Text>
              <Text style={styles.conditionPreviewValue}>{condition}</Text>
            </View>
          ) : null}

          {/* ── STEP 3: Researcher ── */}
          <SectionHeader n={3} label="RESEARCHER" />
          <TextInput
            style={styles.input}
            value={researcher}
            onChangeText={setResearcher}
            placeholder="Researcher name…"
            placeholderTextColor={colors.textMuted}
          />
          {researchers.length > 0 && (
            <View style={styles.chips}>
              {researchers.map((r) => (
                <Chip
                  key={r.id}
                  label={r.name}
                  active={r.name === researcher}
                  onPress={() => setResearcher(r.name)}
                />
              ))}
            </View>
          )}

          {/* ── STEP 4: Duration ── */}
          <SectionHeader n={4} label="DURATION" />
          <View style={styles.labelRow}>
            <Text style={styles.label}>{durationUnit === "days" ? "DAYS" : "HOURS"}</Text>
            <View style={styles.unitToggle}>
              {(["hours", "days"] as const).map((u) => (
                <TouchableOpacity
                  key={u}
                  onPress={() => setDurationUnit(u)}
                  style={[styles.unitBtn, durationUnit === u && styles.unitBtnActive]}
                >
                  <Text style={[styles.unitText, durationUnit === u && styles.unitTextActive]}>
                    {u.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TextInput
            style={[styles.input, { fontFamily: fonts.mono }]}
            value={hours}
            onChangeText={setHours}
            placeholder={durationUnit === "days" ? "e.g. 14" : "e.g. 500"}
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
          />
          {!!hours && !isNaN(parseFloat(hours)) && (
            <Text style={styles.unitHint}>
              {durationUnit === "days"
                ? `≈ ${(parseFloat(hours) * 24).toFixed(0)} hours total`
                : `≈ ${(parseFloat(hours) / 24).toFixed(2)} days total`}
            </Text>
          )}

          {/* ── Submit ── */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting || !canSubmit}
            style={[styles.primaryBtn, (!canSubmit || submitting) && { opacity: 0.45 }]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <>
                <Ionicons name="play" size={18} color={colors.bg} />
                <Text style={styles.primaryBtnText}>START AGEING TIMER</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.back()} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>CANCEL</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function SectionHeader({ n, label }: { n: number; label: string }) {
  return (
    <View style={sh.row}>
      <View style={sh.badge}><Text style={sh.badgeText}>{n}</Text></View>
      <Text style={sh.label}>{label}</Text>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const sh = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  badge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.cyan,
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: colors.bg, fontWeight: "900", fontSize: 12 },
  label: {
    color: colors.text, fontSize: 12,
    fontWeight: "800", letterSpacing: 2,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  overline: { color: colors.cyan, fontSize: 10, letterSpacing: 2.5, fontWeight: "800" },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 4, letterSpacing: 0.5 },
  sub: { color: colors.textSecondary, marginTop: 6, marginBottom: spacing.md, lineHeight: 20 },

  groupLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: "700", marginBottom: 6 },
  label: { color: colors.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: "700", marginBottom: 6 },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderStrong,
    borderRadius: radii.sm, color: colors.text,
    paddingHorizontal: 12, minHeight: 48, fontSize: 15,
  },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderStrong,
    borderRadius: radii.pill,
  },
  chipActive: { backgroundColor: colors.cyanMuted, borderColor: colors.cyan },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.cyan, fontWeight: "800" },

  previewPill: {
    marginTop: 8, color: colors.textMuted,
    fontSize: 12, fontFamily: fonts.mono,
  },

  methodRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  methodCard: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderStrong,
    borderRadius: radii.md, gap: 6,
  },
  methodCardActive: { backgroundColor: colors.cyanMuted, borderColor: colors.cyan },
  methodLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "700", textAlign: "center", letterSpacing: 0.5 },
  methodLabelActive: { color: colors.cyan },

  conditionPreview: {
    marginTop: spacing.md,
    padding: 12,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderStrong,
    borderRadius: radii.sm, borderLeftWidth: 3, borderLeftColor: colors.cyan,
  },
  conditionPreviewLabel: { color: colors.textMuted, fontSize: 9, letterSpacing: 2, fontWeight: "700" },
  conditionPreviewValue: { color: colors.text, marginTop: 4, fontSize: 13 },

  labelRow: {
    flexDirection: "row", alignItems: "flex-end",
    justifyContent: "space-between", marginBottom: 6,
  },
  unitToggle: {
    flexDirection: "row", borderWidth: 1,
    borderColor: colors.borderStrong, borderRadius: radii.pill, overflow: "hidden",
  },
  unitBtn: { paddingHorizontal: 12, paddingVertical: 4 },
  unitBtnActive: { backgroundColor: colors.cyanMuted },
  unitText: { color: colors.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  unitTextActive: { color: colors.cyan },
  unitHint: { color: colors.textMuted, fontSize: 12, marginTop: 6, fontFamily: fonts.mono },

  primaryBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.cyan,
    paddingVertical: 14, borderRadius: radii.sm,
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8,
  },
  primaryBtnText: { color: colors.bg, fontWeight: "800", letterSpacing: 1.2 },

  cancelBtn: { padding: spacing.md, alignItems: "center", marginTop: spacing.sm },
  cancelText: { color: colors.textMuted, letterSpacing: 2, fontWeight: "700" },
});
