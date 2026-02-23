import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, StatusBar,
  TextInput, Alert, ActivityIndicator, Modal, FlatList,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'NovaCompra'>;
  route: RouteProp<RootStackParamList, 'NovaCompra'>;
};

const CATEGORIAS = ['Semente', 'Fertilizante', 'Defensivo', 'Servico', 'Outro'];
const UNIDADES   = ['kg', 'L', 'sc', 'un', 'ha', 't', 'cx'];

interface Talhao { id: string; nome: string; area_ha: number | null; }

function calcTotal(qtd: string, preco: string): number {
  const q = parseFloat(qtd.replace(',', '.'));
  const p = parseFloat(preco.replace(',', '.'));
  return isNaN(q) || isNaN(p) ? 0 : q * p;
}

// Reusable picker modal
function PickerModal({
  visible, title, options, selected, onSelect, onClose,
}: {
  visible: boolean; title: string; options: { label: string; value: string }[];
  selected: string; onSelect: (v: string) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={pm.overlay}>
        <View style={[pm.card, { paddingBottom: insets.bottom + 16 }]}>
          <View style={pm.header}>
            <Text style={pm.title}>{title}</Text>
            <TouchableOpacity onPress={onClose}><Text style={pm.done}>Pronto</Text></TouchableOpacity>
          </View>
          <FlatList
            data={options}
            keyExtractor={i => i.value || '__'}
            style={{ maxHeight: 340 }}
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
  card: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '72%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#F0F2F0' },
  title: { fontSize: 17, fontWeight: '800', color: '#1A2E1A' },
  done: { fontSize: 15, color: '#2E7D32', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F5F5F5' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ccc', marginRight: 14, alignItems: 'center', justifyContent: 'center' },
  radioSel: { borderColor: '#2E7D32' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E7D32' },
  rowTxt: { fontSize: 15, color: '#444' },
  rowTxtSel: { color: '#1F4E1F', fontWeight: '700' },
});

export default function NovaCompraScreen({ navigation, route }: Props) {
  const { fazendaId, compraId } = route.params;
  const isEdit = !!compraId;
  const insets = useSafeAreaInsets();

  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [talhaoSel, setTalhaoSel] = useState('');
  const [produto, setProduto]     = useState('');
  const [categoria, setCategoria] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [unidade, setUnidade]     = useState('');
  const [precoUnit, setPrecoUnit] = useState('');
  const [totalManual, setTotalManual] = useState('');  // override calculated
  const [dataCompra, setDataCompra] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [safra, setSafra]         = useState('');
  const [obs, setObs]             = useState('');
  const [saving, setSaving]       = useState(false);
  const [loading, setLoading]     = useState(isEdit);

  // Modals
  const [modalCat, setModalCat]       = useState(false);
  const [modalUn, setModalUn]         = useState(false);
  const [modalTalhao, setModalTalhao] = useState(false);

  useEffect(() => {
    supabase.from('talhoes').select('id,nome,area_ha').eq('fazenda_id', fazendaId).then(({ data }) => {
      setTalhoes((data ?? []) as Talhao[]);
    });
  }, [fazendaId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const { data } = await supabase.from('compras').select('*').eq('id', compraId).single();
      if (data) {
        setProduto(data.produto ?? '');
        setCategoria(data.categoria ? cap(data.categoria) : '');
        setQuantidade(data.quantidade?.toString() ?? '');
        setUnidade(data.unidade ?? '');
        setPrecoUnit(data.preco_unit?.toString() ?? '');
        setTotalManual(data.total?.toString() ?? '');
        setDataCompra(data.data_compra ? fmtDate(data.data_compra) : '');
        setFornecedor(data.fornecedor ?? '');
        setSafra(data.safra ?? '');
        setObs(data.obs ?? '');
        setTalhaoSel(data.talhao_id ?? '');
      }
      setLoading(false);
    })();
  }, [isEdit, compraId]);

  function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtDate(iso: string) {
    const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`;
  }
  function parseDate(s: string): string | null {
    const p = s.trim().split('/');
    if (p.length !== 3 || p[2].length !== 4) return null;
    const iso = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    return isNaN(Date.parse(iso)) ? null : iso;
  }

  const autoTotal = calcTotal(quantidade, precoUnit);
  const totalFinal = totalManual
    ? parseFloat(totalManual.replace(',', '.'))
    : autoTotal;

  const talhaoDisplay = talhaoSel
    ? (talhoes.find(t => t.id === talhaoSel)?.nome ?? 'Talhao')
    : 'Fazenda inteira (geral)';

  const talhaoOptions = [
    { label: 'Fazenda inteira (geral)', value: '' },
    ...talhoes.map(t => ({ label: t.area_ha ? `${t.nome}  ·  ${t.area_ha} ha` : t.nome, value: t.id })),
  ];

  const salvar = async () => {
    if (!produto.trim()) { Alert.alert('Atencao', 'Informe o produto.'); return; }
    const dtISO = dataCompra ? parseDate(dataCompra) : null;
    if (dataCompra && !dtISO) { Alert.alert('Data invalida', 'Use DD/MM/AAAA.'); return; }
    setSaving(true);
    try {
      const payload: any = {
        fazenda_id: fazendaId,
        talhao_id: talhaoSel || null,
        produto: produto.trim(),
        categoria: categoria ? categoria.toLowerCase() : null,
        quantidade: quantidade ? parseFloat(quantidade.replace(',', '.')) : null,
        unidade: unidade || null,
        preco_unit: precoUnit ? parseFloat(precoUnit.replace(',', '.')) : null,
        total: isNaN(totalFinal) ? null : (totalFinal > 0 ? totalFinal : null),
        data_compra: dtISO,
        fornecedor: fornecedor.trim() || null,
        safra: safra.trim() || null,
        obs: obs.trim() || null,
      };
      if (isEdit) {
        const { error } = await supabase.from('compras').update(payload).eq('id', compraId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('compras').insert(payload);
        if (error) throw error;
      }
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Erro ao salvar compra.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={s.loadRoot}><ActivityIndicator size="large" color="#2E7D32" /></View>;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={s.backTxt}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isEdit ? 'Editar Compra' : 'Nova Compra'}</Text>
        <TouchableOpacity style={s.saveBtn} onPress={salvar} disabled={saving} activeOpacity={0.8}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveTxt}>Salvar</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 60 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Produto */}
        <Text style={s.sectionLabel}>Produto</Text>
        <View style={s.card}>

          <TouchableOpacity style={s.selectorRow} onPress={() => setModalCat(true)} activeOpacity={0.8}>
            <View style={{ flex: 1 }}>
              <Text style={s.selectorFieldLabel}>Categoria</Text>
              <Text style={[s.selectorValue, !categoria && s.placeholder]}>
                {categoria || 'Selecionar categoria...'}
              </Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>

          <HDivider />

          <View style={s.field}>
            <Text style={s.fieldLabel}>Produto *</Text>
            <TextInput
              style={s.fieldInput} value={produto} onChangeText={setProduto}
              placeholder="Nome do produto ou insumo"
              placeholderTextColor="#bbb" autoCapitalize="words" autoCorrect={false}
            />
          </View>

          <HDivider />

          <View style={s.field}>
            <Text style={s.fieldLabel}>Fornecedor</Text>
            <TextInput
              style={s.fieldInput} value={fornecedor} onChangeText={setFornecedor}
              placeholder="Nome da empresa ou loja"
              placeholderTextColor="#bbb" autoCapitalize="words" autoCorrect={false}
            />
          </View>
        </View>

        {/* Quantidade e preco */}
        <Text style={s.sectionLabel}>Quantidade e Preco</Text>
        <View style={s.card}>
          <View style={s.twoCol}>
            <View style={[s.field, { flex: 1 }]}>
              <Text style={s.fieldLabel}>Quantidade</Text>
              <TextInput
                style={s.fieldInput} value={quantidade} onChangeText={setQuantidade}
                placeholder="0" placeholderTextColor="#bbb" keyboardType="decimal-pad"
              />
            </View>
            <View style={s.vertDiv} />
            <TouchableOpacity style={[s.field, { flex: 1 }]} onPress={() => setModalUn(true)} activeOpacity={0.8}>
              <Text style={s.fieldLabel}>Unidade</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[s.fieldInput, !unidade && { color: '#bbb' }]}>{unidade || 'sc'}</Text>
                <Text style={{ color: '#ccc', fontSize: 18, marginLeft: 4 }}>›</Text>
              </View>
            </TouchableOpacity>
          </View>

          <HDivider />

          <View style={s.field}>
            <Text style={s.fieldLabel}>Preco unitario (R$)</Text>
            <TextInput
              style={s.fieldInput} value={precoUnit} onChangeText={v => { setPrecoUnit(v); setTotalManual(''); }}
              placeholder="0,00" placeholderTextColor="#bbb" keyboardType="decimal-pad"
            />
          </View>

          <HDivider />

          {/* Total - auto or manual */}
          <View style={s.field}>
            <Text style={s.fieldLabel}>
              Total (R$){autoTotal > 0 && !totalManual ? '  — calculado automaticamente' : ''}
            </Text>
            <TextInput
              style={s.fieldInput}
              value={totalManual || (autoTotal > 0 ? autoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '')}
              onChangeText={setTotalManual}
              placeholder="0,00"
              placeholderTextColor="#bbb" keyboardType="decimal-pad"
            />
          </View>
        </View>

        {/* Complementar */}
        <Text style={s.sectionLabel}>Complementar</Text>
        <View style={s.card}>
          <View style={s.field}>
            <Text style={s.fieldLabel}>Data da compra</Text>
            <TextInput
              style={s.fieldInput} value={dataCompra} onChangeText={setDataCompra}
              placeholder="DD/MM/AAAA" placeholderTextColor="#bbb" keyboardType="numeric"
            />
          </View>

          <HDivider />

          <View style={s.field}>
            <Text style={s.fieldLabel}>Safra</Text>
            <TextInput
              style={s.fieldInput} value={safra} onChangeText={setSafra}
              placeholder="Ex: 2025/2026" placeholderTextColor="#bbb" autoCapitalize="none" autoCorrect={false}
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

          <HDivider />

          <View style={s.field}>
            <Text style={s.fieldLabel}>Observacoes</Text>
            <TextInput
              style={[s.fieldInput, { height: 64, textAlignVertical: 'top', paddingTop: 2 }]}
              value={obs} onChangeText={setObs}
              placeholder="Informacoes adicionais..."
              placeholderTextColor="#bbb" multiline autoCapitalize="sentences"
            />
          </View>
        </View>
      </ScrollView>

      <PickerModal
        visible={modalCat} title="Categoria"
        options={CATEGORIAS.map(c => ({ label: c, value: c }))}
        selected={categoria}
        onSelect={setCategoria}
        onClose={() => setModalCat(false)}
      />
      <PickerModal
        visible={modalUn} title="Unidade"
        options={UNIDADES.map(u => ({ label: u, value: u }))}
        selected={unidade}
        onSelect={setUnidade}
        onClose={() => setModalUn(false)}
      />
      <PickerModal
        visible={modalTalhao} title="Talhao"
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
  backBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', minWidth: 88, alignItems: 'center' },
  backTxt: { color: '#A5D6A7', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  saveBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, minWidth: 64, alignItems: 'center' },
  saveTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#2E7D32', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 24, marginBottom: 8, marginLeft: 2 },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E8EDE8', overflow: 'hidden' },

  selectorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  selectorFieldLabel: { fontSize: 11, color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  selectorValue: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  placeholder: { color: '#bbb', fontWeight: '400' },
  chevron: { fontSize: 22, color: '#ccc', marginLeft: 8 },

  field: { paddingHorizontal: 16, paddingVertical: 13 },
  fieldLabel: { fontSize: 11, color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  fieldInput: { fontSize: 15, color: '#1a1a1a', paddingVertical: 0 },

  twoCol: { flexDirection: 'row' },
  vertDiv: { width: 1, backgroundColor: '#F0F2F0' },
});
