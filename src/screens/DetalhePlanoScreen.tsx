import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, StatusBar,
  Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'DetalhePlano'>;
  route: RouteProp<RootStackParamList, 'DetalhePlano'>;
};

interface PlanoItem {
  id: string; categoria: string; produto: string;
  quantidade: number | null; unidade: string | null;
  preco_unit: number | null; total: number | null; status: string;
}
interface Plano {
  id: string; descricao: string | null; safra: string | null;
  status: string; talhao_id: string | null;
  plano_itens: PlanoItem[];
}

const STATUS_ITEM: Record<string, { bg: string; tc: string; label: string }> = {
  pendente:  { bg: '#F5F5F5', tc: '#888',    label: 'Pendente'  },
  aceito:    { bg: '#E8F5E9', tc: '#2E7D32', label: 'Aceito'    },
  rejeitado: { bg: '#FFEBEE', tc: '#C62828', label: 'Rejeitado' },
};
const PLANO_STATUS: Record<string, { bg: string; tc: string; label: string }> = {
  rascunho:  { bg: '#FFF9C4', tc: '#F9A825', label: 'Rascunho'   },
  submetido: { bg: '#E3F2FD', tc: '#1565C0', label: 'Aguardando' },
  aceito:    { bg: '#E8F5E9', tc: '#2E7D32', label: 'Aceito'     },
  rejeitado: { bg: '#FFEBEE', tc: '#C62828', label: 'Rejeitado'  },
};

const CAT_LABEL: Record<string, string> = {
  semente: 'Semente', fertilizante: 'Fertilizante', defensivo: 'Defensivo',
  servico: 'Servico', outro: 'Outro',
};

function fmt(n: number | null, dec = 2) {
  return (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: dec });
}

export default function DetalhePlanoScreen({ navigation, route }: Props) {
  const { planoId, fazendaId } = route.params;
  const insets = useSafeAreaInsets();
  const [plano, setPlano] = useState<Plano | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPlano = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('planos_safra')
      .select('*, plano_itens(*)')
      .eq('id', planoId).single();
    if (data) {
      setPlano({
        ...data,
        plano_itens: (data.plano_itens ?? []).sort((a: PlanoItem, b: PlanoItem) =>
          a.produto.localeCompare(b.produto)),
      } as Plano);
    }
    setLoading(false);
  }, [planoId]);

  useFocusEffect(useCallback(() => { fetchPlano(); }, [fetchPlano]));

  const toggleItemStatus = async (item: PlanoItem) => {
    const next = item.status === 'aceito' ? 'pendente'
               : item.status === 'pendente' ? 'aceito' : 'pendente';
    setSaving(true);
    await supabase.from('plano_itens').update({ status: next }).eq('id', item.id);
    setPlano(prev => prev ? {
      ...prev,
      plano_itens: prev.plano_itens.map(i => i.id === item.id ? { ...i, status: next } : i),
    } : prev);
    setSaving(false);
  };

  const rejeitar = async (item: PlanoItem) => {
    setSaving(true);
    await supabase.from('plano_itens').update({ status: 'rejeitado' }).eq('id', item.id);
    setPlano(prev => prev ? {
      ...prev,
      plano_itens: prev.plano_itens.map(i => i.id === item.id ? { ...i, status: 'rejeitado' } : i),
    } : prev);
    setSaving(false);
  };

  const aceitarTodos = async () => {
    setSaving(true);
    await supabase.from('plano_itens').update({ status: 'aceito' }).eq('plano_id', planoId).eq('status', 'pendente');
    setPlano(prev => prev ? {
      ...prev,
      plano_itens: prev.plano_itens.map(i => i.status === 'pendente' ? { ...i, status: 'aceito' } : i),
    } : prev);
    setSaving(false);
  };

  const mudarStatusPlano = async (novoStatus: string) => {
    setSaving(true);
    await supabase.from('planos_safra').update({ status: novoStatus }).eq('id', planoId);
    setPlano(prev => prev ? { ...prev, status: novoStatus } : prev);
    setSaving(false);
  };

  if (loading) return <View style={s.loadRoot}><ActivityIndicator size="large" color="#2E7D32" /></View>;
  if (!plano) return <View style={s.loadRoot}><Text style={{ color: '#888' }}>Plano nao encontrado</Text></View>;

  const itens = plano.plano_itens;
  const totalGeral   = itens.reduce((acc, i) => acc + (i.total ?? 0), 0);
  const totalAceito  = itens.filter(i => i.status === 'aceito').reduce((acc, i) => acc + (i.total ?? 0), 0);
  const totalRejeit  = itens.filter(i => i.status === 'rejeitado').reduce((acc, i) => acc + (i.total ?? 0), 0);
  const nPendentes   = itens.filter(i => i.status === 'pendente').length;

  const pSt = PLANO_STATUS[plano.status] ?? PLANO_STATUS.rascunho;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={s.backTxt}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{plano.descricao || `Plano ${plano.safra || ''}`}</Text>
        <TouchableOpacity
          style={s.editBtn}
          onPress={() => navigation.navigate('NovoPlano', { fazendaId, planoId })}
          activeOpacity={0.8}
        >
          <Text style={s.editTxt}>Editar</Text>
        </TouchableOpacity>
      </View>

      {/* Status bar */}
      <View style={s.statusBar}>
        <View style={[s.statusBadge, { backgroundColor: pSt.bg }]}>
          <Text style={[s.statusTxt, { color: pSt.tc }]}>{pSt.label}</Text>
        </View>
        {plano.safra ? <Text style={s.safraLbl}>Safra {plano.safra}</Text> : null}
        {saving && <ActivityIndicator size="small" color="#2E7D32" style={{ marginLeft: 8 }} />}
      </View>

      {/* Summary */}
      <View style={s.summaryBar}>
        <View style={s.summaryCol}>
          <Text style={s.summaryNum}>R$ {fmt(totalGeral)}</Text>
          <Text style={s.summaryLbl}>Total</Text>
        </View>
        <View style={s.summaryDivV} />
        <View style={s.summaryCol}>
          <Text style={[s.summaryNum, { color: '#2E7D32' }]}>R$ {fmt(totalAceito)}</Text>
          <Text style={s.summaryLbl}>Aceito</Text>
        </View>
        <View style={s.summaryDivV} />
        <View style={s.summaryCol}>
          <Text style={[s.summaryNum, { color: '#C62828' }]}>R$ {fmt(totalRejeit)}</Text>
          <Text style={s.summaryLbl}>Rejeitado</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Action buttons */}
        <View style={s.actionRow}>
          {nPendentes > 0 && (
            <TouchableOpacity style={s.actionBtn} onPress={aceitarTodos} activeOpacity={0.85}>
              <Text style={s.actionBtnTxt}>Aceitar todos pendentes ({nPendentes})</Text>
            </TouchableOpacity>
          )}
          {plano.status === 'submetido' && (
            <TouchableOpacity
              style={[s.actionBtn, s.actionBtnGreen]}
              onPress={() => Alert.alert(
                'Aprovar plano',
                'Marcar este plano como aceito pelo produtor?',
                [{ text: 'Cancelar', style: 'cancel' }, { text: 'Aceitar plano', onPress: () => mudarStatusPlano('aceito') }]
              )}
              activeOpacity={0.85}
            >
              <Text style={[s.actionBtnTxt, { color: '#fff' }]}>Aceitar plano completo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Items list */}
        {itens.length === 0 ? (
          <View style={s.empty}><Text style={s.emptyTxt}>Nenhum item neste plano</Text></View>
        ) : (
          itens.map(item => {
            const st = STATUS_ITEM[item.status] ?? STATUS_ITEM.pendente;
            return (
              <View key={item.id} style={s.itemCard}>
                <View style={s.itemTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemProduto}>{item.produto}</Text>
                    <Text style={s.itemMeta}>
                      {CAT_LABEL[item.categoria] ?? item.categoria}
                      {item.quantidade != null ? ` · ${fmt(item.quantidade, 0)} ${item.unidade ?? ''}` : ''}
                      {item.preco_unit != null ? ` · R$ ${fmt(item.preco_unit)}/un` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {item.total != null && <Text style={s.itemTotal}>R$ {fmt(item.total)}</Text>}
                    <View style={[s.itemStatusBadge, { backgroundColor: st.bg, marginTop: 4 }]}>
                      <Text style={[s.itemStatusTxt, { color: st.tc }]}>{st.label}</Text>
                    </View>
                  </View>
                </View>

                {/* Accept/Reject buttons */}
                <View style={s.itemBtns}>
                  <TouchableOpacity
                    style={[s.iBtn, item.status === 'aceito' ? s.iBtnAceito : s.iBtnOut]}
                    onPress={() => toggleItemStatus(item)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.iBtnTxt, item.status === 'aceito' ? s.iBtnTxtAceito : s.iBtnTxtOut]}>
                      {item.status === 'aceito' ? '✓ Aceito' : 'Aceitar'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.iBtn, item.status === 'rejeitado' ? s.iBtnRejeit : s.iBtnOut]}
                    onPress={() => item.status === 'rejeitado' ? toggleItemStatus(item) : rejeitar(item)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.iBtnTxt, item.status === 'rejeitado' ? s.iBtnTxtRejeit : s.iBtnTxtOut]}>
                      {item.status === 'rejeitado' ? '✗ Rejeitado' : 'Rejeitar'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const GREEN = '#1F4E1F';
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6F4' },
  loadRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F4F6F4' },

  header: {
    backgroundColor: GREEN, paddingBottom: 14, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', minWidth: 88, alignItems: 'center' },
  backTxt: { color: '#A5D6A7', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '800', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  editBtn: { minWidth: 88, alignItems: 'flex-end' },
  editTxt: { color: '#A5D6A7', fontSize: 14, fontWeight: '600' },

  statusBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEF0EE', gap: 12 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  statusTxt: { fontSize: 12, fontWeight: '700' },
  safraLbl: { fontSize: 13, color: '#888', fontWeight: '600' },

  summaryBar: { flexDirection: 'row', backgroundColor: '#fff', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEF0EE' },
  summaryCol: { flex: 1, alignItems: 'center' },
  summaryNum: { fontSize: 16, fontWeight: '800', color: '#1A2E1A' },
  summaryLbl: { fontSize: 10, color: '#AAB2AA', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  summaryDivV: { width: 1, backgroundColor: '#EEF0EE', marginVertical: 2 },

  actionRow: { gap: 10, marginBottom: 16 },
  actionBtn: { borderRadius: 12, borderWidth: 1, borderColor: '#2E7D32', paddingVertical: 12, alignItems: 'center' },
  actionBtnGreen: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  actionBtnTxt: { fontSize: 14, fontWeight: '700', color: '#2E7D32' },

  empty: { paddingTop: 60, alignItems: 'center' },
  emptyTxt: { fontSize: 14, color: '#C0C8C0', fontStyle: 'italic' },

  itemCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E8EDE8' },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  itemProduto: { fontSize: 15, fontWeight: '800', color: '#1A2E1A', marginBottom: 3 },
  itemMeta: { fontSize: 12, color: '#888', lineHeight: 18 },
  itemTotal: { fontSize: 16, fontWeight: '800', color: '#1A2E1A' },
  itemStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  itemStatusTxt: { fontSize: 11, fontWeight: '700' },

  itemBtns: { flexDirection: 'row', gap: 10 },
  iBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', borderWidth: 1 },
  iBtnOut: { borderColor: '#E0E0E0', backgroundColor: '#FAFAFA' },
  iBtnAceito: { borderColor: '#A5D6A7', backgroundColor: '#E8F5E9' },
  iBtnRejeit: { borderColor: '#FFCDD2', backgroundColor: '#FFEBEE' },
  iBtnTxt: { fontSize: 13, fontWeight: '700' },
  iBtnTxtOut: { color: '#888' },
  iBtnTxtAceito: { color: '#2E7D32' },
  iBtnTxtRejeit: { color: '#C62828' },
});
