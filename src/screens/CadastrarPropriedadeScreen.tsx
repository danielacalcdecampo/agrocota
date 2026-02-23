import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  StatusBar, TextInput, Alert, ActivityIndicator, Platform,
  KeyboardAvoidingView, Modal, FlatList,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, MapPressEvent } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../navigation/AppNavigator';

// -------------------------------------------------
// Types
// -------------------------------------------------

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CadastrarPropriedade'>;
  route: RouteProp<RootStackParamList, 'CadastrarPropriedade'>;
};

interface IBGEMunicipio {
  id: number;
  nome: string;
  microrregiao: { mesorregiao: { UF: { sigla: string; nome: string } } };
}

// -------------------------------------------------
// Constants
// -------------------------------------------------

const CULTURAS_LISTA = [
  'Soja', 'Milho', 'Algodao', 'Feijao', 'Trigo',
  'Cana-de-acucar', 'Cafe', 'Arroz', 'Sorgo', 'Pastagem',
  'Girassol', 'Amendoim', 'Milheto', 'Gergelim', 'Mandioca',
];

// Module-level cache -- fetched once per app session
let _ibgeCache: IBGEMunicipio[] | null = null;

async function fetchIBGE(): Promise<IBGEMunicipio[]> {
  if (_ibgeCache) return _ibgeCache;
  const res = await fetch(
    'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome',
  );
  _ibgeCache = await res.json();
  return _ibgeCache!;
}

function normAccent(str: string) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// -------------------------------------------------
// Screen
// -------------------------------------------------

export default function CadastrarPropriedadeScreen({ navigation, route }: Props) {
  const { session } = useAuth();
  const { fazendaId } = route.params ?? {};
  const isEdit = !!fazendaId;
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();

  // Form
  const [produtorNome, setProdutorNome] = useState('');
  const [produtorPhone, setProdutorPhone] = useState('');
  const [produtorEmail, setProdutorEmail] = useState('');
  const [fazendaNome, setFazendaNome] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [estado, setEstado] = useState('');
  const [areaHa, setAreaHa] = useState('');
  const [observacoes, setObservacoes] = useState('');

  // Autocomplete
  const [sugestoes, setSugestoes] = useState<IBGEMunicipio[]>([]);
  const [cidadeLoading, setCidadeLoading] = useState(false);
  const [showSugestoes, setShowSugestoes] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Location
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // Culturas
  const [culturas, setCulturas] = useState<string[]>([]);
  const [culturasModal, setCulturasModal] = useState(false);
  const [customCultura, setCustomCultura] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  // UI
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(isEdit);

  // Pre-warm IBGE cache silently
  useEffect(() => { fetchIBGE().catch(() => {}); }, []);

  // Auto GPS on first cadastro
  useEffect(() => { if (!isEdit) { obterGPS(); } }, []);

  // Load data when editing
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const { data } = await supabase
        .from('fazendas')
        .select('*, culturas_fazenda(nome)')
        .eq('id', fazendaId)
        .single();
      if (data) {
        setProdutorNome(data.produtor_nome ?? '');
        setProdutorPhone(data.produtor_phone ?? '');
        setProdutorEmail(data.produtor_email ?? '');
        setFazendaNome(data.nome ?? '');
        setMunicipio(data.municipio ?? '');
        setEstado(data.estado ?? '');
        setAreaHa(data.area_total_ha?.toString() ?? '');
        setObservacoes(data.observacoes ?? '');
        setLatitude(data.latitude ?? null);
        setLongitude(data.longitude ?? null);
        const cults = (data.culturas_fazenda as { nome: string }[]) ?? [];
        setCulturas(cults.map(c => c.nome));
      }
      setLoadingData(false);
    })();
  }, [isEdit, fazendaId]);

  // --- GPS ---

  const obterGPS = useCallback(async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permissao negada', 'Ative a localizacao nas configuracoes do dispositivo.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude: lat, longitude: lng } = loc.coords;
      setLatitude(lat);
      setLongitude(lng);
      mapRef.current?.animateToRegion(
        { latitude: lat, longitude: lng, latitudeDelta: 0.05, longitudeDelta: 0.05 },
        800,
      );
    } catch {
      Alert.alert('Erro', 'Nao foi possivel obter a localizacao.');
    } finally {
      setGpsLoading(false);
    }
  }, []);

  // --- City autocomplete ---

  const onCidadeChange = useCallback((texto: string) => {
    setMunicipio(texto);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (texto.length < 2) { setShowSugestoes(false); setSugestoes([]); return; }
    setCidadeLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const all = await fetchIBGE();
        const q = normAccent(texto);
        const filtered = all
          .filter(m => normAccent(m.nome).startsWith(q))
          .slice(0, 3);
        setSugestoes(filtered);
        setShowSugestoes(filtered.length > 0);
      } catch {
        setShowSugestoes(false);
      } finally {
        setCidadeLoading(false);
      }
    }, 300);
  }, []);

  const selecionarCidade = (m: IBGEMunicipio) => {
    setMunicipio(m.nome);
    setEstado(m.microrregiao.mesorregiao.UF.sigla);
    setSugestoes([]);
    setShowSugestoes(false);
  };

  // --- Culturas ---

  const toggleCultura = (nome: string) =>
    setCulturas(prev => prev.includes(nome) ? prev.filter(c => c !== nome) : [...prev, nome]);

  const removerCultura = (nome: string) =>
    setCulturas(prev => prev.filter(c => c !== nome));

  const adicionarCustom = () => {
    const n = customCultura.trim();
    if (!n) return;
    if (!culturas.includes(n)) setCulturas(prev => [...prev, n]);
    setCustomCultura('');
    setShowCustomInput(false);
  };

  // --- Save ---

  const salvar = async () => {
    if (!fazendaNome.trim()) { Alert.alert('Atencao', 'Nome da fazenda e obrigatorio.'); return; }
    if (!session?.user?.id) return;
    setSaving(true);
    try {
      const payload = {
        nome: fazendaNome.trim(),
        produtor_nome: produtorNome.trim() || null,
        produtor_phone: produtorPhone.trim() || null,
        produtor_email: produtorEmail.trim() || null,
        municipio: municipio.trim() || null,
        estado: estado.trim().toUpperCase() || null,
        area_total_ha: areaHa ? parseFloat(areaHa) : null,
        cultura_principal: culturas[0] ?? null,
        observacoes: observacoes.trim() || null,
        latitude,
        longitude,
        consultor_id: session.user.id,
      };
      let fid = fazendaId;
      if (isEdit) {
        await supabase.from('fazendas').update(payload).eq('id', fazendaId);
      } else {
        const { data, error } = await supabase.from('fazendas').insert(payload).select('id').single();
        if (error || !data) throw error;
        fid = data.id;
      }
      if (fid) {
        await supabase.from('culturas_fazenda').delete().eq('fazenda_id', fid);
        if (culturas.length > 0) {
          await supabase.from('culturas_fazenda').insert(
            culturas.map(nome => ({ fazenda_id: fid, nome })),
          );
        }
      }
      if (fid) navigation.replace('DetalhePropriedade', { fazendaId: fid });
      else navigation.goBack();
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  // --- Render ---

  if (loadingData) {
    return <View style={s.loadingRoot}><ActivityIndicator size="large" color="#2E7D32" /></View>;
  }

  const initialRegion = {
    latitude: latitude ?? -15.0,
    longitude: longitude ?? -54.0,
    latitudeDelta: latitude ? 0.07 : 28,
    longitudeDelta: longitude ? 0.07 : 28,
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8}>
          <Text style={s.backTxt}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isEdit ? 'Editar Propriedade' : 'Nova Propriedade'}</Text>
        <TouchableOpacity style={s.saveBtn} onPress={salvar} disabled={saving} activeOpacity={0.8}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveTxt}>Salvar</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 60 }]} keyboardShouldPersistTaps="handled">

        {/* Produtor */}
        <Text style={s.sectionLabel}>Produtor</Text>
        <View style={s.card}>
          <Field label="Nome" value={produtorNome} onChangeText={setProdutorNome} placeholder="Nome do produtor" />
          <HDivider />
          <Field label="Telefone / WhatsApp" value={produtorPhone} onChangeText={setProdutorPhone}
            placeholder="(66) 99999-9999" keyboardType="phone-pad" autoCapitalize="none" />
          <HDivider />
          <Field label="E-mail" value={produtorEmail} onChangeText={setProdutorEmail}
            placeholder="email@dominio.com" keyboardType="email-address" autoCapitalize="none" />
        </View>

        {/* Fazenda */}
        <Text style={s.sectionLabel}>Fazenda</Text>
        <View style={s.card}>
          <Field label="Nome da fazenda *" value={fazendaNome} onChangeText={setFazendaNome} placeholder="Fazenda Boa Vista" />
          <HDivider />

          {/* Municipio com autocomplete IBGE */}
          <View style={s.field}>
            <Text style={s.fieldLabel}>Municipio</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                style={[s.fieldInput, { flex: 1 }]}
                value={municipio}
                onChangeText={onCidadeChange}
                placeholder="Digite a cidade..."
                placeholderTextColor="#bbb"
                autoCapitalize="words"
                autoCorrect={false}
                onBlur={() => setTimeout(() => setShowSugestoes(false), 200)}
              />
              {cidadeLoading && (
                <ActivityIndicator size="small" color="#2E7D32" style={{ marginLeft: 8 }} />
              )}
            </View>
          </View>

          {/* Dropdown sugestoes */}
          {showSugestoes && sugestoes.length > 0 && (
            <View style={s.suggestionsBox}>
              {sugestoes.map((m, idx) => (
                <TouchableOpacity
                  key={m.id}
                  style={[s.suggestionRow, idx > 0 && { borderTopWidth: 1, borderTopColor: '#F0F2F0' }]}
                  onPress={() => selecionarCidade(m)}
                  activeOpacity={0.7}
                >
                  <Text style={s.suggestionCity}>{m.nome}</Text>
                  <Text style={s.suggestionState}> - {m.microrregiao.mesorregiao.UF.sigla}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <HDivider />
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Field label="Estado" value={estado} onChangeText={setEstado} placeholder="MT"
                maxLength={2} autoCapitalize="characters" />
            </View>
            <View style={s.vDivider} />
            <View style={{ flex: 2 }}>
              <Field label="Area total (ha)" value={areaHa} onChangeText={setAreaHa}
                placeholder="1500" keyboardType="numeric" autoCapitalize="none" />
            </View>
          </View>
          <HDivider />
          <Field label="Observacoes" value={observacoes} onChangeText={setObservacoes}
            placeholder="Informacoes adicionais sobre a propriedade..." multiline />
        </View>

        {/* Culturas */}
        <Text style={s.sectionLabel}>Culturas</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.selectorRow} onPress={() => setCulturasModal(true)} activeOpacity={0.8}>
            <Text style={[s.selectorTxt, culturas.length === 0 && { color: '#bbb' }]}>
              {culturas.length === 0 ? 'Selecionar culturas...' : culturas.join(', ')}
            </Text>
            <Text style={s.selectorArrow}>{'>'}</Text>
          </TouchableOpacity>
          {culturas.length > 0 && (
            <>
              <HDivider />
              <View style={s.chipsWrap}>
                {culturas.map(c => (
                  <TouchableOpacity key={c} style={s.chipSel} onPress={() => removerCultura(c)} activeOpacity={0.8}>
                    <Text style={s.chipSelTxt}>{c}  x</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>

        {/* Localizacao */}
        <Text style={s.sectionLabel}>Localizacao</Text>
        <View style={s.card}>
          <View style={s.locRow}>
            <Text style={s.coordsTxt}>
              {latitude != null && longitude != null
                ? `${latitude.toFixed(6)},  ${longitude.toFixed(6)}`
                : 'Localizacao nao definida'}
            </Text>
            <TouchableOpacity style={s.gpsBtn} onPress={obterGPS} disabled={gpsLoading} activeOpacity={0.8}>
              {gpsLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.gpsBtnTxt}>Minha Localizacao</Text>}
            </TouchableOpacity>
          </View>
          <Text style={s.mapHint}>Toque no mapa para ajustar a posicao</Text>
          <MapView
            ref={mapRef}
            style={s.map}
            provider={PROVIDER_GOOGLE}
            mapType="hybrid"
            initialRegion={initialRegion}
            onPress={(e: MapPressEvent) => {
              setLatitude(e.nativeEvent.coordinate.latitude);
              setLongitude(e.nativeEvent.coordinate.longitude);
            }}
          >
            {latitude != null && longitude != null && (
              <Marker
                coordinate={{ latitude, longitude }}
                title="Localizacao da fazenda"
                pinColor="#76FF03"
              />
            )}
          </MapView>
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* Modal Culturas */}
      <Modal
        visible={culturasModal}
        animationType="slide"
        transparent
        onRequestClose={() => { setCulturasModal(false); setShowCustomInput(false); }}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Culturas</Text>
              <TouchableOpacity onPress={() => { setCulturasModal(false); setShowCustomInput(false); }}>
                <Text style={s.modalDone}>Pronto</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={CULTURAS_LISTA}
              keyExtractor={item => item}
              style={{ maxHeight: 380 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const sel = culturas.includes(item);
                return (
                  <TouchableOpacity style={s.culturaRow} onPress={() => toggleCultura(item)} activeOpacity={0.8}>
                    <View style={[s.checkbox, sel && s.checkboxSel]}>
                      {sel && <Text style={s.checkmark}>v</Text>}
                    </View>
                    <Text style={[s.culturaRowTxt, sel && s.culturaRowTxtSel]}>{item}</Text>
                  </TouchableOpacity>
                );
              }}
              ListFooterComponent={
                <View>
                  <View style={s.modalDivider} />
                  {showCustomInput ? (
                    <View style={s.customRow}>
                      <TextInput
                        style={s.customInput}
                        value={customCultura}
                        onChangeText={setCustomCultura}
                        placeholder="Nome da cultura..."
                        placeholderTextColor="#bbb"
                        autoFocus
                        autoCapitalize="words"
                        onSubmitEditing={adicionarCustom}
                        returnKeyType="done"
                      />
                      <TouchableOpacity style={s.customAddBtn} onPress={adicionarCustom} activeOpacity={0.8}>
                        <Text style={s.customAddTxt}>Adicionar</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={s.culturaRow} onPress={() => setShowCustomInput(true)} activeOpacity={0.8}>
                      <Text style={s.outrasBtn}>+ Outras culturas</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// -------------------------------------------------
// Sub-components
// -------------------------------------------------

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, maxLength, autoCapitalize }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string;
  keyboardType?: any; multiline?: boolean; maxLength?: number; autoCapitalize?: any;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={[s.fieldInput, multiline && { height: 72, textAlignVertical: 'top', paddingTop: 2 }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#bbb"
        keyboardType={keyboardType}
        multiline={multiline}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize ?? 'words'}
        autoCorrect={false}
      />
    </View>
  );
}

function HDivider() {
  return <View style={{ height: 1, backgroundColor: '#F0F2F0', marginLeft: 16 }} />;
}

// -------------------------------------------------
// Styles
// -------------------------------------------------

const s = StyleSheet.create({
  loadingRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F7F5' },

  header: {
    backgroundColor: '#1F4E1F', paddingTop: 14, paddingBottom: 14, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    minWidth: 88, alignItems: 'center',
  },
  backTxt: { color: '#A5D6A7', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  saveBtn: {
    backgroundColor: '#4CAF50', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, minWidth: 64, alignItems: 'center',
  },
  saveTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 60 },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: '#2E7D32', textTransform: 'uppercase',
    letterSpacing: 1.2, marginTop: 24, marginBottom: 8, marginLeft: 4,
  },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E8EDE8', overflow: 'hidden' },
  row: { flexDirection: 'row' },
  vDivider: { width: 1, backgroundColor: '#F0F2F0' },

  field: { paddingHorizontal: 16, paddingVertical: 13 },
  fieldLabel: {
    fontSize: 11, color: '#999', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5,
  },
  fieldInput: { fontSize: 15, color: '#1a1a1a', paddingVertical: 0 },

  suggestionsBox: { backgroundColor: '#FAFCFA', borderTopWidth: 1, borderTopColor: '#E8EDE8' },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  suggestionCity: { fontSize: 15, color: '#1a1a1a', fontWeight: '600' },
  suggestionState: { fontSize: 15, color: '#888' },

  selectorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  selectorTxt: { fontSize: 15, color: '#1a1a1a', flex: 1 },
  selectorArrow: { fontSize: 20, color: '#bbb', marginLeft: 8 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  chipSel: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#2E7D32' },
  chipSelTxt: { fontSize: 13, color: '#fff', fontWeight: '600' },

  locRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  coordsTxt: {
    flex: 1, fontSize: 12, color: '#666',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  gpsBtn: {
    backgroundColor: '#1565C0', paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 10, minWidth: 80, alignItems: 'center',
  },
  gpsBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },
  mapHint: { fontSize: 11, color: '#bbb', textAlign: 'center', marginBottom: 4 },
  map: { height: 300 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: {
    backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingBottom: 34, maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: '#F0F2F0',
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1A2E1A' },
  modalDone: { fontSize: 15, color: '#2E7D32', fontWeight: '700' },
  modalDivider: { height: 1, backgroundColor: '#F0F2F0', marginVertical: 4 },

  culturaRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: '#F8F8F8',
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#ddd',
    marginRight: 14, alignItems: 'center', justifyContent: 'center',
  },
  checkboxSel: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  checkmark: { color: '#fff', fontSize: 11, fontWeight: '800' },
  culturaRowTxt: { fontSize: 15, color: '#555' },
  culturaRowTxtSel: { color: '#1F4E1F', fontWeight: '700' },
  outrasBtn: { fontSize: 15, color: '#2E7D32', fontWeight: '700' },

  customRow: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  customInput: {
    flex: 1, backgroundColor: '#F5F7F5', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#222',
  },
  customAddBtn: { backgroundColor: '#2E7D32', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  customAddTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
