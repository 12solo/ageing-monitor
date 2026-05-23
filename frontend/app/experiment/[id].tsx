import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { api, Experiment } from "@/src/api/client";
import { colors, fonts, radii, spacing } from "@/src/theme";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "READY TO REMOVE";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function ExperimentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [exp, setExp] = useState<Experiment | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getExperiment(id);
      setExp(data);
      setNotes(data.notes || "");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to load experiment");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleSaveNotes = async () => {
    if (!exp) return;
    setSaving(true);
    try {
      const updated = await api.updateExperiment(exp.id, { notes });
      setExp(updated);
      Alert.alert("Saved", "Notes updated.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handlePickPhoto = async () => {
    if (!exp) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access to attach an image to this experiment.",
      );
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      base64: true,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const dataUrl = asset.base64
      ? `data:image/jpeg;base64,${asset.base64}`
      : null;
    if (!dataUrl) {
      Alert.alert("Error", "Could not read selected image.");
      return;
    }
    try {
      setSaving(true);
      const updated = await api.updateExperiment(exp.id, { photo_base64: dataUrl });
      setExp(updated);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to upload photo");
    } finally {
      setSaving(false);
    }
  };

  const handleTakePhoto = async () => {
    if (!exp) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera access to capture sample photo.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      base64: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const dataUrl = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : null;
    if (!dataUrl) return;
    try {
      setSaving(true);
      const updated = await api.updateExperiment(exp.id, { photo_base64: dataUrl });
      setExp(updated);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to upload photo");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmRemoved = async () => {
    if (!exp) return;
    try {
      const updated = await api.markRemoved(exp.id);
      setExp(updated);
      Alert.alert("Recorded", "Sample marked as removed.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to update");
    }
  };

  const handleDelete = async () => {
    if (!exp) return;
    Alert.alert("Delete experiment?", `${exp.batch} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteExperiment(exp.id);
            router.back();
          } catch (e: any) {
            Alert.alert("Error", e?.message || "Failed to delete");
          }
        },
      },
    ]);
  };

  if (loading || !exp) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.cyan} />
        </View>
      </SafeAreaView>
    );
  }

  const isComplete = !exp.removed_at && now >= exp.end_time;
  const isRemoved = !!exp.removed_at;
  const remaining = exp.end_time - now;
  const statusColor = isRemoved ? colors.green : isComplete ? colors.red : colors.cyan;
  const statusLabel = isRemoved
    ? "REMOVED"
    : isComplete
    ? "READY TO REMOVE"
    : "AGEING IN PROGRESS";

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}>
          <View style={[styles.statusBar, { borderLeftColor: statusColor }]}>
            <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
            <Text style={styles.batch}>{exp.batch}</Text>
            <Text style={styles.condition}>{exp.condition}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardOverline}>TIMER</Text>
            <Text style={[styles.timer, { color: statusColor }]}>
              {isRemoved ? "✓ COMPLETED" : formatRemaining(remaining)}
            </Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.metaLabel}>TARGET</Text>
                <Text style={styles.metaValue}>{exp.hours} hours</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.metaLabel}>RESEARCHER</Text>
                <Text style={styles.metaValue}>{exp.researcher}</Text>
              </View>
            </View>
            <View style={[styles.row, { marginTop: spacing.md }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.metaLabel}>START</Text>
                <Text style={styles.metaValue}>
                  {new Date(exp.start_time).toLocaleString()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.metaLabel}>END</Text>
                <Text style={styles.metaValue}>
                  {new Date(exp.end_time).toLocaleString()}
                </Text>
              </View>
            </View>
          </View>

          {/* Photo section */}
          <View style={styles.card}>
            <Text style={styles.cardOverline}>SAMPLE PHOTO</Text>
            {exp.photo_base64 ? (
              <Image source={{ uri: exp.photo_base64 }} style={styles.photo} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="image-outline" size={40} color={colors.textMuted} />
                <Text style={styles.placeholderText}>No photo attached</Text>
              </View>
            )}
            <View style={styles.btnRow}>
              <TouchableOpacity
                testID="take-photo-btn"
                onPress={handleTakePhoto}
                disabled={saving}
                style={[styles.secondaryBtn, { flex: 1 }]}
              >
                <Ionicons name="camera-outline" size={18} color={colors.cyan} />
                <Text style={styles.secondaryBtnText}>CAMERA</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="pick-photo-btn"
                onPress={handlePickPhoto}
                disabled={saving}
                style={[styles.secondaryBtn, { flex: 1 }]}
              >
                <Ionicons name="images-outline" size={18} color={colors.cyan} />
                <Text style={styles.secondaryBtnText}>GALLERY</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Notes section */}
          <View style={styles.card}>
            <Text style={styles.cardOverline}>NOTES</Text>
            <TextInput
              testID="notes-input"
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Observations, anomalies, measurements…"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={5}
            />
            <TouchableOpacity
              testID="save-notes-btn"
              onPress={handleSaveNotes}
              disabled={saving}
              style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
            >
              {saving ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <>
                  <Ionicons name="save-outline" size={18} color={colors.bg} />
                  <Text style={styles.primaryBtnText}>SAVE NOTES</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {!isRemoved && isComplete && (
            <TouchableOpacity
              testID="detail-confirm-removed-btn"
              onPress={handleConfirmRemoved}
              style={[styles.primaryBtn, { backgroundColor: colors.green }]}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.bg} />
              <Text style={styles.primaryBtnText}>CONFIRM SAMPLE REMOVED</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            testID="detail-delete-btn"
            onPress={handleDelete}
            style={styles.dangerBtn}
          >
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <Text style={styles.dangerBtnText}>DELETE EXPERIMENT</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  statusBar: {
    padding: spacing.lg,
    borderLeftWidth: 4,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusLabel: { letterSpacing: 2, fontWeight: "800", fontSize: 11 },
  batch: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: fonts.mono,
    marginTop: 6,
  },
  condition: { color: colors.textSecondary, marginTop: 4 },

  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  cardOverline: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  timer: {
    fontSize: 36,
    fontFamily: fonts.mono,
    fontWeight: "800",
    textAlign: "center",
    marginVertical: spacing.sm,
  },
  row: { flexDirection: "row", gap: spacing.md },
  metaLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  metaValue: { color: colors.text, marginTop: 4 },

  photo: {
    width: "100%",
    height: 220,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
  },
  photoPlaceholder: {
    height: 160,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  placeholderText: { color: colors.textMuted, fontSize: 12, letterSpacing: 1 },
  btnRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.cyan,
    backgroundColor: colors.cyanMuted,
  },
  secondaryBtnText: { color: colors.cyan, fontWeight: "800", letterSpacing: 1.2 },

  notesInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    color: colors.text,
    padding: 12,
    minHeight: 100,
    textAlignVertical: "top",
  },
  primaryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.cyan,
    paddingVertical: 13,
    borderRadius: radii.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: { color: colors.bg, fontWeight: "800", letterSpacing: 1.2 },

  dangerBtn: {
    marginTop: spacing.xl,
    paddingVertical: 13,
    borderRadius: radii.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.red,
  },
  dangerBtnText: { color: colors.red, fontWeight: "800", letterSpacing: 1.2 },
});
