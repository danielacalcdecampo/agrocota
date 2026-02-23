import React, { useState, useEffect, useCallback } from 'react';
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
  StatusBar,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';
import { RootStackParamList } from '../navigation/AppNavigator';

function maskCNPJ(value: string) {
  const d = value.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

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

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Profile'>;
};

export default function ProfileScreen({ navigation }: Props) {
  const { profile, session, refreshProfile, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  // Oculta e-mails de contas excluídas (formato interno do sistema)
  const rawEmail = session?.user?.email ?? '';
  const email = rawEmail.includes('@agrocota.deleted') ? '' : rawEmail;

  const [form, setForm] = useState({
    full_name: '',
    company_name: '',
    cnpj: '',
    phone: '',
  });
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Senha
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassSection, setShowPassSection] = useState(false);
  const [savingPass, setSavingPass] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshProfile();
    }, [refreshProfile])
  );

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name ?? '',
        company_name: profile.company_name ?? '',
        cnpj: profile.cnpj ? maskCNPJ(profile.cnpj) : '',
        phone: profile.phone ?? '',
      });
      setLogoUri(profile.company_logo_url ?? null);
    }
  }, [profile]);

  const update = (field: keyof typeof form, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const pickLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão necessária', 'Permita o acesso à galeria.');
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
      setLogoUri(result.assets[0].uri);
      setLogoBase64(result.assets[0].base64 ?? null);
    }
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { Alert.alert('Atenção', 'Informe seu nome completo.'); return; }
    if (!form.company_name.trim()) { Alert.alert('Atenção', 'Informe o nome da empresa.'); return; }
    if (form.cnpj.replace(/\D/g, '').length !== 14) { Alert.alert('Atenção', 'CNPJ inválido.'); return; }

    setLoading(true);
    try {
      const uid = session!.user.id;
      let logoUrl = profile?.company_logo_url ?? null;
      if (logoBase64) logoUrl = await uploadImage(logoBase64, 'avatars', `${uid}/logo.jpg`);

      const { error } = await supabase.from('profiles').update({
        full_name: form.full_name.trim(),
        company_name: form.company_name.trim(),
        cnpj: form.cnpj.replace(/\D/g, ''),
        phone: form.phone.trim(),
        company_logo_url: logoUrl,
      }).eq('id', uid);

      if (error) throw new Error(error.message);
      await refreshProfile();
    } catch (e: any) {
      Alert.alert('Erro', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) { Alert.alert('Atenção', 'Senha deve ter pelo menos 6 caracteres.'); return; }
    if (newPassword !== confirmPassword) { Alert.alert('Atenção', 'As senhas não coincidem.'); return; }
    setSavingPass(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
      setNewPassword('');
      setConfirmPassword('');
      setShowPassSection(false);
    } catch (e: any) {
      Alert.alert('Erro', e.message);
    } finally {
      setSavingPass(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Excluir conta',
      'Todos os seus dados serão excluídos permanentemente: perfil, fazendas, cotações e arquivos. Esta ação não pode ser desfeita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir tudo',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.rpc('delete_own_account', {
                reason: 'Solicitação do usuário via app',
              });
              if (error) throw new Error(error.message);
              await signOut();
            } catch (e: any) {
              Alert.alert('Erro', e.message);
            }
          },
        },
      ],
    );
  };

  const initials = form.full_name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primaryDark} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.backText}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Meu Perfil</Text>
        <View style={{ width: 88 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Logo */}
          <View style={styles.logoSection}>
            <TouchableOpacity style={styles.logoCircle} onPress={pickLogo} activeOpacity={0.8}>
              {logoUri ? (
                <Image source={{ uri: logoUri }} style={styles.logoImg} />
              ) : (
                <Text style={styles.logoInitials}>{initials || 'AC'}</Text>
              )}
              <View style={styles.logoEditBadge}>
                <Text style={styles.logoEditIcon}>✎</Text>
              </View>
            </TouchableOpacity>
            <Text style={styles.logoHint}>Toque para alterar a logo da empresa</Text>
          </View>

          {/* Dados pessoais */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Dados Pessoais</Text>

            <Text style={styles.label}>Nome completo</Text>
            <TextInput
              style={styles.input}
              value={form.full_name}
              onChangeText={v => update('full_name', v)}
              placeholder="Seu nome completo"
              placeholderTextColor={Colors.textSecondary}
            />

            <Text style={styles.label}>E-mail</Text>
            <View style={styles.inputReadOnly}>
              <Text style={styles.inputReadOnlyText}>{email || '—'}</Text>
            </View>

            <Text style={styles.label}>Telefone / WhatsApp</Text>
            <TextInput
              style={styles.input}
              value={form.phone}
              onChangeText={v => update('phone', v)}
              placeholder="(00) 00000-0000"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="phone-pad"
            />
          </View>

          {/* Dados da empresa */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Dados da Empresa</Text>

            <Text style={styles.label}>Nome da empresa</Text>
            <TextInput
              style={styles.input}
              value={form.company_name}
              onChangeText={v => update('company_name', v)}
              placeholder="Nome da sua empresa"
              placeholderTextColor={Colors.textSecondary}
            />

            <Text style={styles.label}>CNPJ</Text>
            <TextInput
              style={styles.input}
              value={form.cnpj}
              onChangeText={v => update('cnpj', maskCNPJ(v))}
              placeholder="00.000.000/0000-00"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="numeric"
              maxLength={18}
            />
          </View>

          {/* Botão salvar */}
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={loading} activeOpacity={0.85}>
            {loading
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.saveBtnText}>Salvar alterações</Text>
            }
          </TouchableOpacity>

          {/* Alterar senha */}
          <TouchableOpacity
            style={styles.togglePassBtn}
            onPress={() => setShowPassSection(p => !p)}
            activeOpacity={0.7}
          >
            <Text style={styles.togglePassText}>
              {showPassSection ? 'Fechar' : 'Alterar senha'}
            </Text>
          </TouchableOpacity>

          {showPassSection && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Nova Senha</Text>
              <Text style={styles.label}>Nova senha</Text>
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Mínimo 6 caracteres"
                placeholderTextColor={Colors.textSecondary}
                secureTextEntry
              />
              <Text style={styles.label}>Confirmar nova senha</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Repita a senha"
                placeholderTextColor={Colors.textSecondary}
                secureTextEntry
              />
              <TouchableOpacity style={styles.passBtn} onPress={handleChangePassword} disabled={savingPass} activeOpacity={0.85}>
                {savingPass
                  ? <ActivityIndicator color={Colors.white} />
                  : <Text style={styles.passBtnText}>Confirmar nova senha</Text>
                }
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 40 }} />

          <TouchableOpacity style={styles.deleteLink} onPress={handleDeleteAccount} activeOpacity={0.7}>
            <Text style={styles.deleteLinkText}>Excluir minha conta</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  header: {
    backgroundColor: Colors.primary,
    paddingTop: 14,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    minWidth: 88, alignItems: 'center',
  },
  backText: { fontSize: 14, color: Colors.white, fontWeight: '700' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.white },

  scroll: { padding: 16 },

  // Logo
  logoSection: { alignItems: 'center', marginTop: 8, marginBottom: 20 },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.primary,
  },
  logoImg: { width: 100, height: 100, borderRadius: 50 },
  logoInitials: { fontSize: 34, fontWeight: '800', color: Colors.white },
  logoEditBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: Colors.secondary,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  logoEditIcon: { fontSize: 13, color: Colors.white },
  logoHint: { fontSize: 12, color: Colors.textSecondary, marginTop: 8 },

  // Cards
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  label: { fontSize: 13, color: Colors.textSecondary, marginBottom: 4, marginTop: 8 },
  input: {
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  inputReadOnly: {
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 2,
  },
  inputReadOnlyText: {
    fontSize: 15,
    color: '#9E9E9E',
  },

  // Botões
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
    elevation: 2,
  },
  saveBtnText: { color: Colors.white, fontWeight: '700', fontSize: 16 },

  togglePassBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 12,
  },
  togglePassText: { color: Colors.primary, fontWeight: '600', fontSize: 14 },

  passBtn: {
    backgroundColor: Colors.primaryDark,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 12,
  },
  passBtnText: { color: Colors.white, fontWeight: '700', fontSize: 15 },

  deleteLink: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  deleteLinkText: {
    fontSize: 13,
    color: '#B71C1C',
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
