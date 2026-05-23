import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, Researcher } from "@/src/api/client";
import { colors, fonts, radii, spacing } from "@/src/theme";

export default function ResearchersScreen() {
  const [researchers, setResearchers] = useState<Researcher[]>([]);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const items = await api.listResearchers();
      setResearchers(items);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await api.createResearcher(trimmed);
      setName("");
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to add researcher");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = (r: Researcher) => {
    Alert.alert("Remove researcher?", `Delete "${r.name}" from the team list?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteResearcher(r.id);
            await load();
          } catch (e: any) {
            Alert.alert("Error", e?.message || "Failed to delete");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.toolbar}>
          <View>
            <Text style={styles.overline}>TEAM</Text>
            <Text style={styles.title}>{researchers.length} RESEARCHERS</Text>
          </View>
        </View>

        <View style={styles.addRow}>
          <TextInput
            testID="researcher-name-input"
            style={styles.input}
            placeholder="Add researcher name…"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            onSubmitEditing={handleAdd}
            returnKeyType="done"
          />
          <TouchableOpacity
            testID="researcher-add-btn"
            onPress={handleAdd}
            disabled={adding || !name.trim()}
            style={[styles.addBtn, (!name.trim() || adding) && { opacity: 0.4 }]}
          >
            {adding ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Ionicons name="add" size={22} color={colors.bg} />
            )}
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.cyan} />
          </View>
        ) : (
          <FlatList
            testID="researchers-list"
            data={researchers}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.lg }}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
            renderItem={({ item }) => (
              <View style={styles.row} testID={`researcher-${item.id}`}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {item.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.sub}>ACTIVE TEAM MEMBER</Text>
                </View>
                <TouchableOpacity
                  testID={`researcher-delete-${item.id}`}
                  onPress={() => handleDelete(item)}
                  hitSlop={10}
                  style={styles.deleteBtn}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.center}>
                <Ionicons name="people-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>NO RESEARCHERS</Text>
              </View>
            }
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
  addRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    color: colors.text,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  addBtn: {
    backgroundColor: colors.cyan,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.cyanMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.cyan, fontWeight: "800", fontFamily: fonts.mono },
  name: { color: colors.text, fontWeight: "700", fontSize: 15 },
  sub: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: 2,
    fontWeight: "700",
  },
  deleteBtn: { padding: 6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyTitle: {
    color: colors.text,
    marginTop: spacing.md,
    fontSize: 14,
    letterSpacing: 2,
    fontWeight: "700",
  },
});
