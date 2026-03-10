import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, Alert, Image,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { Colors } from '../theme/colors';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Atenção', 'Preencha e-mail e senha.');
      return;
    }

    setLoading(true);

    try {
      // 1. Autentica no Supabase
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });

      if (authError) {
        Alert.alert(
          'Erro ao entrar',
          authError.message === 'Invalid login credentials'
            ? 'E-mail ou senha incorretos.'
            : authError.message
        );
        return;
      }

      const userId = authData.user.id;

      // 2. Gera token único para esta sessão
      const newToken = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${userId}-${Date.now()}-${Math.random()}`
      );

      // 3. Chama a RPC que verifica se já há sessão ativa e, se não houver, registra
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'try_login_mobile',
        { p_user_id: userId, p_new_token: newToken }
      );

      if (rpcError) {
        // Erro inesperado na RPC — deixa passar para não travar usuário legítimo
        console.warn('RPC try_login_mobile error:', rpcError.message);
      } else if (rpcData?.allowed === false) {
        // ❌ Sessão ativa em outro dispositivo — faz logout e bloqueia
        await supabase.auth.signOut();
        Alert.alert(
          'Acesso bloqueado',
          rpcData.reason ??
            'Esta conta já está sendo usada em outro dispositivo.\n\nFaça logout no outro celular antes de entrar aqui.',
          [{ text: 'Entendi', style: 'default' }]
        );
        return;
      }

      // 4. ✅ Acesso liberado — salva token localmente para o heartbeat
      await AsyncStorage.setItem('@agrocota_session_token', newToken);
      await AsyncStorage.setItem('@agrocota_user_id', userId);

      // AuthContext detecta a sessão e redireciona automaticamente

    } finally {
      setLoading(false);
    }
  };

  // ── UI igual à original ──────────────────────────────────────────────────
  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={40}
    >
        <View style={styles.header}>
          <Image
            source={require('../../assets/logo-transparent.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.appSubtitle}>Cotações de insumos para o campo</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formTitle}>Entrar</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={styles.input}
              placeholder="seu@email.com"
              placeholderTextColor={Colors.textSecondary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Senha</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Mínimo 6 caracteres"
                placeholderTextColor={Colors.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                textContentType="password"
                autoComplete="password"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Text style={styles.eyeText}>{showPassword ? 'Ocultar' : 'Ver'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.loginButtonText}>Entrar</Text>
            }
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>novo por aqui?</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.registerButton}
            onPress={() => navigation.navigate('RegisterConsultor')}
            activeOpacity={0.8}
          >
            <Text style={styles.registerButtonText}>Criar conta de Consultor</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>v1.0.0 - OAgroCota</Text>
      </KeyboardAwareScrollView>
    );
  }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: {
    flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 24, paddingVertical: 40,
  },
  header: { alignItems: 'center', marginBottom: 36, width: '100%' },
  logoImage: { width: 170, height: 113, marginBottom: 4, alignSelf: 'center' },
  appSubtitle: {
    fontSize: 14, color: Colors.textSecondary, textAlign: 'center',
    alignSelf: 'center', letterSpacing: 0.2,
  },
  form: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 24, width: '100%',
    shadowColor: Colors.black, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  formTitle: { fontSize: 22, fontWeight: '600', color: Colors.textPrimary, marginBottom: 20 },
  inputGroup: { marginBottom: 16 },
  label: {
    fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12, fontSize: 15, color: Colors.textPrimary,
  },
  passwordContainer: {
    flexDirection: 'row', backgroundColor: Colors.inputBg, borderWidth: 1,
    borderColor: Colors.border, borderRadius: 10, alignItems: 'center',
  },
  passwordInput: {
    flex: 1, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12, fontSize: 15, color: Colors.textPrimary,
  },
  eyeButton: { paddingHorizontal: 12, paddingVertical: 10 },
  eyeText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  loginButton: {
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 15,
    alignItems: 'center', marginTop: 8, shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  loginButtonText: { color: Colors.white, fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 12, color: Colors.textSecondary, marginHorizontal: 10 },
  registerButton: {
    borderWidth: 2, borderColor: Colors.primary, borderRadius: 10,
    paddingVertical: 13, alignItems: 'center', marginBottom: 12,
  },
  registerButtonText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
  footer: { textAlign: 'center', color: Colors.textSecondary, fontSize: 12, marginTop: 24 },
});