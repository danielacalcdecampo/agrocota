import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { importExcelProducts } from '../services/ExcelImportService';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'NovaCotacao'>; };

export default function NovaCotacaoScreen({ navigation }: Props) {
  const { session } = useAuth();
  const { isDark } = useThemeMode();
  const insets = useSafeAreaInsets();
  const [saving, setSaving]       = useState(false);
  const [importing, setImporting] = useState(false);

  const [titulo, setTitulo]             = useState('');
  const [obs, setObs]                   = useState('');
  const [tipoSafra, setTipoSafra]       = useState<'safra' | 'safrinha'>('safra');
  const [fazendaIdCot, setFazendaIdCot] = useState('');
  const [fazendas, setFazendas]         = useState<{ id: string; nome: string }[]>([]);
  const [modalFazenda, setModalFazenda] = useState(false);
  const [talhoes, setTalhoes]           = useState<{ id: string; nome: string; area_ha: number | null }[]>([]);
  const [talhaoIdCot, setTalhaoIdCot]   = useState('');
  const [areaCotacao, setAreaCotacao]   = useState('');
  const [modalTalhao, setModalTalhao]   = useState(false);

  // ─── Busca propriedades do consultor ────────────────────────────────────────
  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .from('fazendas')
      .select('id, nome')
      .eq('consultor_id', session.user.id)
      .order('nome')
      .then(({ data, error }) => {
        if (error) console.warn('[NovaCotacao] Erro ao buscar fazendas:', error.message);
        setFazendas((data ?? []) as { id: string; nome: string }[]);
      });
  }, [session?.user?.id]);

  // ─── Busca talhões ao selecionar propriedade ─────────────────────────────
  useEffect(() => {
    if (!fazendaIdCot) { setTalhoes([]); setTalhaoIdCot(''); setAreaCotacao(''); return; }
    supabase
      .from('talhoes')
      .select('id, nome, area_ha')
      .eq('fazenda_id', fazendaIdCot)
      .order('nome')
      .then(({ data }) => {
        const list = (data ?? []) as { id: string; nome: string; area_ha: number | null }[];
        setTalhoes(list);
        setTalhaoIdCot(prev => (prev && list.some(t => t.id === prev) ? prev : ''));
      });
  }, [fazendaIdCot]);

  // ─── Cores ────────────────────────────────────────────────────────────────
  const p = {
    pageBg:      isDark ? '#0F1712' : '#F3F6F4',
    headerBg:    isDark ? '#111D16' : '#0f4b1e',
    card:        isDark ? '#17241C' : '#FFFFFF',
    cardBorder:  isDark ? '#233020' : '#E6ECE8',
    text:        isDark ? '#E8F2EC' : '#0f1f13',
    label:       isDark ? '#7A9885' : '#4a6b53',
    inputBg:     isDark ? '#1D2F24' : '#f5faf6',
    inputBorder: isDark ? '#2A4133' : '#d6e8da',
    inputText:   isDark ? '#E8F2EC' : '#0f1f13',
    placeholder: isDark ? '#506A5A' : '#99b5a2',
    accent:      '#1a5c25',
    accentLight: '#3c7820',
    secondary:   '#ffb400',
    modalBg:     isDark ? '#17241C' : '#FFFFFF',
    modalBorder: isDark ? '#233020' : '#E6ECE8',
    sectionLabel: isDark ? '#5A7A62' : '#4a6b53',
  };

  // ─── Modal de seleção (bottom sheet) ─────────────────────────────────────
  const renderModal = (
    visible: boolean,
    onClose: () => void,
    title: string,
    data: { id: string; nome: string; extra?: string }[],
    selectedId: string,
    onSelect: (id: string, extra?: string) => void,
    emptyMsg: string,
  ) => (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 20), backgroundColor: p.modalBg }]}>
          <View style={[s.sheetHandle]} />
          <View style={[s.sheetHeader, { borderBottomColor: p.modalBorder }]}>
            <Text style={[s.sheetTitle, { color: p.text }]}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={[s.sheetDoneBtn, { backgroundColor: p.accent }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={s.sheetDoneText}>Fechar</Text>
            </TouchableOpacity>
          </View>

          {data.length === 0 ? (
            <View style={s.sheetEmpty}>
              <MaterialIcons name="info-outline" size={28} color={p.sectionLabel} />
              <Text style={[s.sheetEmptyText, { color: p.label }]}>{emptyMsg}</Text>
            </View>
          ) : (
            <FlatList
              data={data}
              keyExtractor={item => item.id}
              renderItem={({ item, index }) => {
                const sel = selectedId === item.id;
                return (
                  <TouchableOpacity
                    style={[
                      s.sheetRow,
                      index > 0 && { borderTopWidth: 1, borderTopColor: p.modalBorder },
                      sel && { backgroundColor: isDark ? '#1F3A28' : '#F0FBF2' },
                    ]}
                    onPress={() => { onSelect(item.id, item.extra); onClose(); }}
                    activeOpacity={0.65}
                  >
                    <View style={[s.radio, { borderColor: sel ? p.accent : p.inputBorder }]}>
                      {sel && <View style={[s.radioDot, { backgroundColor: p.accent }]} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.sheetItemText, { color: sel ? p.accent : p.text, fontWeight: sel ? '700' : '500' }]}>
                        {item.nome}
                      </Text>
                      {item.extra ? (
                        <Text style={[s.sheetItemExtra, { color: p.label }]}>{item.extra}</Text>
                      ) : null}
                    </View>
                    {sel && <MaterialIcons name="check" size={18} color={p.accent} />}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );

  // ─── Criar cotação manualmente ────────────────────────────────────────────
  const handleGerarLinkPlanilha = async () => {
    if (!titulo.trim()) { Alert.alert('Atenção', 'Informe um título para a cotação.'); return; }
    if (!session?.user?.id) return;
    setSaving(true);
    try {
      const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const { data: cotacaoData, error } = await supabase.from('cotacoes').insert({
        consultor_id:       session.user.id,
        titulo:             titulo.trim(),
        observacoes:        obs.trim() || null,
        status:             'em_montagem',
        approval_token:     token,
        fazenda_id:         fazendaIdCot || null,
        talhao_id:          talhaoIdCot  || null,
        area_ha:            areaCotacao  ? parseFloat(areaCotacao.replace(',', '.')) : null,
        tipo_safra:         tipoSafra,
        proposta_aceita_id: null,
      }).select('id').single();
      if (error) throw error;
      navigation.replace('Planilha', {
        cotacaoId:  cotacaoData.id,
        shareToken: token,
        titulo:     titulo.trim(),
        fazenda:    fazendaIdCot ? fazendas.find(f => f.id === fazendaIdCot)?.nome : undefined,
      });
    } catch (err: any) {
      Alert.alert('Erro ao criar', err?.message ?? 'Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Importar do Excel ────────────────────────────────────────────────────
  const handleImportExcel = async () => {
    if (!session?.user?.id) return;
    setImporting(true);
    try {
      const products = await importExcelProducts();
      if (!products || products.length === 0) {
        Alert.alert('Atenção', 'Nenhum produto foi importado.');
        return;
      }
      const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const { data: cotacaoData, error: cotacaoError } = await supabase
        .from('cotacoes')
        .insert({
          consultor_id:       session.user.id,
          titulo:             titulo.trim() || 'Cotação - Importada',
          observacoes:        obs.trim() || null,
          status:             'em_montagem',
          approval_token:     token,
          fazenda_id:         fazendaIdCot || null,
          talhao_id:          talhaoIdCot  || null,
          area_ha:            areaCotacao  ? parseFloat(areaCotacao.replace(',', '.')) : null,
          tipo_safra:         tipoSafra,
          proposta_aceita_id: null,
        })
        .select('id')
        .single();
      if (cotacaoError) throw cotacaoError;

      const itemsToInsert = products.map(p2 => {
        const extraInfo = [
          p2.ia         && `i.a.: ${p2.ia}`,
          p2.fonte      && `Fonte: ${p2.fonte}`,
          p2.tecnologia && `Tecnologia: ${p2.tecnologia}`,
          p2.alvo       && `Alvo: ${p2.alvo}`,
          p2.obs        && `Obs: ${p2.obs}`,
        ].filter(Boolean).join(' | ');
        return {
          cotacao_id:      cotacaoData.id,
          produto_nome:    p2.nome,
          categoria:       p2.cat,
          quantidade:      1,
          preco_unitario:  0,
          dose_ha:         parseFloat(p2.dose) || 0,
          unidade:         p2.unid   || null,
          n_aplicacoes:    parseFloat(p2.aplic) || 1,
          estagio:         p2.estadio || null,
          valor_ha:        0,
          principio_ativo: p2.ia      || null,
          fonte:           p2.fonte   || null,
          obs:             extraInfo  || null,
        };
      });

      const { error: itemsError } = await supabase.from('itens_cotacao').insert(itemsToInsert);
      if (itemsError) throw itemsError;

      Alert.alert('Sucesso!', `${products.length} produto(s) importado(s).`);
      navigation.replace('Planilha', {
        cotacaoId:  cotacaoData.id,
        shareToken: token,
        titulo:     titulo.trim() || 'Cotação - Importada',
        fazenda:    fazendaIdCot ? fazendas.find(f => f.id === fazendaIdCot)?.nome : undefined,
      });
    } catch (err: any) {
      Alert.alert('Erro na importação', err?.message ?? 'Tente novamente.');
    } finally {
      setImporting(false);
    }
  };

  const fazendaNome  = fazendas.find(f => f.id === fazendaIdCot)?.nome ?? '';
  const talhaoSel    = talhoes.find(t => t.id === talhaoIdCot);
  const talhaoLabel  = talhaoSel
    ? talhaoSel.area_ha ? `${talhaoSel.nome} · ${talhaoSel.area_ha} ha` : talhaoSel.nome
    : '';

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={p.headerBg} />

      {/* ─── Header padronizado ─────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + 14, backgroundColor: p.headerBg }]}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Nova Cotação</Text>
          <Text style={s.headerSub}>Preencha os dados da cotação</Text>
        </View>

        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1, backgroundColor: p.pageBg }}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ─── Seção: Identificação ─────────────────────────────────────── */}
        <Text style={[s.sectionLabel, { color: p.sectionLabel }]}>IDENTIFICAÇÃO</Text>

        <View style={[s.card, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
          <View style={s.fieldWrap}>
            <Text style={[s.label, { color: p.label }]}>Título da cotação *</Text>
            <TextInput
              style={[s.input, { backgroundColor: p.inputBg, borderColor: p.inputBorder, color: p.inputText }]}
              value={titulo}
              onChangeText={setTitulo}
              placeholder="Ex: Soja Safra 2025/26"
              placeholderTextColor={p.placeholder}
              autoCapitalize="words"
            />
          </View>

          <View style={s.fieldWrap}>
            <Text style={[s.label, { color: p.label }]}>Tipo de safra</Text>
            <View style={s.safraRow}>
              {(['safra', 'safrinha'] as const).map(tipo => {
                const ativo = tipoSafra === tipo;
                return (
                  <TouchableOpacity
                    key={tipo}
                    style={[
                      s.safraBtn,
                      {
                        borderColor:     ativo ? p.accent : p.inputBorder,
                        backgroundColor: ativo ? p.accent : p.inputBg,
                      },
                    ]}
                    onPress={() => setTipoSafra(tipo)}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.safraBtnText, { color: ativo ? '#fff' : p.label }]}>
                      {tipo.charAt(0).toUpperCase() + tipo.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* ─── Seção: Localização ───────────────────────────────────────── */}
        <Text style={[s.sectionLabel, { color: p.sectionLabel }]}>LOCALIZAÇÃO</Text>

        <View style={[s.card, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
          {/* Propriedade */}
          <View style={s.fieldWrap}>
            <Text style={[s.label, { color: p.label }]}>Propriedade</Text>
            <TouchableOpacity
              style={[s.selector, { backgroundColor: p.inputBg, borderColor: p.inputBorder }]}
              onPress={() => setModalFazenda(true)}
              activeOpacity={0.75}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialIcons
                  name="home-work"
                  size={18}
                  color={fazendaIdCot ? p.accent : p.placeholder}
                />
                <Text style={[s.selectorText, { color: fazendaIdCot ? p.inputText : p.placeholder }]}>
                  {fazendaIdCot ? fazendaNome : 'Selecionar propriedade...'}
                </Text>
              </View>
              <MaterialIcons name="keyboard-arrow-right" size={22} color={p.placeholder} />
            </TouchableOpacity>
            {fazendas.length === 0 && (
              <Text style={[s.fieldHint, { color: p.label }]}>
                Nenhuma propriedade cadastrada.{' '}
                <Text
                  style={{ color: p.accent, fontWeight: '700' }}
                  onPress={() => navigation.navigate('CadastrarPropriedade', {})}
                >
                  Cadastrar agora
                </Text>
              </Text>
            )}
          </View>

          {/* Talhão */}
          <View style={s.fieldWrap}>
            <Text style={[s.label, { color: p.label }]}>Talhão</Text>
            <TouchableOpacity
              style={[
                s.selector,
                { backgroundColor: p.inputBg, borderColor: p.inputBorder },
                !fazendaIdCot && { opacity: 0.45 },
              ]}
              onPress={() => fazendaIdCot && setModalTalhao(true)}
              disabled={!fazendaIdCot}
              activeOpacity={0.75}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialIcons
                  name="grass"
                  size={18}
                  color={talhaoIdCot ? p.accent : p.placeholder}
                />
                <Text style={[s.selectorText, { color: talhaoIdCot ? p.inputText : p.placeholder }]}>
                  {talhaoIdCot
                    ? talhaoLabel
                    : fazendaIdCot
                      ? 'Selecionar talhão...'
                      : 'Selecione a propriedade primeiro'}
                </Text>
              </View>
              <MaterialIcons name="keyboard-arrow-right" size={22} color={p.placeholder} />
            </TouchableOpacity>
          </View>

          {/* Área */}
          <View style={[s.fieldWrap, { marginBottom: 0 }]}>
            <Text style={[s.label, { color: p.label }]}>Área total (ha)</Text>
            <View style={s.inputRow}>
              <MaterialIcons name="crop-free" size={18} color={p.placeholder} style={s.inputIcon} />
              <TextInput
                style={[s.inputWithIcon, { backgroundColor: p.inputBg, borderColor: p.inputBorder, color: p.inputText }]}
                value={areaCotacao}
                onChangeText={setAreaCotacao}
                placeholder="Ex: 58"
                placeholderTextColor={p.placeholder}
                keyboardType="numeric"
              />
            </View>
          </View>
        </View>

        {/* ─── Seção: Observações ───────────────────────────────────────── */}
        <Text style={[s.sectionLabel, { color: p.sectionLabel }]}>OBSERVAÇÕES</Text>

        <View style={[s.card, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
          <TextInput
            style={[s.textarea, { backgroundColor: p.inputBg, borderColor: p.inputBorder, color: p.inputText }]}
            value={obs}
            onChangeText={setObs}
            placeholder="Notas internas, instruções para a revenda..."
            placeholderTextColor={p.placeholder}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* ─── Aviso ────────────────────────────────────────────────────── */}
        <View style={[s.banner, { backgroundColor: isDark ? '#162B1A' : '#EEF7EF', borderColor: isDark ? '#2E5033' : '#A8D5AA' }]}>
          <View style={[s.bannerIcon, { backgroundColor: p.accent }]}>
            <MaterialIcons name="info" size={14} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.bannerTitle, { color: isDark ? '#7EC882' : '#1B5E20' }]}>Um link por revenda</Text>
            <Text style={[s.bannerText,  { color: isDark ? '#5A8C5E' : '#2E7D32' }]}>
              Após montar os produtos, gere um link exclusivo para cada revenda. Nunca compartilhe o mesmo link com duas revendas.
            </Text>
          </View>
        </View>

        {/* ─── Ações ────────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[s.btnPrimary, { backgroundColor: p.accent, opacity: saving ? 0.65 : 1 }]}
          onPress={handleGerarLinkPlanilha}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <MaterialIcons name="edit-note" size={20} color="#fff" />
              <Text style={s.btnPrimaryText}>Criar cotação</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.btnSecondary, { borderColor: p.accent, opacity: importing ? 0.65 : 1 }]}
          onPress={handleImportExcel}
          disabled={importing}
          activeOpacity={0.85}
        >
          {importing ? (
            <ActivityIndicator color={p.accent} size="small" />
          ) : (
            <>
              <MaterialIcons name="upload-file" size={20} color={p.accent} />
              <Text style={[s.btnSecondaryText, { color: p.accent }]}>Importar Excel (.xlsx)</Text>
            </>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollView>

      {/* ─── Modal: Propriedades ──────────────────────────────────────────── */}
      {renderModal(
        modalFazenda,
        () => setModalFazenda(false),
        'Selecionar Propriedade',
        fazendas,
        fazendaIdCot,
        (id) => { setFazendaIdCot(id); setTalhaoIdCot(''); },
        'Nenhuma propriedade cadastrada.',
      )}

      {/* ─── Modal: Talhões ───────────────────────────────────────────────── */}
      {renderModal(
        modalTalhao,
        () => setModalTalhao(false),
        'Selecionar Talhão',
        talhoes.map(t => ({
          id:    t.id,
          nome:  t.nome,
          extra: t.area_ha ? `${t.area_ha} ha` : undefined,
        })),
        talhaoIdCot,
        (id) => {
          setTalhaoIdCot(id);
          const t = talhoes.find(x => x.id === id);
          if (t?.area_ha) setAreaCotacao(String(t.area_ha));
        },
        'Nenhum talhão cadastrado nesta propriedade.',
      )}
    </>
  );
}

const s = StyleSheet.create({
  // ─── Header ───────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.13)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle:  { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  headerSub:    { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 },

  // ─── Scroll ───────────────────────────────────────────────────────────────
  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  // ─── Section labels ───────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 4,
  },

  // ─── Card ─────────────────────────────────────────────────────────────────
  card: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
    marginBottom: 20,
    borderWidth: 1,
  },
  fieldWrap: { marginBottom: 16 },

  // ─── Label ────────────────────────────────────────────────────────────────
  label: { fontSize: 12, fontWeight: '600', marginBottom: 8, letterSpacing: 0.1 },
  fieldHint: { fontSize: 12, marginTop: 6 },

  // ─── Input ────────────────────────────────────────────────────────────────
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    fontSize: 15,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  inputIcon: { position: 'absolute', left: 14, zIndex: 1 },
  inputWithIcon: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingLeft: 44,
    height: 50,
    fontSize: 15,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 14,
    fontSize: 15,
    minHeight: 90,
    marginBottom: 12,
  },

  // ─── Selector ─────────────────────────────────────────────────────────────
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
  },
  selectorText: { fontSize: 15, flex: 1 },

  // ─── Safra toggle ─────────────────────────────────────────────────────────
  safraRow: { flexDirection: 'row', gap: 10 },
  safraBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safraBtnText: { fontSize: 14, fontWeight: '600' },

  // ─── Banner ───────────────────────────────────────────────────────────────
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  bannerIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  bannerTitle: { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  bannerText:  { fontSize: 12, lineHeight: 18 },

  // ─── Botões ───────────────────────────────────────────────────────────────
  btnPrimary: {
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  btnPrimaryText:   { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnSecondary: {
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  btnSecondaryText: { fontSize: 15, fontWeight: '700' },

  // ─── Modal / bottom sheet ─────────────────────────────────────────────────
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '72%',
    overflow: 'hidden',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.18)',
    marginTop: 10,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  sheetTitle:     { fontSize: 16, fontWeight: '700' },
  sheetDoneBtn:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  sheetDoneText:  { fontSize: 13, fontWeight: '700', color: '#fff' },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    gap: 14,
  },
  sheetItemText:  { fontSize: 15 },
  sheetItemExtra: { fontSize: 12, marginTop: 2 },
  sheetEmpty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  sheetEmptyText: { fontSize: 14, textAlign: 'center' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
