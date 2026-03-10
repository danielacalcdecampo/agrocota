import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  StatusBar,
  Share,
  Alert,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Animated,
  UIManager,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeContext';
import { RootStackParamList } from '../navigation/AppNavigator';

const NETLIFY = 'https://agrocota64-ctrl.github.io/aceite-agrocota/';

interface Cotacao {
  id: string;
  titulo: string;
  status: string;
  created_at: string;
  approval_token: string | null;
  proposta_aceita_id?: string | null;
  fazendas: { nome: string } | { nome: string }[] | null;
  talhoes?: { nome: string; area_ha: number | null } | { nome: string; area_ha: number | null }[] | null;
  itens_count?: number;
  propostas_count?: number;
}

type StatusKey = 'enviada' | 'aprovada' | 'recusada';
type FilterKey = 'todas' | StatusKey;

const STATUS_LABEL: Record<StatusKey, string> = {
  enviada: 'Aguardando',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
};

const STATUS_COLOR: Record<StatusKey, string> = {
  enviada: '#E07B00',
  aprovada: '#1A7A3A',
  recusada: '#B91C1C',
};

const STATUS_BG: Record<StatusKey, string> = {
  enviada: '#FFF3E0',
  aprovada: '#E8F5EC',
  recusada: '#FEECEC',
};

const STATUS_BG_DARK: Record<StatusKey, string> = {
  enviada: '#2A1E00',
  aprovada: '#0D2216',
  recusada: '#2A0A0A',
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CotacoesList'>;
};

function fazendaNome(f: Cotacao['fazendas']): string {
  if (!f) return '—';
  if (Array.isArray(f)) return f[0]?.nome ?? '—';
  return (f as { nome: string }).nome ?? '—';
}

function formatDateBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function normalizeCotacaoStatus(status: string): StatusKey {
  if (status === 'aprovada' || status === 'recusada') return status;
  return 'enviada';
}

// Skeleton shimmer para loading state (data-viz: reduz ansiedade de espera)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function SkeletonCard({ isDark }: { isDark: boolean }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });
  const bg = isDark ? '#1E2620' : '#E8EDE9';
  return (
    <View style={[s.card, s.skeletonCard, { backgroundColor: isDark ? '#161C17' : '#FFFFFF' }]}>
      <View style={[s.cardStatusBar, { backgroundColor: bg }]} />
      <View style={s.cardContent}>
        <View style={s.cardTopRow}>
          <Animated.View style={[s.skeletonBox, { backgroundColor: bg, opacity }]} />
          <View style={{ flex: 1, gap: 6 }}>
            <Animated.View style={[s.skeletonLine, { width: '70%', backgroundColor: bg, opacity }]} />
            <Animated.View style={[s.skeletonLine, { width: '40%', height: 10, backgroundColor: bg, opacity }]} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Animated.View style={[s.skeletonChip, { backgroundColor: bg, opacity }]} />
          <Animated.View style={[s.skeletonChip, { backgroundColor: bg, opacity }]} />
        </View>
      </View>
    </View>
  );
}

export default function CotacoesListScreen({ navigation }: Props) {
  const { session } = useAuth();
  const { isDark } = useThemeMode();
  const insets = useSafeAreaInsets();

  const [cotacoes, setCotacoes] = useState<Cotacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<FilterKey>('todas');

  const fetch = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data } = await supabase
      .from('cotacoes')
      .select('id, titulo, status, created_at, approval_token, proposta_aceita_id, fazendas(nome), talhoes(nome, area_ha)')
      .eq('consultor_id', session.user.id)
      .order('created_at', { ascending: false });

    if (!data) { setLoading(false); return; }

    const ids = data.map((c: any) => c.id);

    // Contagem de itens e propostas em paralelo
    const [itensRes, propRes] = await Promise.all([
      supabase.from('itens_cotacao').select('cotacao_id').in('cotacao_id', ids),
      supabase.from('propostas_fornecedor').select('cotacao_id, descartada').in('cotacao_id', ids),
    ]);

    const contagemItens: Record<string, number> = {};
    (itensRes.data ?? []).forEach((row: any) => {
      contagemItens[row.cotacao_id] = (contagemItens[row.cotacao_id] ?? 0) + 1;
    });

    const contagemPropostas: Record<string, number> = {};
    (propRes.data ?? []).forEach((row: any) => {
      if (row.descartada) return;
      contagemPropostas[row.cotacao_id] = (contagemPropostas[row.cotacao_id] ?? 0) + 1;
    });

    const enriched = data.map((c: any) => ({
      ...c,
      itens_count: contagemItens[c.id] ?? 0,
      propostas_count: contagemPropostas[c.id] ?? 0,
    }));

    setCotacoes(enriched as Cotacao[]);
    setLoading(false);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      fetch();
    }, [fetch]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetch();
    setRefreshing(false);
  };

  const handleShare = async (cotacao: Cotacao) => {
    if (!cotacao.approval_token) {
      Alert.alert('Sem link', 'Esta cotação não possui token de compartilhamento.');
      return;
    }
    const url = `${NETLIFY}?t=${cotacao.approval_token}`;
    try {
      await Share.share({
        message: `Cotação ${cotacao.titulo} — acesse e confirme os produtos:\n${url}`,
        url,
        title: cotacao.titulo,
      });
    } catch {
      Alert.alert('Link da cotação', url);
    }
  };

  const handleOpen = (cotacao: Cotacao) => {
    navigation.navigate('CotacaoGraficos', {
      cotacaoId: cotacao.id,
      shareToken: cotacao.approval_token ?? undefined,
    });
  };

  const handleOpenPropostas = (cotacao: Cotacao) => {
    navigation.navigate('PropostasFornecedor', { cotacaoId: cotacao.id, titulo: cotacao.titulo });
  };

  const toggleSelectCotacao = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const selectedCotacoes = useMemo(
    () => cotacoes.filter(c => selectedIds.includes(c.id)),
    [cotacoes, selectedIds],
  );

  const handleCompareSelected = () => {
    if (selectedIds.length < 2) {
      Alert.alert('Selecione cotações', 'Selecione ao menos 2 cotações para comparar.');
      return;
    }
    const first = selectedCotacoes[0];
    if (!first) return;
    navigation.navigate('CotacaoGraficos', {
      cotacaoId: first.id,
      shareToken: first.approval_token ?? undefined,
      compareCotacaoIds: selectedIds,
    });
  };

  const handleDelete = (cotacao: Cotacao) => {
    Alert.alert(
      'Excluir cotação',
      `Tem certeza que deseja excluir "${cotacao.titulo}"? Esta ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('itens_cotacao').delete().eq('cotacao_id', cotacao.id);
            const { error } = await supabase.from('cotacoes').delete().eq('id', cotacao.id);
            if (error) {
              Alert.alert('Erro', 'Não foi possível excluir. Tente novamente.');
            } else {
              setCotacoes(prev => prev.filter(x => x.id !== cotacao.id));
              setSelectedIds(prev => prev.filter(x => x !== cotacao.id));
            }
          },
        },
      ],
    );
  };

  const statusCounts = useMemo(() => {
    return cotacoes.reduce(
      (acc, cur) => {
        const normalizedStatus = normalizeCotacaoStatus(cur.status);
        acc[normalizedStatus] += 1;
        return acc;
      },
      { enviada: 0, aprovada: 0, recusada: 0 },
    );
  }, [cotacoes]);

  const filteredCotacoes = useMemo(() => {
    if (statusFilter === 'todas') return cotacoes;
    return cotacoes.filter(c => normalizeCotacaoStatus(c.status) === statusFilter);
  }, [cotacoes, statusFilter]);

  // ─── Design tokens ────────────────────────────────────────────────────────
  const t = {
    bg: isDark ? '#0C0F0D' : '#F5F7F5',
    surface: isDark ? '#161C17' : '#FFFFFF',
    surfaceElevated: isDark ? '#1C241E' : '#FFFFFF',
    border: isDark ? '#252E27' : '#E8EDE9',
    borderStrong: isDark ? '#2E3A30' : '#D5DDD6',
    headerBg: isDark ? '#0F1610' : '#0F3D1F',
    primary: '#1A6B30',
    primaryLight: isDark ? '#1E3A24' : '#EAF4ED',
    title: isDark ? '#ECF2EE' : '#0D1F13',
    text: isDark ? '#7A9480' : '#5A7060',
    textMuted: isDark ? '#4A6050' : '#8EA898',
    white: '#FFFFFF',
    danger: '#B91C1C',
    dangerBg: isDark ? '#1C0A0A' : '#FFF1F1',
  };

  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: 'todas', label: 'Todas', count: cotacoes.length },
    { key: 'enviada', label: 'Aguardando', count: statusCounts.enviada },
    { key: 'aprovada', label: 'Aprovadas', count: statusCounts.aprovada },
    { key: 'recusada', label: 'Recusadas', count: statusCounts.recusada },
  ];

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <StatusBar barStyle="light-content" backgroundColor={t.headerBg} />

      {/* ── Header ────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + 10, backgroundColor: t.headerBg }]}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.75}>
            <Text style={s.backBtnText}>‹ Voltar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate('NovaCotacao')}
            style={s.newBtn}
            activeOpacity={0.82}
          >
            <Text style={s.newBtnText}>Nova cotação</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.headerTitle}>Minhas Cotações</Text>
        <Text style={[s.headerSubtitle, { color: 'rgba(255,255,255,0.45)' }]}>
          {cotacoes.length} {cotacoes.length === 1 ? 'registro' : 'registros'}
        </Text>
      </View>

      {/* ── Filtros ───────────────────────────────────────────── */}
      <View style={[s.filterSection, { backgroundColor: t.headerBg }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filterRow}
        >
          {FILTERS.map(filter => {
            const active = statusFilter === filter.key;
            const statusKey = filter.key as StatusKey;
            const dotColor = filter.key === 'todas' ? t.white : STATUS_COLOR[statusKey];

            return (
              <TouchableOpacity
                key={filter.key}
                onPress={() => setStatusFilter(filter.key)}
                style={[
                  s.filterPill,
                  active
                    ? { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)' }
                    : { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.12)' },
                ]}
                activeOpacity={0.75}
              >
                {filter.key !== 'todas' && (
                  <View style={[s.filterDot, { backgroundColor: active ? dotColor : 'rgba(255,255,255,0.3)' }]} />
                )}
                <Text style={[s.filterPillText, { color: active ? '#FFFFFF' : 'rgba(255,255,255,0.5)' }]}>
                  {filter.label}
                </Text>
                <View style={[s.filterBadge, { backgroundColor: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)' }]}>
                  <Text style={[s.filterBadgeText, { color: active ? '#FFFFFF' : 'rgba(255,255,255,0.4)' }]}>
                    {filter.count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Lista ou Skeleton ─────────────────────────────────── */}
      {loading ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.listContent, { paddingBottom: 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {[1, 2, 3, 4, 5].map(i => (
            <SkeletonCard key={i} isDark={isDark} />
          ))}
        </ScrollView>
      ) : (
      <FlatList
        data={filteredCotacoes}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.primary]} tintColor={t.primary} />
        }
        contentContainerStyle={[
          s.listContent,
          { paddingBottom: selectedIds.length >= 2 ? insets.bottom + 100 : insets.bottom + 32 },
        ]}
        ListEmptyComponent={
          <View style={[s.emptyState, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[s.emptyTitle, { color: t.title }]}>Nenhuma cotação encontrada</Text>
            <Text style={[s.emptyDesc, { color: t.text }]}>
              {statusFilter === 'todas'
                ? 'Crie sua primeira cotação para começar.'
                : 'Nenhuma cotação neste filtro. Tente outro.'}
            </Text>
          </View>
        }
        renderItem={({ item: cotacao }) => {
          const selected = selectedIds.includes(cotacao.id);
          const knownStatus = normalizeCotacaoStatus(cotacao.status);
          const statusColor = STATUS_COLOR[knownStatus];
          const statusBg = isDark ? STATUS_BG_DARK[knownStatus] : STATUS_BG[knownStatus];
          const nProd = cotacao.itens_count ?? 0;
          const nProp = cotacao.propostas_count ?? 0;

          return (
            <View
              style={[
                s.card,
                {
                  backgroundColor: t.surface,
                  borderColor: selected ? t.primary : t.border,
                  borderWidth: selected ? 1.5 : 1,
                },
              ]}
            >
              <View style={[s.cardStatusBar, { backgroundColor: statusColor }]} />

              <TouchableOpacity
                style={s.cardContent}
                activeOpacity={0.9}
                onPress={() => handleOpen(cotacao)}
              >
                {/* Linha principal: checkbox | título | status */}
                <View style={s.cardTopRow}>
                  <TouchableOpacity
                    onPress={e => { e.stopPropagation(); toggleSelectCotacao(cotacao.id); }}
                    style={s.checkboxWrap}
                    activeOpacity={0.75}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <View style={[
                      s.checkbox,
                      { borderColor: selected ? t.primary : t.borderStrong, backgroundColor: selected ? t.primary : 'transparent' },
                    ]}>
                      {selected && <MaterialIcons name="check" size={12} color="#FFFFFF" />}
                    </View>
                  </TouchableOpacity>
                  <View style={s.cardTitleBlock}>
                    <Text style={[s.cardTitle, { color: t.title }]} numberOfLines={1}>{cotacao.titulo}</Text>
                    <Text style={[s.cardDate, { color: t.textMuted }]}>
                      {formatDateBR(cotacao.created_at)} · {fazendaNome(cotacao.fazendas)}
                    </Text>
                  </View>
                  <View style={[s.statusPill, { backgroundColor: statusBg }]}>
                    <Text style={[s.statusPillText, { color: statusColor }]}>{STATUS_LABEL[knownStatus]}</Text>
                  </View>
                </View>

                {/* Métricas: só produtos */}
                <View style={s.chipRow}>
                  <View style={[s.chip, { backgroundColor: nProd > 0 ? (isDark ? '#0D2216' : '#E8F4EC') : (isDark ? '#1A1A1A' : '#F0F0F0') }]}>
                    <MaterialIcons name="category" size={12} color={nProd > 0 ? t.primary : t.textMuted} />
                    <Text style={[s.chipText, { color: nProd > 0 ? t.primary : t.textMuted }]}>{nProd} produto{nProd !== 1 ? 's' : ''}</Text>
                  </View>
                </View>

                {/* Ações: Gráficos | Propostas | Compartilhar | Excluir */}
                <View style={s.iconRow}>
                  <TouchableOpacity style={s.iconBtn} onPress={() => handleOpen(cotacao)} activeOpacity={0.7}>
                    <MaterialIcons name="bar-chart" size={20} color={t.primary} />
                    <Text style={[s.iconLabel, { color: t.primary }]}>Gráficos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.iconBtn} onPress={() => handleOpenPropostas(cotacao)} activeOpacity={0.7}>
                    <MaterialIcons name="list-alt" size={20} color={nProp > 0 ? (isDark ? '#6B9EF7' : '#1E5AAF') : t.textMuted} />
                    <Text style={[s.iconLabel, { color: nProp > 0 ? (isDark ? '#6B9EF7' : '#1E5AAF') : t.textMuted }]}>Propostas</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.iconBtn}
                    onPress={() => handleShare(cotacao)}
                    disabled={!cotacao.approval_token}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="share" size={20} color={cotacao.approval_token ? t.title : t.textMuted} />
                    <Text style={[s.iconLabel, { color: cotacao.approval_token ? t.title : t.textMuted }]}>Compartilhar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.iconBtn} onPress={() => handleDelete(cotacao)} activeOpacity={0.7}>
                    <MaterialIcons name="delete-outline" size={20} color={t.danger} />
                    <Text style={[s.iconLabel, { color: t.danger }]}>Excluir</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </View>
          );
        }}
      />
      )}

      {/* ── Barra de comparação ───────────────────────────────── */}
      {selectedIds.length >= 2 && (
        <View style={[s.compareBarWrap, { bottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={[s.compareBar, { backgroundColor: t.primary }]} onPress={handleCompareSelected} activeOpacity={0.86}>
            <View style={s.compareBarInner}>
              <View style={[s.compareBadge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Text style={s.compareBadgeText}>{selectedIds.length}</Text>
              </View>
              <Text style={s.compareBarText}>Comparar selecionadas</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  loadRoot: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // ── Header
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  backBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  backBtnText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  newBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  newBtnText: {
    color: '#0F3D1F',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },

  // ── Filtros
  filterSection: {
    paddingBottom: 14,
  },
  filterRow: {
    paddingHorizontal: 20,
    gap: 8,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: 1,
    gap: 6,
  },
  filterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  filterBadge: {
    borderRadius: 100,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  filterBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Lista
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  // ── Card
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
    marginBottom: 10,
  },
  skeletonCard: {
    marginBottom: 12,
  },
  skeletonBox: { width: 20, height: 20, borderRadius: 5 },
  skeletonLine: { height: 14, borderRadius: 4 },
  skeletonChip: { width: 48, height: 24, borderRadius: 12 },
  cardStatusBar: {
    width: 3,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  cardContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },

  // Topo do card
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkboxWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleBlock: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  cardDate: {
    fontSize: 12,
    fontWeight: '400',
  },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
  },

  metaLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  metaValue: { fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },

  // Chips de métricas (data-viz)
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Ações em ícones (UX minimalista)
  iconRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.15)',
  },
  iconBtn: {
    alignItems: 'center',
    gap: 2,
  },
  iconLabel: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Progressive disclosure
  alertStripText: {
    fontSize: 11,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.35,
  },

  // Estado vazio
  emptyState: {
    borderRadius: 14,
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 8,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  emptyDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },

  // Barra de comparação
  compareBarWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  compareBar: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  compareBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  compareBadge: {
    borderRadius: 100,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compareBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  compareBarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});