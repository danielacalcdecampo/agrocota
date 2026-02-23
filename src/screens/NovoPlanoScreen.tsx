import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, StatusBar,
  TextInput, Alert, ActivityIndicator, Modal, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'NovoPlano'>;
  route: RouteProp<RootStackParamList, 'NovoPlano'>;
};

const CATEGORIAS = ['Semente', 'Fertilizante', 'Defensivo', 'Servico', 'Outro'];
const UNIDADES   = ['kg', 'L', 'sc', 'un', 'ha', 't', 'cx'];

interface Talhao  { id: string; nome: string; area_ha: number | null; }
interface PlanoItem {
  id?: string;          // undefined = new (not yet in DB)
  categoria: string;
  produto: string;
  quantidade: string;   // string for input
  unidade: string;
  preco_unit: string;
  total: number;
  status: string;
}

function calcTotal(qtd: string, preco: string): number {
  const q = parseFloat(qtd.replace(',', '.'));
  const p = parseFloat(preco.replace(',', '.'));
  return isNaN(q) || isNaN(p) ? 0 : q * p;
}

// ─── Selector modal (reused pattern) ──────────────────────────
function PickerModal({
  visible, title, options, selected, onSelect, onClose,
}: {
  visible: boolean; title: string; options: string[];
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
            keyExtractor={i => i}
            style={{ maxHeight: 320 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => {
              const sel = selected === item;
              return (
                <TouchableOpacity
                  style={[pm.row, index > 0 && pm.rowBorder]}
                  onPress={() => { onSelect(item); onClose(); }}
                  activeOpacity={0.75}
                >
                  <View style={[pm.radio, sel && pm.radioSel]}>
                    {sel && <View style={pm.radioDot} />}
                  </View>
                  <Text style={[pm.rowTxt, sel && pm.rowTxtSel]}>{item}</Text>
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
  card: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%' },
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

// ─── Main Screen ────────────────────────────────────────────

const EMPTY_ITEM: Omit<PlanoItem, 'total' | 'status'> = {
  categoria: 'Semente', produto: '', quantidade: '', unidade: 'sc', preco_unit: '',
};

export default function NovoPlanoScreen({ navigation, route }: Props) {
  const { fazendaId, planoId } = route.params;
  const isEdit = !!planoId;
  const insets = useSafeAreaInsets();

  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [talhaoSel, setTalhaoSel] = useState('');
  const [descricao, setDescricao] = useState('');
  const [safra, setSafra] = useState('');
  const [items, setItems] = useState<PlanoItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // Add item modal
  const [showAddItem, setShowAddItem] = useState(false);
  const [editItemIdx, setEditItemIdx] = useState<number | null>(null);
  const [newCat, setNewCat]     = useState(EMPTY_ITEM.categoria);
  const [newProd, setNewProd]   = useState('');
  const [newQtd, setNewQtd]     = useState('');
  const [newUn, setNewUn]       = useState(EMPTY_ITEM.unidade);
  const [newPreco, setNewPreco] = useState('');

  // Selector modals
  const [modalTalhao, setModalTalhao] = useState(false);
  const [modalCat, setModalCat]       = useState(false);
  const [modalUn, setModalUn]         = useState(false);

  useEffect(() => {
    supabase.from('talhoes').select('id,nome,area_ha').eq('fazenda_id', fazendaId).then(({ data }) => {
      setTalhoes((data ?? []) as Talhao[]);
    });
  }, [fazendaId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const { data } = await supabase.from('planos_safra')
        .select('*, plano_itens(*)')
        .eq('id', planoId).single();
      if (data) {
        setDescricao(data.descricao ?? '');
        setSafra(data.safra ?? '');
        setTalhaoSel(data.talhao_id ?? '');
        setItems((data.plano_itens ?? []).map((i: any) => ({
          id: i.id, categoria: i.categoria ?? 'Outro', produto: i.produto,
          quantidade: i.quantidade?.toString() ?? '', unidade: i.unidade ?? 'sc',
          preco_unit: i.preco_unit?.toString() ?? '',
          total: i.total ?? 0, status: i.status ?? 'pendente',
        })));
      }
      setLoading(false);
    })();
  }, [isEdit, planoId]);

  const talhaoDisplay = talhaoSel
    ? (talhoes.find(t => t.id === talhaoSel)?.nome ?? 'Talhao')
    : 'Fazenda inteira (geral)';

  const talhaoOptions = [
    'Fazenda inteira (geral)',
    ...talhoes.map(t => t.nome),
  ];

  const openAddItemModal = (idx?: number) => {
    if (idx !== undefined) {
      const it = items[idx];
      setEditItemIdx(idx);
      setNewCat(it.categoria); setNewProd(it.produto);
      setNewQtd(it.quantidade); setNewUn(it.unidade); setNewPreco(it.preco_unit);
    } else {
      setEditItemIdx(null);
      setNewCat('Semente'); setNewProd(''); setNewQtd(''); setNewUn('sc'); setNewPreco('');
    }
    setShowAddItem(true);
  };

  const confirmarItem = () => {
    if (!newProd.trim()) { Alert.alert('Atencao', 'Informe o produto.'); return; }
    const item: PlanoItem = {
      id: editItemIdx !== null ? items[editItemIdx].id : undefined,
      categoria: newCat, produto: newProd.trim(),
      quantidade: newQtd, unidade: newUn, preco_unit: newPreco,
      total: calcTotal(newQtd, newPreco),
      status: editItemIdx !== null ? items[editItemIdx].status : 'pendente',
    };
    if (editItemIdx !== null) {
      setItems(prev => prev.map((it, i) => i === editItemIdx ? item : it));
    } else {
      setItems(prev => [...prev, item]);
    }
    setShowAddItem(false);
  };

  const removerItem = (idx: number) => {
    Alert.alert('Remover item', 'Remover este item do plano?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: () =>
        setItems(prev => prev.filter((_, i) => i !== idx)) },
    ]);
  };

  const salvar = async (status = 'rascunho') => {
    if (items.length === 0) { Alert.alert('Atencao', 'Adicione pelo menos um item ao plano.'); return; }
    setSaving(true);
    try {
      const payload = {
        fazenda_id: fazendaId,
        talhao_id: talhaoSel || null,
        descricao: descricao.trim() || null,
        safra: safra.trim() || null,
        status,
      };
      let pid = planoId;
      if (isEdit) {
        await supabase.from('planos_safra').update(payload).eq('id', pid);
        // delete old items not in current list
        const existingIds = items.filter(i => i.id).map(i => i.id!);
        await supabase.from('plano_itens').delete().eq('plano_id', pid).not('id', 'in', `(${existingIds.join(',')})`);
      } else {
        const { data, error } = await supabase.from('planos_safra').insert(payload).select('id').single();
        if (error) throw error;
        pid = data.id;
      }
      // upsert items
      const itemsPayload = items.map(it => ({
        ...(it.id ? { id: it.id } : {}),
        plano_id: pid,
        categoria: it.categoria.toLowerCase(),
        produto: it.produto,
        quantidade: it.quantidade ? parseFloat(it.quantidade.replace(',', '.')) : null,
        unidade: it.unidade,
        preco_unit: it.preco_unit ? parseFloat(it.preco_unit.replace(',', '.')) : null,
        status: it.status,
      }));
      await supabase.from('plano_itens').upsert(itemsPayload);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const totalGeral = items.reduce((sum, i) => sum + i.total, 0);

  if (loading) {
    return <View style={s.loadRoot}><ActivityIndicator size="large" color="#2E7D32" /></View>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={s.backTxt}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isEdit ? 'Editar Plano' : 'Novo Plano'}</Text>
        <TouchableOpacity style={s.saveBtn} onPress={() => salvar('rascunho')} disabled={saving} activeOpacity={0.8}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveTxt}>Salvar</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 80 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Info do plano */}
        <Text style={s.sectionLabel}>Informacoes do Plano</Text>
        <View style={s.card}>
          <View style={s.field}>
            <Text style={s.fieldLabel}>Descricao</Text>
            <TextInput
              style={s.fieldInput} value={descricao} onChangeText={setDescricao}
              placeholder="Ex: Plano insumos soja 2025/26..."
              placeholderTextColor="#bbb" autoCapitalize="sentences"
            />
          </View>
          <HDivider />
          <View style={s.field}>
            <Text style={s.fieldLabel}>Safra</Text>
            <TextInput
              style={s.fieldInput} value={safra} onChangeText={setSafra}
              placeholder="Ex: 2025/2026"
              placeholderTextColor="#bbb" autoCapitalize="none" autoCorrect={false}
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

        {/* Itens do plano */}
        <View style={[s.sectionRow, { marginTop: 24, marginBottom: 10, paddingHorizontal: 0 }]}>
          <Text style={s.sectionLabel} >Itens / Insumos</Text>
          <TouchableOpacity onPress={() => openAddItemModal()} activeOpacity={0.8} style={{ paddingVertical: 4, paddingHorizontal: 2 }}>
            <Text style={s.addItemTxt}>+ Adicionar item</Text>
          </TouchableOpacity>
        </View>

        {items.length === 0 ? (
          <View style={s.emptyItems}>
            <Text style={s.emptyItemsTxt}>Nenhum item adicionado ainda</Text>
          </View>
        ) : (
          items.map((item, idx) => (
            <View key={idx} style={s.itemCard}>
              <View style={s.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemProduto}>{item.produto}</Text>
                  <Text style={s.itemMeta}>{item.categoria} · {item.quantidade} {item.unidade} · R$ {parseFloat(item.preco_unit || '0').toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/un</Text>
                </View>
                <Text style={s.itemTotal}>R$ {item.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</Text>
              </View>
              <View style={s.itemActions}>
                <TouchableOpacity onPress={() => openAddItemModal(idx)} style={s.itemActionBtn} activeOpacity={0.8}>
                  <Text style={s.itemActionEdit}>Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removerItem(idx)} style={s.itemActionBtn} activeOpacity={0.8}>
                  <Text style={s.itemActionDel}>Remover</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {/* Total geral */}
        {items.length > 0 && (
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total do plano</Text>
            <Text style={s.totalVal}>R$ {totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</Text>
          </View>
        )}

        {/* Enviar para aprovacao */}
        {items.length > 0 && (
          <TouchableOpacity style={s.submitBtn} onPress={() => salvar('submetido')} disabled={saving} activeOpacity={0.85}>
            <Text style={s.submitTxt}>Enviar para Aprovacao do Produtor</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Selectors */}
      <PickerModal
        visible={modalTalhao} title="Talhao"
        options={talhaoOptions}
        selected={talhaoSel ? (talhoes.find(t => t.id === talhaoSel)?.nome ?? '') : 'Fazenda inteira (geral)'}
        onSelect={v => {
          if (v === 'Fazenda inteira (geral)') { setTalhaoSel(''); }
          else { const t = talhoes.find(t => t.nome === v); if (t) setTalhaoSel(t.id); }
        }}
        onClose={() => setModalTalhao(false)}
      />

      {/* Add/Edit item modal */}
      <Modal visible={showAddItem} animationType="slide" transparent onRequestClose={() => setShowAddItem(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[im.card, { paddingBottom: insets.bottom + 20 }]}>
            <View style={im.header}>
              <TouchableOpacity onPress={() => setShowAddItem(false)}>
                <Text style={im.cancel}>Cancelar</Text>
              </TouchableOpacity>
              <Text style={im.title}>{editItemIdx !== null ? 'Editar Item' : 'Novo Item'}</Text>
              <TouchableOpacity onPress={confirmarItem}>
                <Text style={im.confirm}>OK</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8 }}>

              {/* Categoria */}
              <TouchableOpacity style={im.row} onPress={() => setModalCat(true)} activeOpacity={0.8}>
                <Text style={im.label}>Categoria</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={im.value}>{newCat}</Text>
                  <Text style={im.arrow}>›</Text>
                </View>
              </TouchableOpacity>
              <HDivider />

              {/* Produto */}
              <View style={im.fieldRow}>
                <Text style={im.label}>Produto *</Text>
                <TextInput
                  style={im.input} value={newProd} onChangeText={setNewProd}
                  placeholder="Nome do produto" placeholderTextColor="#bbb"
                  autoCapitalize="words" autoCorrect={false}
                />
              </View>
              <HDivider />

              {/* Quantidade */}
              <View style={im.fieldRow}>
                <Text style={im.label}>Quantidade</Text>
                <TextInput
                  style={im.input} value={newQtd} onChangeText={setNewQtd}
                  placeholder="0" placeholderTextColor="#bbb" keyboardType="decimal-pad"
                />
              </View>
              <HDivider />

              {/* Unidade */}
              <TouchableOpacity style={im.row} onPress={() => setModalUn(true)} activeOpacity={0.8}>
                <Text style={im.label}>Unidade</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={im.value}>{newUn}</Text>
                  <Text style={im.arrow}>›</Text>
                </View>
              </TouchableOpacity>
              <HDivider />

              {/* Preco unit */}
              <View style={im.fieldRow}>
                <Text style={im.label}>Preco unitario (R$)</Text>
                <TextInput
                  style={im.input} value={newPreco} onChangeText={setNewPreco}
                  placeholder="0,00" placeholderTextColor="#bbb" keyboardType="decimal-pad"
                />
              </View>

              {/* Preview total */}
              {(newQtd || newPreco) ? (
                <View style={im.totalPreview}>
                  <Text style={im.totalPreviewLbl}>Total estimado</Text>
                  <Text style={im.totalPreviewVal}>R$ {calcTotal(newQtd, newPreco).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <PickerModal visible={modalCat} title="Categoria" options={CATEGORIAS} selected={newCat} onSelect={setNewCat} onClose={() => setModalCat(false)} />
      <PickerModal visible={modalUn} title="Unidade" options={UNIDADES} selected={newUn} onSelect={setNewUn} onClose={() => setModalUn(false)} />
    </KeyboardAvoidingView>
  );
}

function HDivider() {
  return <View style={{ height: 1, backgroundColor: '#F0F2F0', marginLeft: 16 }} />;
}

const im = StyleSheet.create({
  card: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#F0F2F0' },
  title: { fontSize: 16, fontWeight: '800', color: '#1A2E1A' },
  cancel: { fontSize: 15, color: '#999', fontWeight: '600' },
  confirm: { fontSize: 15, color: '#2E7D32', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  fieldRow: { paddingVertical: 13 },
  label: { fontSize: 13, color: '#666', fontWeight: '600', marginBottom: 4 },
  value: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  arrow: { fontSize: 20, color: '#ccc', marginLeft: 6 },
  input: { fontSize: 15, color: '#1a1a1a', paddingVertical: 0 },
  totalPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F2F0' },
  totalPreviewLbl: { fontSize: 13, color: '#888', fontWeight: '600' },
  totalPreviewVal: { fontSize: 18, fontWeight: '800', color: '#2E7D32' },
});

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
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#2E7D32', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8, marginLeft: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addItemTxt: { fontSize: 14, color: '#2E7D32', fontWeight: '700' },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E8EDE8', overflow: 'hidden' },
  field: { paddingHorizontal: 16, paddingVertical: 13 },
  fieldLabel: { fontSize: 11, color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  fieldInput: { fontSize: 15, color: '#1a1a1a', paddingVertical: 0 },

  selectorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  selectorFieldLabel: { fontSize: 11, color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  selectorValue: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  chevron: { fontSize: 22, color: '#ccc', marginLeft: 8 },

  emptyItems: { paddingVertical: 20, alignItems: 'center' },
  emptyItemsTxt: { fontSize: 14, color: '#C0C8C0', fontStyle: 'italic' },

  itemCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#E8EDE8' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start' },
  itemProduto: { fontSize: 15, fontWeight: '700', color: '#1A2E1A', marginBottom: 3 },
  itemMeta: { fontSize: 12, color: '#888' },
  itemTotal: { fontSize: 15, fontWeight: '800', color: '#2E7D32', marginLeft: 8 },
  itemActions: { flexDirection: 'row', marginTop: 10, gap: 12 },
  itemActionBtn: { paddingVertical: 4 },
  itemActionEdit: { fontSize: 13, color: '#1565C0', fontWeight: '700' },
  itemActionDel: { fontSize: 13, color: '#C62828', fontWeight: '700' },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: '#E8EDE8', marginTop: 4 },
  totalLabel: { fontSize: 13, color: '#666', fontWeight: '700' },
  totalVal: { fontSize: 20, fontWeight: '800', color: '#1F4E1F' },

  submitBtn: { backgroundColor: '#2E7D32', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  submitTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
