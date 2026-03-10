import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
  ToastAndroid,
  Image,
  StatusBar,
  Switch,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeContext';
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
  const rawBase64 = base64.replace(/^data:image\/\w+;base64,/, '');
  const binaryString = atob(rawBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Profile'>;
};

export default function ProfileScreen({ navigation }: Props) {
  const { profile, session, refreshProfile, signOut } = useAuth();
  const { isDark, setDarkMode } = useThemeMode();
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
  const [logoUploading, setLogoUploading] = useState(false);
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
      const base64 = result.assets[0].base64;
      setLogoUri(result.assets[0].uri);
      if (!base64 || !session?.user?.id) return;
      setLogoUploading(true);
      try {
        const logoUrl = await uploadImage(base64, 'avatars', `${session.user.id}/logo.jpg`);
        const { error } = await supabase.from('profiles').update({ company_logo_url: logoUrl }).eq('id', session.user.id);
        if (error) throw error;
        setLogoUri(logoUrl);
        setLogoBase64(null);
        await refreshProfile();
        if (Platform.OS === 'android') {
          ToastAndroid.show('Foto salva!', ToastAndroid.SHORT);
        } else {
          Alert.alert('Sucesso', 'Foto atualizada.');
        }
      } catch (e: any) {
        Alert.alert('Erro ao salvar foto', e?.message ?? 'Tente novamente.');
      } finally {
        setLogoUploading(false);
      }
    }
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { Alert.alert('Atenção', 'Informe seu nome completo.'); return; }
    const cnpjDigits = form.cnpj.replace(/\D/g, '');
    if (cnpjDigits.length > 0 && cnpjDigits.length !== 14) { Alert.alert('Atenção', 'CNPJ inválido.'); return; }

    setLoading(true);
    try {
      const uid = session!.user.id;
      let logoUrl = profile?.company_logo_url ?? null;
      if (logoBase64) logoUrl = await uploadImage(logoBase64, 'avatars', `${uid}/logo.jpg`);

      const { error } = await supabase.from('profiles').update({
        full_name: form.full_name.trim(),
        company_name: form.company_name.trim() || null,
        cnpj: form.cnpj.replace(/\D/g, '') || null,
        phone: form.phone.trim(),
        company_logo_url: logoUrl,
      }).eq('id', uid);

      if (error) throw new Error(error.message);
      setLogoBase64(null);
      await refreshProfile();
      if (Platform.OS === 'android') {
        ToastAndroid.show('Perfil alterado com sucesso', ToastAndroid.SHORT);
      } else {
        Alert.alert('Sucesso', 'Perfil alterado com sucesso.');
      }
    } catch (e: any) {
      Alert.alert('Erro ao salvar', e?.message ?? 'Verifique sua conexão e tente novamente.');
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

  const palette = {
    bg: isDark ? '#0F1712' : Colors.background,
    header: isDark ? '#111D16' : Colors.primaryDark,
    card: isDark ? '#17241C' : Colors.surface,
    textPrimary: isDark ? '#E8F3EC' : Colors.textPrimary,
    textSecondary: isDark ? '#AFC4B7' : Colors.textSecondary,
    inputBg: isDark ? '#1D2E24' : Colors.inputBg,
    border: isDark ? '#2B3F33' : Colors.border,
    readonly: isDark ? '#1A2B21' : '#F1F5F2',
  };

  const initials = form.full_name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'light-content'} backgroundColor={palette.header} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14, backgroundColor: palette.header }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.backText}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Meu Perfil</Text>
        <View style={{ width: 88 }} />
      </View>

      <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Identidade */}
          <View style={[styles.identityCard, { backgroundColor: palette.card, borderColor: palette.border }] }>
            <TouchableOpacity style={styles.logoCircle} onPress={pickLogo} activeOpacity={0.8} disabled={logoUploading}>
              {logoUploading ? (
                <View style={styles.logoLoadingWrap}>
                  <ActivityIndicator color="#FFF" size="large" />
                </View>
              ) : logoUri ? (
                <Image source={{ uri: logoUri }} style={styles.logoImg} />
              ) : (
                <Text style={styles.logoInitials}>{initials || 'AC'}</Text>
              )}
              {!logoUploading && (
                <View style={styles.logoEditBadge}>
                  <Text style={styles.logoEditIcon}>✎</Text>
                </View>
              )}
            </TouchableOpacity>
            <View style={styles.identityTextWrap}>
              <Text style={[styles.identityTitle, { color: palette.textPrimary }]} numberOfLines={1}>{form.full_name || 'Consultor'}</Text>
              <Text style={[styles.identitySubtitle, { color: palette.textSecondary }]} numberOfLines={1}>{form.company_name || 'Sua empresa'}</Text>
              <Text style={[styles.logoHint, { color: palette.textSecondary }]}>Toque na foto para alterar a logo da empresa</Text>
            </View>
          </View>

          {session?.user?.email === 'agrocota64@gmail.com' && (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: palette.card, flexDirection: 'row', alignItems: 'center', gap: 12 }]}
              onPress={() => navigation.navigate('AdminDashboard')}
              activeOpacity={0.8}
            >
              <View style={[styles.adminIconWrap, { backgroundColor: Colors.primary + '22' }]}>
                <Text style={[styles.adminIcon, { color: Colors.primary }]}>⚙</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.adminLabel, { color: palette.textPrimary }]}>Painel Administrador</Text>
                <Text style={[styles.adminHint, { color: palette.textSecondary }]}>Analisar todos os dados da plataforma</Text>
              </View>
              <Text style={styles.adminArrow}>›</Text>
            </TouchableOpacity>
          )}

          <View style={[styles.card, { backgroundColor: palette.card }]}> 
            <View style={styles.themeRow}>
              <View style={styles.themeTextWrap}>
                <Text style={[styles.toggleTitle, { color: palette.textPrimary }]}>Modo escuro</Text>
              </View>
              <Switch
                value={isDark}
                onValueChange={setDarkMode}
                thumbColor="#FFFFFF"
                trackColor={{ false: '#C7D8CD', true: '#2F8A53' }}
              />
            </View>
          </View>

          {/* Dados pessoais */}
          <View style={[styles.card, { backgroundColor: palette.card }]}> 
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Dados Pessoais</Text>

            <Text style={[styles.label, { color: palette.textSecondary }]}>Nome completo</Text>
            <TextInput
              style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.border, color: palette.textPrimary }]}
              value={form.full_name}
              onChangeText={v => update('full_name', v)}
              placeholder="Seu nome completo"
              placeholderTextColor={palette.textSecondary}
            />

            <Text style={[styles.label, { color: palette.textSecondary }]}>E-mail</Text>
            <View style={[styles.inputReadOnly, { backgroundColor: palette.readonly, borderColor: palette.border }]}>
              <Text style={[styles.inputReadOnlyText, { color: palette.textPrimary }]}>{email || '—'}</Text>
            </View>

            <Text style={[styles.label, { color: palette.textSecondary }]}>Telefone / WhatsApp</Text>
            <TextInput
              style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.border, color: palette.textPrimary }]}
              value={form.phone}
              onChangeText={v => update('phone', v)}
              placeholder="(00) 00000-0000"
              placeholderTextColor={palette.textSecondary}
              keyboardType="phone-pad"
            />
          </View>

          {/* Dados da empresa */}
          <View style={[styles.card, { backgroundColor: palette.card }]}> 
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Dados da Empresa</Text>

            <Text style={[styles.label, { color: palette.textSecondary }]}>Nome da empresa</Text>
            <TextInput
              style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.border, color: palette.textPrimary }]}
              value={form.company_name}
              onChangeText={v => update('company_name', v)}
              placeholder="Nome da sua empresa"
              placeholderTextColor={palette.textSecondary}
            />

            <Text style={[styles.label, { color: palette.textSecondary }]}>CNPJ</Text>
            <TextInput
              style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.border, color: palette.textPrimary }]}
              value={form.cnpj}
              onChangeText={v => update('cnpj', maskCNPJ(v))}
              placeholder="00.000.000/0000-00"
              placeholderTextColor={palette.textSecondary}
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
            <View style={[styles.card, { backgroundColor: palette.card }]}> 
              <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Nova Senha</Text>
              <Text style={[styles.label, { color: palette.textSecondary }]}>Nova senha</Text>
              <TextInput
                style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.border, color: palette.textPrimary }]}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Mínimo 6 caracteres"
                placeholderTextColor={palette.textSecondary}
                secureTextEntry
              />
              <Text style={[styles.label, { color: palette.textSecondary }]}>Confirmar nova senha</Text>
              <TextInput
                style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.border, color: palette.textPrimary }]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Repita a senha"
                placeholderTextColor={palette.textSecondary}
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

          <TouchableOpacity
            style={[styles.card, { backgroundColor: palette.card, alignItems: 'center', paddingVertical: 14 }]}
            onPress={() => {
              Alert.alert('Sair da conta', 'Deseja sair da sua conta?', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sair', style: 'destructive', onPress: () => signOut() },
              ]);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.sairText, { color: Colors.error }]}>Sair da conta</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteLink} onPress={handleDeleteAccount} activeOpacity={0.7}>
            <Text style={styles.deleteLinkText}>Excluir minha conta</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  header: {
    backgroundColor: Colors.primary,
    minHeight: 80,
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

  identityCard: {
    marginTop: 6,
    marginBottom: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityTextWrap: { flex: 1 },
  identityTitle: {
    fontSize: 18,
    color: Colors.textPrimary,
    fontWeight: '800',
    marginBottom: 2,
  },
  identitySubtitle: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '700',
    marginBottom: 4,
  },
  logoCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  logoImg: { width: 86, height: 86, borderRadius: 43 },
  logoLoadingWrap: { width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  logoInitials: { fontSize: 30, fontWeight: '800', color: Colors.white },
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
  logoHint: { fontSize: 12, color: Colors.textSecondary },
  adminIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  adminIcon: { fontSize: 20 },
  adminLabel: { fontSize: 15, fontWeight: '700' },
  adminHint: { fontSize: 12, marginTop: 2 },
  adminArrow: { fontSize: 20, color: Colors.textSecondary, fontWeight: '300' },

  // Cards
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '800',
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
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2D8A53',
  },
  saveBtnText: { color: Colors.white, fontWeight: '700', fontSize: 16 },

  togglePassBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 12,
  },
  togglePassText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },

  passBtn: {
    backgroundColor: Colors.primaryDark,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 12,
  },
  passBtnText: { color: Colors.white, fontWeight: '700', fontSize: 15 },

  sairText: { fontSize: 15, fontWeight: '700' },
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
