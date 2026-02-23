import os

# ── ConsultorHomeScreen ──────────────────────────────────────────────────────
home = r"""import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';

interface Stats {
  cotacoesAtivas: number;
  fazendas: number;
  aguardandoAprovacao: number;
}
interface Cotacao {
  id: string;
  titulo: string;
  status: string;
  created_at: string;
  fazendas: { nome: string } | { nome: string }[] | null;
}

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
};
const STATUS_COLOR: Record<string, string> = {
  rascunho: '#90A4AE',
  enviada: '#F57C00',
  aprovada: '#2E7D32',
  recusada: '#C62828',
};
const STATUS_BG: Record<string, string> = {
  rascunho: '#F5F7F8',
  enviada: '#FFF8F2',
  aprovada: '#F2FAF2',
  recusada: '#FFF2F2',
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ConsultorHome'>;
};

export default function ConsultorHomeScreen({ navigation }: Props) {
  const { signOut, session, refreshProfile } = useAuth();
  const [stats, setStats] = useState<Stats>({
    cotacoesAtivas: 0,
    fazendas: 0,
    aguardandoAprovacao: 0,
  });
  const [recentes, setRecentes] = useState<Cotacao[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!session?.user?.id) return;
    const uid = session.user.id;

    const [cotRes, fazRes, recRes] = await Promise.all([
      supabase.from('cotacoes').select('status').eq('consultor_id', uid),
      supabase
        .from('fazendas')
        .select('id', { count: 'exact', head: true })
        .eq('consultor_id', uid),
      supabase
        .from('cotacoes')
        .select('id, titulo, status, created_at, fazendas(nome)')
        .eq('consultor_id', uid)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    const cotacoes = cotRes.data ?? [];
    setStats({
      cotacoesAtivas: cotacoes.filter((c: any) => c.status !== 'recusada').length,
      fazendas: fazRes.count ?? 0,
      aguardandoAprovacao: cotacoes.filter((c: any) => c.status === 'enviada').length,
    });
    setRecentes((recRes.data ?? []) as Cotacao[]);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refreshProfile();
      fetchData();
    }, [fetchData]),
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshProfile(), fetchData()]);
    setRefreshing(false);
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />

      <View style={s.header}>
        <View style={s.headerTop}>
          <View>
            <Text style={s.headerLabel}>Bem-vindo a</Text>
            <View style={s.brandRow}>
              <Text style={s.brandName}>Agro</Text>
              <View style={s.brandChip}>
                <Text style={s.brandChipText}>RV</Text>
              </View>
            </View>
          </View>
          <View style={s.headerActions}>
            <TouchableOpacity
              style={s.headerBtn}
              onPress={() => navigation.navigate('Profile')}
              activeOpacity={0.8}
            >
              <Text style={s.headerBtnText}>Perfil</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.headerBtn, s.headerBtnSair]}
              onPress={signOut}
              activeOpacity={0.8}
            >
              <Text style={s.headerBtnText}>Sair</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.statsGrid}>
          <View style={s.statItem}>
            <Text style={s.statNum}>{stats.cotacoesAtivas}</Text>
            <Text style={s.statLabel}>{'Cotacoes\nativas'}</Text>
          </View>
          <View style={s.statSep} />
          <View style={s.statItem}>
            <Text style={s.statNum}>{stats.aguardandoAprovacao}</Text>
            <Text style={s.statLabel}>{'Aguardando\naprovacao'}</Text>
          </View>
          <View style={s.statSep} />
          <View style={s.statItem}>
            <Text style={s.statNum}>{stats.fazendas}</Text>
            <Text style={s.statLabel}>{'Fazendas\ncadastradas'}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2E7D32']} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.sectionTitle}>Acoes rapidas</Text>
        <View style={s.acaoList}>
          <TouchableOpacity
            style={s.acaoPrimary}
            onPress={() => navigation.navigate('NovaCotacao')}
            activeOpacity={0.85}
          >
            <View>
              <Text style={s.acaoPrimaryTitle}>Nova Cotacao</Text>
              <Text style={s.acaoPrimaryDesc}>Importe um Excel e gere graficos automaticamente</Text>
            </View>
            <Text style={s.acaoChevron}>{'>'}</Text>
          </TouchableOpacity>

          <View style={s.acaoRow}>
            <TouchableOpacity style={s.acaoCard} activeOpacity={0.85}>
              <Text style={s.acaoCardTitle}>Nova Fazenda</Text>
              <Text style={s.acaoCardDesc}>Cadastrar propriedade</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.acaoCard} activeOpacity={0.85}>
              <Text style={s.acaoCardTitle}>Relatorios</Text>
              <Text style={s.acaoCardDesc}>Exportar em PDF</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>Cotacoes recentes</Text>
          <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.linkText}>Ver todas</Text>
          </TouchableOpacity>
        </View>

        {recentes.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Nenhuma cotacao criada</Text>
            <Text style={s.emptyDesc}>Toque em Nova Cotacao para comecar</Text>
            <TouchableOpacity
              style={s.emptyBtn}
              onPress={() => navigation.navigate('NovaCotacao')}
              activeOpacity={0.85}
            >
              <Text style={s.emptyBtnText}>Criar primeira cotacao</Text>
            </TouchableOpacity>
          </View>
        ) : (
          recentes.map(c => (
            <TouchableOpacity key={c.id} style={s.cotacaoRow} activeOpacity={0.8}>
              <View style={[s.cotacaoAccent, { backgroundColor: STATUS_COLOR[c.status] ?? '#ccc' }]} />
              <View style={s.cotacaoInfo}>
                <Text style={s.cotacaoTitulo} numberOfLines={1}>{c.titulo}</Text>
                <Text style={s.cotacaoMeta}>
                  {Array.isArray(c.fazendas)
                    ? (c.fazendas[0]?.nome ?? '-')
                    : (c.fazendas?.nome ?? '-')}
                  {'  \u00B7  '}
                  {new Date(c.created_at).toLocaleDateString('pt-BR')}
                </Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: STATUS_BG[c.status] ?? '#F5F5F5' }]}>
                <Text style={[s.statusText, { color: STATUS_COLOR[c.status] ?? '#888' }]}>
                  {STATUS_LABEL[c.status] ?? c.status}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8F7' },
  header: {
    backgroundColor: '#1F4E1F',
    paddingTop: 56,
    paddingHorizontal: 24,
    paddingBottom: 0,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
  },
  headerLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandName: { fontSize: 30, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  brandChip: {
    backgroundColor: '#4CAF50',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  brandChipText: { fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  statsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginHorizontal: -24,
    paddingHorizontal: 24,
    paddingVertical: 18,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statSep: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.12)' },
  statNum: { fontSize: 26, fontWeight: '900', color: '#fff', lineHeight: 30 },
  statLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
    textAlign: 'center',
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8FA08F',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 14,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 14,
  },
  linkText: { fontSize: 13, color: '#2E7D32', fontWeight: '600' },
  acaoList: { gap: 10, marginBottom: 8 },
  acaoPrimary: {
    backgroundColor: '#2E7D32',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  acaoPrimaryTitle: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 2 },
  acaoPrimaryDesc: { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  acaoChevron: { fontSize: 22, color: 'rgba(255,255,255,0.4)', fontWeight: '300' },
  acaoRow: { flexDirection: 'row', gap: 10 },
  acaoCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#ECF0EC',
  },
  acaoCardTitle: { fontSize: 14, fontWeight: '700', color: '#1A2E1A', marginBottom: 3 },
  acaoCardDesc: { fontSize: 11, color: '#8FA08F' },
  cotacaoRow: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#ECF0EC',
  },
  cotacaoAccent: { width: 3, alignSelf: 'stretch' },
  cotacaoInfo: { flex: 1, paddingVertical: 14, paddingHorizontal: 14 },
  cotacaoTitulo: { fontSize: 14, fontWeight: '700', color: '#1A2E1A' },
  cotacaoMeta: { fontSize: 11, color: '#8FA08F', marginTop: 3 },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 14,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ECF0EC',
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1A2E1A', marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: '#8FA08F', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptyBtn: {
    backgroundColor: '#1F4E1F',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  headerBtnSair: {
    backgroundColor: 'rgba(198,40,40,0.18)',
    borderColor: 'rgba(198,40,40,0.3)',
  },
  headerBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
"""

path_home = os.path.join(os.path.dirname(__file__), 'src', 'screens', 'ConsultorHomeScreen.tsx')
with open(path_home, 'w', encoding='utf-8') as f:
    f.write(home)
print('ConsultorHomeScreen written OK')
