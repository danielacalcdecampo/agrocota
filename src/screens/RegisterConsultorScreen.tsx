import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';
import { RootStackParamList } from '../navigation/AppNavigator';

// ─── CNPJ mask ───────────────────────────────────────────────────────────────
function maskCNPJ(value: string) {
  const d = value.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

// ─── Upload helper ────────────────────────────────────────────────────────────
async function uploadImage(base64: string, bucket: string, path: string): Promise<string> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, bytes.buffer as ArrayBuffer, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}


// ─── Screen ──────────────────────────────────────────────────────────────────
type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RegisterConsultor'>;
};

export default function RegisterConsultorScreen({ navigation }: Props) {
  const { refreshProfile, setRegistering } = useAuth();
  const [form, setForm] = useState({
    full_name: '',
    company_name: '',
    cnpj: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const update = (field: keyof typeof form, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão necessária', 'Permita o acesso à galeria para escolher uma imagem.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setLogoUri(asset.uri);
      setLogoBase64(asset.base64 ?? null);
    }
  };

  const validate = () => {
    if (!form.full_name.trim()) return 'Informe seu nome completo.';
    if (!form.company_name.trim()) return 'Informe o nome da empresa.';
    if (form.cnpj.replace(/\D/g, '').length !== 14) return 'CNPJ inválido (14 dígitos).';
    if (!form.phone.trim()) return 'Informe seu telefone/WhatsApp.';
    const emailClean = form.email.replace(/\s/g, '');
    if (!emailClean) return 'Informe seu e-mail.';
    // Regex mais estrita: local@domain.tld (tld com 2+ letras)
    if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(emailClean)) return 'E-mail inválido.';
    if (form.password.length < 6) return 'Senha deve ter pelo menos 6 caracteres.';
    if (form.password !== form.confirmPassword) return 'As senhas não coincidem.';
    return null;
  };

  const handleRegister = async () => {
    const err = validate();
    if (err) { Alert.alert('Atenção', err); return; }
    setLoading(true);
    // Bloqueia navegação até o perfil estar completo
    setRegistering(true);
    try {
      // Garante que não há sessão ativa (ex: conta excluída ainda no AsyncStorage)
      await supabase.auth.signOut();

      // Remove qualquer espaço invisível que passou pela validação
      const emailFinal = form.email.replace(/\s/g, '').toLowerCase();

      const { data, error: authError } = await supabase.auth.signUp({
        email: emailFinal,
        password: form.password,
      });
      if (authError || !data.user) throw new Error(authError?.message ?? 'Erro desconhecido.');
      const uid = data.user.id;

      let logoUrl: string | null = null;
      if (logoBase64) logoUrl = await uploadImage(logoBase64, 'avatars', `${uid}/logo.jpg`);

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: uid,
        role: 'consultor',
        full_name: form.full_name.trim(),
        company_name: form.company_name.trim(),
        cnpj: form.cnpj.replace(/\D/g, ''),
        phone: form.phone.trim(),
        company_logo_url: logoUrl,
      });
      if (profileError) throw new Error(profileError.message);

      // Passa o uid explicitamente para não depender do sessionRef,
      // que pode ainda apontar para a sessão anterior (conta excluída)
      await refreshProfile(uid);
      setLoading(false);
      setRegistering(false);
    } catch (e: any) {
      setLoading(false);
      setRegistering(false);
      Alert.alert('Erro ao cadastrar', e.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        {/* Botão Voltar */}
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.backLabel}>‹  Voltar</Text>
        </TouchableOpacity>

        {/* Título */}
        <Text style={styles.title}>Criar conta</Text>
        <Text style={styles.subtitle}>Preencha os dados da sua empresa para começar.</Text>

        {/* Logo da empresa */}
        <View style={styles.logoWrapper}>
          <TouchableOpacity style={styles.photoCircle} onPress={pickImage} activeOpacity={0.8}>
            {logoUri
              ? <Image source={{ uri: logoUri }} style={styles.photoImage} />
              : <Text style={styles.photoPlaceholder}>Logo</Text>}
          </TouchableOpacity>
          <Text style={styles.photoLabel}>Logo da empresa</Text>
        </View>

        {/* Formulário */}
        <View style={styles.form}>
          <Field label="Nome Completo *">
            <TextInput style={styles.input} placeholder="Ex: João da Silva"
              placeholderTextColor={Colors.textSecondary} value={form.full_name}
              onChangeText={v => update('full_name', v)} autoCapitalize="words" textContentType="name" />
          </Field>

          <Field label="Nome da Empresa *">
            <TextInput style={styles.input} placeholder="Ex: AgroTech Consultoria"
              placeholderTextColor={Colors.textSecondary} value={form.company_name}
              onChangeText={v => update('company_name', v)} autoCapitalize="words" />
          </Field>

          <Field label="CNPJ *">
            <TextInput style={styles.input} placeholder="00.000.000/0000-00"
              placeholderTextColor={Colors.textSecondary} value={form.cnpj}
              onChangeText={v => update('cnpj', maskCNPJ(v))} keyboardType="numeric" />
          </Field>

          <Field label="Telefone / WhatsApp *">
            <TextInput style={styles.input} placeholder="(99) 99999-9999"
              placeholderTextColor={Colors.textSecondary} value={form.phone}
              onChangeText={v => update('phone', v)} keyboardType="phone-pad"
              textContentType="telephoneNumber" autoComplete="tel" />
          </Field>

          <Field label="E-mail *">
            <TextInput style={styles.input} placeholder="seu@email.com"
              placeholderTextColor={Colors.textSecondary} value={form.email}
              onChangeText={v => update('email', v.replace(/\s/g, ''))} autoCapitalize="none"
              keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
          </Field>

          <Field label="Senha *">
            <View style={styles.passwordContainer}>
              <TextInput style={styles.passwordInput} placeholder="Mínimo 6 caracteres"
                placeholderTextColor={Colors.textSecondary} value={form.password}
                onChangeText={v => update('password', v)} secureTextEntry={!showPassword}
                textContentType="newPassword" />
              <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(p => !p)}>
                <Text style={styles.eyeText}>{showPassword ? 'Ocultar' : 'Ver'}</Text>
              </TouchableOpacity>
            </View>
          </Field>

          <Field label="Confirmar Senha *">
            <TextInput
              style={[styles.input, form.confirmPassword && form.password !== form.confirmPassword ? styles.inputError : null]}
              placeholder="Repita a senha" placeholderTextColor={Colors.textSecondary}
              value={form.confirmPassword} onChangeText={v => update('confirmPassword', v)}
              secureTextEntry={!showPassword} textContentType="newPassword" />
            {form.confirmPassword !== '' && form.password !== form.confirmPassword && (
              <Text style={styles.errorText}>Senhas não coincidem</Text>
            )}
          </Field>

          <TouchableOpacity style={[styles.submitButton, loading && styles.buttonDisabled]}
            onPress={handleRegister} disabled={loading} activeOpacity={0.8}>
            {loading
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.submitButtonText}>Criar Conta</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.loginLink} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.loginLinkText}>
              Já tem conta? <Text style={styles.loginLinkBold}>Entrar</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Field component ──────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={fieldLabelStyle}>{label}</Text>
      {children}
    </View>
  );
}
const fieldLabelStyle: import('react-native').TextStyle = {
  fontSize: 12, fontWeight: '600', color: Colors.textSecondary,
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 56, paddingBottom: 48 },

  backButton: {
    alignSelf: 'flex-start', marginBottom: 22,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#C8E6C9',
    minWidth: 96, alignItems: 'center',
  },
  backLabel: { fontSize: 14, fontWeight: '700', color: Colors.primary },

  title: { fontSize: 28, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 28, lineHeight: 20 },

  logoWrapper: { alignItems: 'center', gap: 8, marginBottom: 28 },
  photoCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.inputBg,
    borderWidth: 2, borderColor: Colors.primary, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  photoImage: { width: 88, height: 88, borderRadius: 44 },
  photoPlaceholder: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  photoLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },

  form: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 24,
    shadowColor: Colors.black, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  input: {
    backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12, fontSize: 15, color: Colors.textPrimary,
  },
  inputError: { borderColor: Colors.error },
  errorText: { color: Colors.error, fontSize: 12, marginTop: 4 },
  passwordContainer: {
    flexDirection: 'row', backgroundColor: Colors.inputBg,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10, alignItems: 'center',
  },
  passwordInput: {
    flex: 1, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12, fontSize: 15, color: Colors.textPrimary,
  },
  eyeButton: { paddingHorizontal: 14, paddingVertical: 10 },
  eyeText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  submitButton: {
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 15,
    alignItems: 'center', marginTop: 8,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  buttonDisabled: { opacity: 0.65 },
  submitButtonText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  loginLink: { alignItems: 'center', marginTop: 16 },
  loginLinkText: { color: Colors.textSecondary, fontSize: 14 },
  loginLinkBold: { color: Colors.primary, fontWeight: '700' },
});
