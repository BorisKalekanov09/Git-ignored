import BlurHeader from "@/components/BlurHeader";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function SettingsScreen() {
  const { signOut, session } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <>
      {Platform.OS === "android" && <BlurHeader title="Settings" />}
      <View style={styles.container}>
        <Text style={styles.text}>Settings</Text>
        {session?.user?.email && (
          <Text style={styles.email}>{session.user.email}</Text>
        )}
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  text: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
  },
  email: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
  },
  logoutButton: {
    marginTop: 8,
    backgroundColor: "#EA575F",
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
  },
  logoutText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
