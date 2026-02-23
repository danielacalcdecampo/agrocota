import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  StatusBar, TextInput, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, Modal, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'NovoPlantio'>;
  route: RouteProp<RootStackParamList, 'NovoPlantio'>;
};

const CULTURAS = [
  'Soja', 'Milho', 'Algodao', 'Feijao', 'Trigo',
  'Cana-de-acucar', 'Cafe', 'Arroz', 'Sorgo', 'Pastagem',
  'Girassol', 'Amendoim', 'Milheto', 'Gergelim', 'Mandioca',
];

const SISTEMAS = [
  'Plantio Direto', 'Convencional', 'Cultivo Minimo',
  'Organico', 'ILP', 'ILPF',
];

function parseDate(ddmmyyyy: string): string | null {
  const parts = ddmmyyyy.trim().split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  if (!d || !m || !y || y.length !== 4) return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  if (isNaN(Date.parse(iso))) return null;
  return iso;
}

function formatBR(isoDate: string | null): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

interface Talhao { id: string; nome: string; area_ha: number | null; }

// Reusable bottom-sheet picker
function PickerModal({
  visible, title, options, selected, onSelect, onClose,
}: {
  visible: boolean;
  title: string;
  options: { label: string; value: string }[];
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={pm.overlay}>
        <View style={[pm.card, { paddingBottom: insets.bottom + 16 }]}>
          <View style={pm.header}>
            <Text style={pm.title}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={pm.done}>Pronto</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={options}
            keyExtractor={i => i.value || '__geral__'}
            style={{ maxHeight: 380 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => {
              const sel = selected === item.value;
              return (
                <TouchableOpacity
                  style={[pm.row, index > 0 && pm.rowBorder]}
                  onPress={() => { onSelect(item.value); onClose(); }}
                  activeOpacity={0.75}
                >
                  <View style={[pm.radio, sel && pm.radioSel]}>
                    {sel && <View style={pm.radioDot} />}
                  </View>
                  <Text style={[pm.rowTxt, sel && pm.rowTxtSel]}>{item.label}</Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const pm = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  card: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '78%',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 22, paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: '#F0F2F0',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#1A2E1A' },
  done: { fontSize: 15, color: '#2E7D32', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 15 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F5F5F5' },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ccc',
    marginRight: 14, alignItems: 'center', justifyContent: 'center',
  },
  radioSel: { borderColor: '#2E7D32' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E7D32' },
  rowTxt: { fontSize: 16, color: '#444' },
  rowTxtSel: { color: '#1F4E1F', fontWeight: '700' },
});

// Main Screen
export default function NovoPlantioScreen({ navigation, route }: Props) {
  const { fazendaId, plantioId } = route.params;
  const isEdit = !!plantioId;
  const insets = useSafeAreaInsets();

  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [talhaoSel, setTalhaoSel] = useState<string>('');
  const [cultura, setCultura] = useState('');
  const [culturaCustom, setCulturaCustom] = useState('');
  const [sistema, setSistema] = useState('');
  const [safra, setSafra] = useState('');
  const [dataPlantio, setDataPlantio] = useState('');
  const [dataColheita, setDataColheita] = useState('');
  const [variedade, setVariedade] = useState('');
  const [populacao, setPopulacao] = useState('');
  const [produtividade, setProdutividade] = useState('');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  const [modalCultura, setModalCultura] = useState(false);
  const [modalSistema, setModalSistema] = useState(false);
  const [modalTalhao, setModalTalhao] = useState(false);

  useEffect(() => {
    supabase.from('talhoes').select('id,nome,area_ha').eq('fazenda_id', fazendaId).then(({ data }) => {
      setTalhoes((data ?? []) as Talhao[]);
    });
  }, [fazendaId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const { data } = await supabase.from('sistema_plantio').select('*').eq('id', plantioId).single();
      if (data) {
        setTalhaoSel(data.talhao_id ?? '');
        const c = data.cultura ?? '';
        if (c && !CULTURAS.includes(c)) {
          setCultura('__custom__');
          setCulturaCustom(c);
        } else {
          setCultura(c);
        }
        setSistema(data.sistema_plantio ?? '');
        setSafra(data.safra ?? '');
        setDataPlantio(formatBR(data.data_plantio));
        setDataColheita(formatBR(data.data_colheita));
        setVariedade(data.variedade ?? '');
        setPopulacao(data.populacao_ha?.toString() ?? '');
        setProdutividade(data.produtividade?.toString() ?? '');
        setObs(data.obs ?? '');
      }
      setLoading(false);
    })();
  }, [isEdit, plantioId]);

  const culturaDisplay = cultura === '__custom__'
    ? (culturaCustom || 'Outra...')
    : (cultura || 'Selecionar cultura...');

  const sistemaDisplay = sistema || 'Selecionar sistema...';

  const talhaoDisplay = talhaoSel
    ? (talhoes.find(t => t.id === talhaoSel)?.nome ?? 'Talhao')
    : 'Fazenda inteira (geral)';

  const salvar = async () => {
    const cultFinal = cultura === '__custom__' ? culturaCustom.trim() : cultura.trim();
    if (!cultFinal) { Alert.alert('Atencao', 'Selecione a cultura.'); return; }
    const dpISO = dataPlantio ? parseDate(dataPlantio) : null;
    const dcISO = dataColheita ? parseDate(dataColheita) : null;
    if (dataPlantio && !dpISO) { Alert.alert('Data invalida', 'Data de plantio: use DD/MM/AAAA.'); return; }
    if (dataColheita && !dcISO) { Alert.alert('Data invalida', 'Data de colheita: use DD/MM/AAAA.'); return; }
    setSaving(true);
    try {
      const payload = {
        fazenda_id: fazendaId,
        talhao_id: talhaoSel || null,
        cultura: cultFinal,
        sistema_plantio: sistema || null,
        safra: safra.trim() || null,
        data_plantio: dpISO,
        data_colheita: dcISO,
        variedade: variedade.trim() || null,
        populacao_ha: populacao ? parseInt(populacao) : null,
        produtividade: produtividade ? parseFloat(produtividade) : null,
        obs: obs.trim() || null,
      };
      if (isEdit) {
        await supabase.from('sistema_plantio').update(payload).eq('id', plantioId);
      } else {
        const { error } = await supabase.from('sistema_plantio').insert(payload);
        if (error) throw error;
      }
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={s.loadRoot}><ActivityIndicator size="large" color="#2E7D32" /></View>;
  }

  const culturaOptions = [
    ...CULTURAS.map(c => ({ label: c, value: c })),
    { label: '+ Outra cultura...', value: '__custom__' },
  ];

  const sistemaOptions = SISTEMAS.map(sp => ({ label: sp, value: sp }));

  const talhaoOptions = [
    { label: 'Fazenda inteira (geral)', value: '' },
    ...talhoes.map(t => ({
      label: t.area_ha ? `${t.nome}  ·  ${t.area_ha} ha` : t.nome,
      value: t.id,
    })),
  ];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />

      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={s.backTxt}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isEdit ? 'Editar Plantio' : 'Novo Registro'}</Text>
        <TouchableOpacity style={s.saveBtn} onPress={salvar} disabled={saving} activeOpacity={0.8}>
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.saveTxt}>Salvar</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 60 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Identificacao */}
        <Text style={s.sectionLabel}>Identificacao</Text>
        <View style={s.card}>

          <TouchableOpacity style={s.selectorRow} onPress={() => setModalCultura(true)} activeOpacity={0.8}>
            <View style={{ flex: 1 }}>
              <Text style={s.selectorFieldLabel}>Cultura *</Text>
              <Text style={[s.selectorValue, !cultura && s.selectorPlaceholder]}>{culturaDisplay}</Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>

          {cultura === '__custom__' && (
            <>
              <HDivider />
              <View style={s.field}>
                <Text style={s.fieldLabel}>Nome da cultura</Text>
                <TextInput
                  style={s.fieldInput}
                  value={culturaCustom}
                  onChangeText={setCulturaCustom}
                  placeholder="Ex: Sorgo Granifero..."
                  placeholderTextColor="#bbb"
                  autoCapitalize="words"
                  autoCorrect={false}
                  autoFocus={!culturaCustom}
                />
              </View>
            </>
          )}

          <HDivider />

          <TouchableOpacity style={s.selectorRow} onPress={() => setModalSistema(true)} activeOpacity={0.8}>
            <View style={{ flex: 1 }}>
              <Text style={s.selectorFieldLabel}>Sistema de Plantio</Text>
              <Text style={[s.selectorValue, !sistema && s.selectorPlaceholder]}>{sistemaDisplay}</Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>

          <HDivider />

          <View style={s.field}>
            <Text style={s.fieldLabel}>Safra</Text>
            <TextInput
              style={s.fieldInput}
              value={safra}
              onChangeText={setSafra}
              placeholder="Ex: 2024/2025"
              placeholderTextColor="#bbb"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {talhoes.length > 0 && (
            <>
              <HDivider />
              <TouchableOpacity style={s.selectorRow} onPress={() => setModalTalhao(true)} activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <Text style={s.selectorFieldLabel}>Talhao</Text>
                  <Text style={s.selectorValue}>{talhaoDisplay}</Text>
                </View>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Datas */}
        <Text style={s.sectionLabel}>Datas</Text>
        <View style={s.card}>
          <View style={s.field}>
            <Text style={s.fieldLabel}>Data de Plantio</Text>
            <TextInput
              style={s.fieldInput}
              value={dataPlantio}
              onChangeText={setDataPlantio}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#bbb"
              keyboardType="numeric"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <HDivider />
          <View style={s.field}>
            <Text style={s.fieldLabel}>Data de Colheita</Text>
            <TextInput
              style={s.fieldInput}
              value={dataColheita}
              onChangeText={setDataColheita}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#bbb"
              keyboardType="numeric"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        {/* Detalhes agronomicos */}
        <Text style={s.sectionLabel}>Detalhes Agronomicos</Text>
        <View style={s.card}>
          <View style={s.field}>
            <Text style={s.fieldLabel}>Variedade / Hibrido</Text>
            <TextInput
              style={s.fieldInput}
              value={variedade}
              onChangeText={setVariedade}
              placeholder="Ex: TMG 7062 IPRO"
              placeholderTextColor="#bbb"
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>
          <HDivider />
          <View style={s.field}>
            <Text style={s.fieldLabel}>Populacao (plantas/ha)</Text>
            <TextInput
              style={s.fieldInput}
              value={populacao}
              onChangeText={setPopulacao}
              placeholder="Ex: 320000"
              placeholderTextColor="#bbb"
              keyboardType="numeric"
              autoCapitalize="none"
            />
          </View>
          <HDivider />
          <View style={s.field}>
            <Text style={s.fieldLabel}>Produtividade estimada (sc/ha)</Text>
            <TextInput
              style={s.fieldInput}
              value={produtividade}
              onChangeText={setProdutividade}
              placeholder="Ex: 65"
              placeholderTextColor="#bbb"
              keyboardType="numeric"
              autoCapitalize="none"
            />
          </View>
          <HDivider />
          <View style={s.field}>
            <Text style={s.fieldLabel}>Observacoes</Text>
            <TextInput
              style={[s.fieldInput, { height: 72, textAlignVertical: 'top', paddingTop: 2 }]}
              value={obs}
              onChangeText={setObs}
              placeholder="Informacoes adicionais..."
              placeholderTextColor="#bbb"
              multiline
              autoCapitalize="sentences"
            />
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <PickerModal
        visible={modalCultura}
        title="Cultura"
        options={culturaOptions}
        selected={cultura}
        onSelect={v => { setCultura(v); if (v !== '__custom__') setCulturaCustom(''); }}
        onClose={() => setModalCultura(false)}
      />
      <PickerModal
        visible={modalSistema}
        title="Sistema de Plantio"
        options={sistemaOptions}
        selected={sistema}
        onSelect={setSistema}
        onClose={() => setModalSistema(false)}
      />
      <PickerModal
        visible={modalTalhao}
        title="Talhao"
        options={talhaoOptions}
        selected={talhaoSel}
        onSelect={setTalhaoSel}
        onClose={() => setModalTalhao(false)}
      />
    </KeyboardAvoidingView>
  );
}

function HDivider() {
  return <View style={{ height: 1, backgroundColor: '#F0F2F0', marginLeft: 16 }} />;
}

const s = StyleSheet.create({
  loadRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F7F5' },

  header: {
    backgroundColor: '#1F4E1F', paddingBottom: 14, paddingHorizontal: 20,
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

  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: '#2E7D32', textTransform: 'uppercase',
    letterSpacing: 1.2, marginTop: 24, marginBottom: 8, marginLeft: 4,
  },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E8EDE8', overflow: 'hidden' },

  selectorRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  selectorFieldLabel: {
    fontSize: 11, color: '#999', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
  },
  selectorValue: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  selectorPlaceholder: { color: '#bbb', fontWeight: '400' },
  chevron: { fontSize: 22, color: '#ccc', marginLeft: 8 },

  field: { paddingHorizontal: 16, paddingVertical: 13 },
  fieldLabel: {
    fontSize: 11, color: '#999', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5,
  },
  fieldInput: { fontSize: 15, color: '#1a1a1a', paddingVertical: 0 },
});
