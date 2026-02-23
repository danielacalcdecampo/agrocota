import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';

export default function ProdutorHomeScreen() {
  const { profile, signOut } = useAuth();

  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>🚜 PRODUTOR</Text>
      </View>
      <Text style={styles.title}>Olá, {profile?.full_name?.split(' ')[0]}! 👋</Text>
      <Text style={styles.subtitle}>
        Login realizado com sucesso!{'\n'}Em breve você poderá visualizar cotações e relatórios da sua fazenda.
      </Text>
      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sair</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center', padding: 24 },
  badge: { backgroundColor: Colors.secondary + '22', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 16, borderWidth: 1, borderColor: Colors.secondary },
  badgeText: { color: Colors.secondary, fontWeight: '700', fontSize: 13 },
  title: { fontSize: 26, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  signOutButton: { backgroundColor: Colors.error, borderRadius: 10, paddingHorizontal: 32, paddingVertical: 12 },
  signOutText: { color: Colors.white, fontWeight: '700', fontSize: 15 },
});
