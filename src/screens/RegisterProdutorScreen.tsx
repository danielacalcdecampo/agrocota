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
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { Colors } from '../theme/colors';

type LocalStack = { RegisterProdutor: undefined; Login: undefined };

type Props = {
  navigation: NativeStackNavigationProp<LocalStack, 'RegisterProdutor'>;
};

const ESTADOS_BR = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO',
  'MA','MT','MS','MG','PA','PB','PR','PE','PI',
  'RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

export default function RegisterProdutorScreen({ navigation }: Props) {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    // Dados da fazenda (opcional no cadastro — pode ser adicionada depois pelo consultor)
    fazenda_nome: '',
    municipio: '',
    estado: '',
    area_total_ha: '',
    cultura_principal: '',
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showFazenda, setShowFazenda] = useState(false);

  const update = (field: keyof typeof form, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const validate = () => {
    if (!form.full_name.trim()) return 'Informe seu nome completo.';
    if (!form.email.trim()) return 'Informe seu e-mail.';
    if (!/\S+@\S+\.\S+/.test(form.email)) return 'E-mail inválido.';
    if (!form.phone.trim()) return 'Informe seu telefone/WhatsApp.';
    if (form.password.length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
    if (form.password !== form.confirmPassword) return 'As senhas não coincidem.';
    if (showFazenda) {
      if (!form.fazenda_nome.trim()) return 'Informe o nome da fazenda.';
      if (form.estado && !ESTADOS_BR.includes(form.estado.toUpperCase()))
        return 'Estado inválido (use sigla, ex: SP).';
    }
    return null;
  };

  const handleRegister = async () => {
    const error = validate();
    if (error) { Alert.alert('Atenção', error); return; }

    setLoading(true);

    // 1. Criar usuário no Supabase Auth
    const { data, error: authError } = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
    });

    if (authError || !data.user) {
      setLoading(false);
      Alert.alert('Erro ao cadastrar', authError?.message ?? 'Erro desconhecido.');
      return;
    }

    // 2. Inserir perfil
    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      role: 'produtor',
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
    });

    if (profileError) {
      setLoading(false);
      Alert.alert('Erro ao salvar perfil', profileError.message);
      return;
    }

    // 3. Inserir fazenda (se informada)
    if (showFazenda && form.fazenda_nome.trim()) {
      const fazendaData: Record<string, any> = {
        nome: form.fazenda_nome.trim(),
        produtor_id: data.user.id,
      };
      if (form.municipio.trim()) fazendaData.municipio = form.municipio.trim();
      if (form.estado.trim()) fazendaData.estado = form.estado.trim().toUpperCase();
      if (form.area_total_ha.trim()) fazendaData.area_total_ha = parseFloat(form.area_total_ha);
      if (form.cultura_principal.trim()) fazendaData.cultura_principal = form.cultura_principal.trim();

      await supabase.from('fazendas').insert(fazendaData);
      // Não bloqueia o fluxo se a fazenda falhar — pode ser adicionada depois
    }

    setLoading(false);

    // O AuthContext detecta a sessão e navega automaticamente
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.backIcon}>‹  Voltar</Text>
          </TouchableOpacity>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>🚜 Produtor Rural</Text>
          </View>
          <Text style={styles.title}>Criar conta</Text>
          <Text style={styles.subtitle}>
            Preencha seus dados para visualizar cotações e relatórios da sua fazenda.
          </Text>
        </View>

        {/* Dados do Usuário */}
        <View style={styles.form}>
          <Text style={styles.sectionTitle}>Dados Pessoais</Text>

          <Field label="Nome Completo *">
            <TextInput
              style={styles.input}
              placeholder="Ex: Carlos Ferreira"
              placeholderTextColor={Colors.textSecondary}
              value={form.full_name}
              onChangeText={v => update('full_name', v)}
              autoCapitalize="words"
              textContentType="name"
            />
          </Field>

          <Field label="E-mail *">
            <TextInput
              style={styles.input}
              placeholder="seu@email.com"
              placeholderTextColor={Colors.textSecondary}
              value={form.email}
              onChangeText={v => update('email', v)}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
            />
          </Field>

          <Field label="Telefone / WhatsApp *">
            <TextInput
              style={styles.input}
              placeholder="(99) 99999-9999"
              placeholderTextColor={Colors.textSecondary}
              value={form.phone}
              onChangeText={v => update('phone', v)}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
            />
          </Field>

          <Field label="Senha *">
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Mínimo 6 caracteres"
                placeholderTextColor={Colors.textSecondary}
                value={form.password}
                onChangeText={v => update('password', v)}
                secureTextEntry={!showPassword}
                textContentType="newPassword"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Text>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>
          </Field>

          <Field label="Confirmar Senha *">
            <TextInput
              style={[
                styles.input,
                form.confirmPassword && form.password !== form.confirmPassword
                  ? styles.inputError
                  : null,
              ]}
              placeholder="Repita a senha"
              placeholderTextColor={Colors.textSecondary}
              value={form.confirmPassword}
              onChangeText={v => update('confirmPassword', v)}
              secureTextEntry={!showPassword}
              textContentType="newPassword"
            />
            {form.confirmPassword !== '' && form.password !== form.confirmPassword && (
              <Text style={styles.errorText}>Senhas não coincidem</Text>
            )}
          </Field>

          {/* Seção Fazenda (opcional) */}
          <TouchableOpacity
            style={styles.fazendaToggle}
            onPress={() => setShowFazenda(!showFazenda)}
            activeOpacity={0.7}
          >
            <Text style={styles.fazendaToggleText}>
              {showFazenda ? '▼' : '▶'} Adicionar dados da fazenda agora{' '}
              <Text style={styles.optionalTag}>(opcional)</Text>
            </Text>
          </TouchableOpacity>

          {showFazenda && (
            <View style={styles.fazendaSection}>
              <Text style={styles.sectionTitle}>Dados da Fazenda</Text>

              <Field label="Nome da Fazenda *">
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Fazenda São João"
                  placeholderTextColor={Colors.textSecondary}
                  value={form.fazenda_nome}
                  onChangeText={v => update('fazenda_nome', v)}
                  autoCapitalize="words"
                />
              </Field>

              <View style={styles.row}>
                <View style={styles.rowFlex2}>
                  <Field label="Município">
                    <TextInput
                      style={styles.input}
                      placeholder="Ex: Ribeirão Preto"
                      placeholderTextColor={Colors.textSecondary}
                      value={form.municipio}
                      onChangeText={v => update('municipio', v)}
                      autoCapitalize="words"
                    />
                  </Field>
                </View>
                <View style={[styles.rowFlex1, { marginLeft: 10 }]}>
                  <Field label="Estado">
                    <TextInput
                      style={styles.input}
                      placeholder="SP"
                      placeholderTextColor={Colors.textSecondary}
                      value={form.estado}
                      onChangeText={v => update('estado', v.toUpperCase())}
                      autoCapitalize="characters"
                      maxLength={2}
                    />
                  </Field>
                </View>
              </View>

              <View style={styles.row}>
                <View style={[styles.rowFlex1]}>
                  <Field label="Área Total (ha)">
                    <TextInput
                      style={styles.input}
                      placeholder="0.00"
                      placeholderTextColor={Colors.textSecondary}
                      value={form.area_total_ha}
                      onChangeText={v => update('area_total_ha', v)}
                      keyboardType="decimal-pad"
                    />
                  </Field>
                </View>
                <View style={[styles.rowFlex2, { marginLeft: 10 }]}>
                  <Field label="Cultura Principal">
                    <TextInput
                      style={styles.input}
                      placeholder="Ex: Soja, Milho"
                      placeholderTextColor={Colors.textSecondary}
                      value={form.cultura_principal}
                      onChangeText={v => update('cultura_principal', v)}
                      autoCapitalize="words"
                    />
                  </Field>
                </View>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.submitButtonText}>Criar Conta de Produtor</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.loginLink}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.loginLinkText}>
              Já tem conta? <Text style={styles.loginLinkBold}>Entrar</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={fieldStyles.label}>{label}</Text>
      {children}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 56, paddingBottom: 40 },
  header: { marginBottom: 24 },
  backButton: {
    alignSelf: 'flex-start', marginBottom: 16,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#C8E6C9',
    minWidth: 96, alignItems: 'center',
  },
  backIcon: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  headerBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.secondary + '22',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.secondary,
  },
  headerBadgeText: { color: Colors.secondary, fontSize: 13, fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '700', color: Colors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  form: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 24,
    shadowColor: Colors.black, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: Colors.primaryDark,
    marginBottom: 16, borderBottomWidth: 1, borderColor: Colors.border, paddingBottom: 8,
  },
  input: {
    backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 15, color: Colors.textPrimary,
  },
  inputError: { borderColor: Colors.error },
  errorText: { color: Colors.error, fontSize: 12, marginTop: 4 },
  passwordContainer: {
    flexDirection: 'row', backgroundColor: Colors.inputBg,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10, alignItems: 'center',
  },
  passwordInput: {
    flex: 1, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 15, color: Colors.textPrimary,
  },
  eyeButton: { paddingHorizontal: 12 },
  fazendaToggle: {
    backgroundColor: Colors.primaryLight + '15',
    borderRadius: 8, padding: 12, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.primaryLight + '40',
  },
  fazendaToggleText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  optionalTag: { color: Colors.textSecondary, fontWeight: '400' },
  fazendaSection: {
    borderTopWidth: 1, borderColor: Colors.border, paddingTop: 16, marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  rowFlex1: { flex: 1 },
  rowFlex2: { flex: 2 },
  submitButton: {
    backgroundColor: Colors.secondary, borderRadius: 10, paddingVertical: 15,
    alignItems: 'center', marginTop: 8,
    shadowColor: Colors.secondary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  submitButtonText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  loginLink: { alignItems: 'center', marginTop: 16 },
  loginLinkText: { color: Colors.textSecondary, fontSize: 14 },
  loginLinkBold: { color: Colors.primary, fontWeight: '700' },
});
