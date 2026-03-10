import React, { useEffect, useState, useCallback, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  StatusBar,
  Image,
  Animated,
  Platform,
  LayoutAnimation,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';
import { AgroQuote, getAgroQuotes } from '../services';
import {
  buscarNotificacoesNaoLidas,
  iniciarListenerPropostasFornecedor,
} from '../services/NotificacoesService';


// ─── Types ────────────────────────────────────────────────────────────────────
interface Stats {
  cotacoesAtivas: number;
  fazendas: number;
  aguardandoAprovacao: number;
  aprovadas: number;
  recusadas: number;
}

interface Cotacao {
  id: string;
  titulo: string;
  status: string;
  created_at: string;
  fazendas: { nome: string } | { nome: string }[] | null;
}

const STATUS_LABEL: Record<string, string> = {
  enviada: 'Aguardando',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
};

const STATUS_COLOR: Record<string, string> = {
  enviada: '#C8900A',
  aprovada: '#1A6B3A',
  recusada: '#B82828',
};

function normalizeCotacaoStatus(s: string): 'enviada' | 'aprovada' | 'recusada' {
  if (s === 'aprovada' || s === 'recusada') return s;
  return 'enviada';
}

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ConsultorHome'>;
};

// ─── Grupos de commodities ────────────────────────────────────────────────────
type DisplayGroup = 'graos' | 'pecuaria' | 'outros';

const GROUP_LABEL: Record<DisplayGroup, string> = {
  graos:    'Grãos',
  pecuaria: 'Pecuária',
  outros:   'Outros',
};

// Mapeamento: code → grupo de exibição
const CODE_TO_GROUP: Record<string, DisplayGroup> = {
  // Grãos
  SOYBEAN:      'graos',
  CORN:         'graos',
  WHEAT:        'graos',
  OATS:         'graos',
  SOYBEAN_MEAL: 'graos',
  SOYBEAN_OIL:  'graos',
  // Pecuária
  CATTLE:        'pecuaria',
  FEEDER_CATTLE: 'pecuaria',
  HOG:           'pecuaria',
  MILK:          'pecuaria',
  BUTTER:        'pecuaria',
  CHEESE:        'pecuaria',
  // Outros
  COFFEE:       'outros',
  SUGARCANE:    'outros',
  COTTON:       'outros',
  COCOA:        'outros',
  ORANGE_JUICE: 'outros',
  GASOLINE:     'outros',
  DIESEL:       'outros',
  TRACTOR_OIL:  'outros',
  LUMBER:       'outros',
};

// ─── Quote Ticker ─────────────────────────────────────────────────────────────
function QuoteTicker({ quotes, isDark }: { quotes: AgroQuote[]; isDark: boolean }) {
  const tickerAnim = useRef(new Animated.Value(0)).current;
  const containerWidth = useRef(0);
  const contentWidth = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const startAnim = useCallback(() => {
    if (contentWidth.current === 0 || containerWidth.current === 0) return;
    tickerAnim.setValue(0);
    const distance = contentWidth.current;
    animRef.current = Animated.loop(
      Animated.timing(tickerAnim, { toValue: -distance, duration: distance * 22, useNativeDriver: true })
    );
    animRef.current.start();
  }, [tickerAnim]);

  useEffect(() => {
    if (quotes.length > 0) { const t = setTimeout(startAnim, 300); return () => clearTimeout(t); }
  }, [quotes.length, startAnim]);
  useEffect(() => () => { animRef.current?.stop(); }, []);

  if (quotes.length === 0) return null;

  const bg     = isDark ? '#111D16' : '#F2F6F3';
  const border = isDark ? '#1E3028' : '#E8EFE9';
  const items  = [...quotes, ...quotes];
  const fmt = (v: number) =>
    new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  return (
    <View
      style={[tkS.wrap, { backgroundColor: bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }]}
      onLayout={e => { containerWidth.current = e.nativeEvent.layout.width; }}
    >
      <Animated.View
        style={[tkS.inner, { transform: [{ translateX: tickerAnim }] }]}
        onLayout={e => {
          const w = e.nativeEvent.layout.width / 2;
          if (w !== contentWidth.current) { contentWidth.current = w; startAnim(); }
        }}
      >
        {items.map((q, idx) => {
          const pct   = q.changePercent;
          const valid = pct != null && Number.isFinite(pct);
          const isUp  = valid && pct! > 0;
          const isDown = valid && pct! < 0;
          const chgColor = isUp
            ? (isDark ? '#5DB87A' : '#1A6B3A')
            : isDown ? (isDark ? '#E07070' : '#B82828')
            : (isDark ? '#3E5A48' : '#9AADA2');
          const pctTxt = valid ? `${isUp ? '+' : ''}${pct!.toFixed(2)}%` : '—';
          return (
            <View key={`${q.code}-${idx}`} style={tkS.item}>
              <Text style={[tkS.name, { color: isDark ? '#C8DDD2' : '#1A2C22' }]}>{q.shortLabel}</Text>
              <Text style={[tkS.val,  { color: isDark ? '#EAF2ED' : '#0D1F15' }]}>{fmt(q.value)}</Text>
              <Text style={[tkS.pct,  { color: chgColor }]}>{pctTxt}</Text>
              <Text style={[tkS.sep,  { color: isDark ? '#1E3028' : '#D8E8DE' }]}>{'  |  '}</Text>
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const tkS = StyleSheet.create({
  wrap:  { height: 32, overflow: 'hidden', flexDirection: 'row' },
  inner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  item:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name:  { fontSize: 11, fontWeight: '700' },
  val:   { fontSize: 11, fontWeight: '600' },
  pct:   { fontSize: 11, fontWeight: '600' },
  sep:   { fontSize: 11 },
});

// ─── Market Panel ─────────────────────────────────────────────────────────────
interface MarketPanelProps {
  quotes: AgroQuote[];
  loading: boolean;
  error: string | null;
  source: string;
  fetchedAt: string | null;
  usdBrl: number;
  isDark: boolean;
  onRefresh: () => void;
}

function MarketPanel({ quotes, loading, error, source, fetchedAt, usdBrl, isDark, onRefresh }: MarketPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeGroup, setActiveGroup] = useState<DisplayGroup>('graos');
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const p = {
    cardBg:      isDark ? '#111D16' : '#FFFFFF',
    cardBorder:  isDark ? '#1E3028' : '#E8EFE9',
    text:        isDark ? '#EAF2ED' : '#0D1F15',
    subText:     isDark ? '#5A7A68' : '#9AADA2',
    divider:     isDark ? '#1A2E22' : '#F0F5F1',
    tabBg:       isDark ? '#0D1812' : '#F3F6F4',
    tabActiveBg: isDark ? '#1A3A28' : '#E8F4ED',
    tabActiveText: isDark ? '#5DB87A' : '#1A6B3A',
    tabText:     isDark ? '#3E5A48' : '#9AADA2',
    up:          isDark ? '#5DB87A' : '#1A6B3A',
    down:        isDark ? '#E07070' : '#B82828',
    flat:        isDark ? '#4A6658' : '#B0C4B8',
    pillUpBg:    isDark ? 'rgba(93,184,122,0.12)' : 'rgba(26,107,58,0.08)',
    pillDownBg:  isDark ? 'rgba(224,112,112,0.12)' : 'rgba(184,40,40,0.08)',
    pillFlatBg:  isDark ? 'rgba(74,102,88,0.15)' : 'rgba(176,196,184,0.2)',
    usdBg:       isDark ? 'rgba(200,144,10,0.12)' : 'rgba(200,144,10,0.08)',
    usdText:     isDark ? '#FFD97D' : '#9A6B00',
    refreshColor: isDark ? '#3E5A48' : '#B0C4B8',
    expandBg:    isDark ? '#0D1812' : '#F7FAF8',
  };

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Animated.timing(rotateAnim, {
      toValue: expanded ? 0 : 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
    setExpanded(e => !e);
  };

  const arrowRotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const fmtTime = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const filteredQuotes = quotes.filter(q => CODE_TO_GROUP[q.code] === activeGroup);

  const fmt = (v: number) =>
    new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  return (
    <View style={[mp.card, { backgroundColor: p.cardBg, borderColor: p.cardBorder }]}>

      {/* ── Cabeçalho clicável ── */}
      <TouchableOpacity
        style={mp.header}
        onPress={toggleExpand}
        activeOpacity={0.8}
      >
        <View style={mp.headerLeft}>
          <Text style={[mp.title, { color: p.text }]}>Mercado Futuro</Text>

          <View style={mp.headerMeta}>
            {/* Dólar */}
            <View style={[mp.usdPill, { backgroundColor: p.usdBg }]}>
              <Text style={[mp.usdText, { color: p.usdText }]}>
                USD {usdBrl > 0 ? usdBrl.toFixed(2) : '—'}
              </Text>
            </View>

            {/* Horário */}
            {fetchedAt && (
              <Text style={[mp.updatedText, { color: p.subText }]}>
                {fmtTime(fetchedAt)}
              </Text>
            )}

            {/* Fonte */}
            <Text style={[mp.sourceText, { color: p.subText }]}>
              Yahoo Finance
            </Text>
          </View>
        </View>

        <View style={mp.headerRight}>
          {/* Refresh só quando expandido */}
          {expanded && (
            <TouchableOpacity
              onPress={e => { e.stopPropagation?.(); onRefresh(); }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}
              style={{ marginRight: 10 }}
            >
              <MaterialIcons name="refresh" size={17} color={p.refreshColor} />
            </TouchableOpacity>
          )}

          <Animated.View style={{ transform: [{ rotate: arrowRotate }] }}>
            <MaterialIcons
              name="keyboard-arrow-down"
              size={22}
              color={p.subText}
            />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {/* ── Conteúdo expandível ── */}
      {expanded && (
        <>
          {/* Tabs de grupo */}
          <View style={[mp.tabsRow, { backgroundColor: p.tabBg, borderTopColor: p.cardBorder, borderBottomColor: p.cardBorder }]}>
            {(['graos', 'pecuaria', 'outros'] as DisplayGroup[]).map(g => {
              const active = activeGroup === g;
              return (
                <TouchableOpacity
                  key={g}
                  style={[mp.tab, active && { backgroundColor: p.tabActiveBg }]}
                  onPress={() => setActiveGroup(g)}
                  activeOpacity={0.75}
                >
                  <Text style={[mp.tabText, { color: active ? p.tabActiveText : p.tabText }, active && mp.tabTextActive]}>
                    {GROUP_LABEL[g]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Rows */}
          {loading ? (
            <View style={mp.stateWrap}>
              <Text style={[mp.stateText, { color: p.subText }]}>Carregando...</Text>
            </View>
          ) : error ? (
            <View style={mp.stateWrap}>
              <Text style={[mp.errorText, { color: p.down }]}>{error}</Text>
            </View>
          ) : filteredQuotes.length === 0 ? (
            <View style={mp.stateWrap}>
              <Text style={[mp.stateText, { color: p.subText }]}>Sem dados disponíveis</Text>
            </View>
          ) : (
            filteredQuotes.map((q, i) => {
              const pct   = q.changePercent;
              const valid = pct != null && Number.isFinite(pct);
              const isUp  = valid && pct! > 0;
              const isDown = valid && pct! < 0;
              const changeColor = isUp ? p.up : isDown ? p.down : p.flat;
              const pillBg = isUp ? p.pillUpBg : isDown ? p.pillDownBg : p.pillFlatBg;
              const pctTxt = valid ? `${isUp ? '+' : ''}${pct!.toFixed(2)}%` : '—';
              const isLast = i === filteredQuotes.length - 1;

              return (
                <View
                  key={q.code}
                  style={[
                    mp.row,
                    !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.divider },
                  ]}
                >
                  {/* Nome + unidade */}
                  <View style={mp.rowLeft}>
                    <Text style={[mp.rowLabel, { color: p.text }]}>{q.label}</Text>
                    <Text style={[mp.rowUnit, { color: p.subText }]}>{q.unit}</Text>
                  </View>

                  {/* Valor + variação */}
                  <View style={mp.rowRight}>
                    <Text style={[mp.rowValue, { color: p.text }]}>{fmt(q.value)}</Text>
                    <View style={[mp.changePill, { backgroundColor: pillBg }]}>
                      <Text style={[mp.changeText, { color: changeColor }]}>{pctTxt}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </>
      )}
    </View>
  );
}

const mp = StyleSheet.create({
  card:        { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 20 },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  headerLeft:  { flex: 1, gap: 5 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  title:       { fontSize: 13, fontWeight: '700', letterSpacing: 0.1 },
  headerMeta:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  usdPill:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  usdText:     { fontSize: 11, fontWeight: '700' },
  updatedText: { fontSize: 10, fontWeight: '500' },
  sourceText:  { fontSize: 10 },

  // Tabs
  tabsRow:     {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
  },
  tab:         { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8 },
  tabText:     { fontSize: 11.5, fontWeight: '600' },
  tabTextActive: { fontWeight: '700' },

  // Rows
  row:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 16 },
  rowLeft:     { flex: 1, gap: 2 },
  rowLabel:    { fontSize: 13, fontWeight: '600' },
  rowUnit:     { fontSize: 10.5 },
  rowRight:    { alignItems: 'flex-end', gap: 4 },
  rowValue:    { fontSize: 14.5, fontWeight: '700', letterSpacing: -0.3 },
  changePill:  { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  changeText:  { fontSize: 11, fontWeight: '700' },

  // States
  stateWrap:  { paddingVertical: 22, alignItems: 'center' },
  stateText:  { fontSize: 13 },
  errorText:  { fontSize: 13 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ConsultorHomeScreen({ navigation }: Props) {
  const { signOut, session, refreshProfile, profile } = useAuth();
  const { isDark } = useThemeMode();
  const insets = useSafeAreaInsets();

  const p = {
    pageBg:      isDark ? '#0F1712' : '#F3F6F4',
    headerBg:    isDark ? '#0a1a0f' : '#0f4b1e',
    sectionLabel: isDark ? '#3E5A48' : '#9AADA2',
    cardBg:      isDark ? '#17241C' : '#FFFFFF',
    cardBorder:  isDark ? '#1E3028' : '#E8EFE9',
    text:        isDark ? '#D0E4D8' : '#1A2C22',
    mutedText:   isDark ? '#3E5A48' : '#9AADA2',
    primaryBg:   isDark ? '#1A4D2A' : '#1a5c25',
    actionBg:    isDark ? '#17241C' : '#FFFFFF',
    actionBorder: isDark ? '#1E3028' : '#E8EFE9',
    link:        isDark ? '#5DB87A' : '#1A6B3A',
    arrowBg:     isDark ? '#1A3028' : '#EBF5EF',
    arrowColor:  isDark ? '#5DB87A' : '#1F6B3A',
  };

  const [stats, setStats] = useState<Stats>({
    cotacoesAtivas: 0, fazendas: 0, aguardandoAprovacao: 0, aprovadas: 0, recusadas: 0,
  });
  const [recentes, setRecentes] = useState<Cotacao[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [badgeCount, setBadgeCount] = useState(0);

  const [agroQuotes, setAgroQuotes]     = useState<AgroQuote[]>([]);
  const [agroLoading, setAgroLoading]   = useState(true);
  const [agroError, setAgroError]       = useState<string | null>(null);
  const [agroSource, setAgroSource]     = useState('');
  const [agroFetchedAt, setAgroFetchedAt] = useState<string | null>(null);
  const [agroUsdBrl, setAgroUsdBrl]     = useState(0);

  interface CotacaoComProposta {
    cotacaoId: string;
    titulo: string;
    fazenda: string;
    totalPropostas: number;
    naoLidas: number;
    ultima: string;
  }
  const [propostasRecebidas, setPropostasRecebidas] = useState<CotacaoComProposta[]>([]);

  const carregarBadge = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const data = await buscarNotificacoesNaoLidas(session.user.id);
      // Verifica se é NotificacaoRow (tem 'lida') ou ConsultorNotificacaoRow (tem 'lida_em')
      setBadgeCount(data.filter(n => {
        if ('lida' in n) {
          return !n.lida;
        }
        if ('lida_em' in n) {
          return !n.lida_em;
        }
        return false;
      }).length);
    } catch {}
  }, [session?.user?.id]);

  const fetchData = useCallback(async () => {
    if (!session?.user?.id) return;
    const uid = session.user.id;
    const [cotRes, fazRes, recRes] = await Promise.all([
      supabase.from('cotacoes').select('id, status, titulo, proposta_aceita_id, fazendas(nome)').eq('consultor_id', uid),
      supabase.from('fazendas').select('id', { count: 'exact', head: true }).eq('consultor_id', uid),
      supabase.from('cotacoes')
        .select('id, titulo, status, created_at, fazendas(nome)')
        .eq('consultor_id', uid)
        .order('created_at', { ascending: false }),
    ]);
    const cots = (cotRes.data ?? []).map((c: any) => ({ ...c, status: normalizeCotacaoStatus(String(c.status ?? '')) }));
    setStats({
      cotacoesAtivas:     cots.filter((c: any) => c.status !== 'recusada').length,
      fazendas:           fazRes.count ?? 0,
      aguardandoAprovacao: cots.filter((c: any) => c.status === 'enviada').length,
      aprovadas:          cots.filter((c: any) => c.status === 'aprovada').length,
      recusadas:          cots.filter((c: any) => c.status === 'recusada').length,
    });
    setRecentes(((recRes.data ?? []) as Cotacao[]).map(c => ({ ...c, status: normalizeCotacaoStatus(String(c.status ?? '')) })));

    // Propostas: busca por cotacao_id (evita join complexo; RLS pode bloquear)
    const allCots = (cotRes.data ?? []) as any[];
    const cotacaoIds = allCots.map((c: any) => c.id);
    const cotById = new Map(allCots.map((c: any) => {
      const fazenda = c?.fazendas
        ? (Array.isArray(c.fazendas) ? c.fazendas[0]?.nome : c.fazendas?.nome) ?? ''
        : '';
      return [c.id, { titulo: c?.titulo ?? 'Cotação', fazenda }];
    }));
    const propMap = new Map<string, CotacaoComProposta>();
    if (cotacaoIds.length > 0) {
      const { data: propData, error: propErr } = await supabase
        .from('propostas_fornecedor')
        .select('id, cotacao_id, lida, created_at, descartada')
        .in('cotacao_id', cotacaoIds)
        .order('created_at', { ascending: false });
      if (propErr) console.warn('[ConsultorHome] Erro propostas:', propErr.message);
      for (const p of (propData ?? []) as any[]) {
        if (p.descartada) continue; // ignora propostas descartadas
        const cid = p.cotacao_id;
        const info = cotById.get(cid) ?? { titulo: 'Cotação', fazenda: '' };
        if (!propMap.has(cid)) {
          propMap.set(cid, {
            cotacaoId: cid,
            titulo: info.titulo,
            fazenda: info.fazenda,
            totalPropostas: 0,
            naoLidas: 0,
            ultima: p.created_at,
          });
        }
        const entry = propMap.get(cid)!;
        entry.totalPropostas += 1;
        if (!p.lida) entry.naoLidas += 1;
      }
    }
    // Mostra só cotações com propostas pendentes: sem descartadas e sem proposta aceita
    const cotsComPropostaAceita = new Set(
      (cotRes.data ?? []).filter((c: any) => c.proposta_aceita_id).map((c: any) => c.id)
    );
    setPropostasRecebidas(
      Array.from(propMap.values())
        .filter(c => c.totalPropostas > 0 && !cotsComPropostaAceita.has(c.cotacaoId))
    );

    await carregarBadge();
  }, [session, carregarBadge]);

  const fetchAgroData = useCallback(async () => {
    try {
      if (agroQuotes.length === 0) setAgroLoading(true);
      setAgroError(null);
      const result = await getAgroQuotes();
      setAgroQuotes(prev => {
        const m = new Map(prev.map(q => [q.code, q]));
        for (const q of result.quotes) m.set(q.code, q);
        return Array.from(m.values());
      });
      setAgroSource(result.source);
      setAgroFetchedAt(result.fetchedAt);
      setAgroUsdBrl(result.usdBrl ?? 5.75);
    } catch (e) {
      setAgroError(e instanceof Error ? e.message : 'Falha ao carregar cotações.');
    } finally {
      setAgroLoading(false);
    }
  }, [agroQuotes.length]);

  useFocusEffect(useCallback(() => {
    refreshProfile(); fetchData(); fetchAgroData();
  }, [fetchAgroData, fetchData, refreshProfile]));

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const t = setInterval(fetchAgroData, 5 * 60_000); return () => clearInterval(t); }, [fetchAgroData]);
  useEffect(() => { const sub = Notifications.addNotificationReceivedListener(() => fetchData()); return () => sub.remove(); }, [fetchData]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const stop = iniciarListenerPropostasFornecedor(session.user.id, () => setBadgeCount(prev => prev + 1));
    return stop;
  }, [session?.user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshProfile(), fetchData(), fetchAgroData()]);
    setRefreshing(false);
  };

  const displayName  = (profile?.full_name || 'Consultor').trim();
  const companyName  = (profile?.company_name || '').trim();
  const identityName = companyName || displayName.split(' ')[0] || 'Consultor';
  const initials     = displayName.split(' ').filter(Boolean).slice(0, 2).map((x: string) => x[0]).join('').toUpperCase() || 'AC';

  const ActionCard = ({
    title, sub, icon, onPress,
  }: { title: string; sub: string; icon: string; onPress: () => void }) => (
    <TouchableOpacity
      style={[s.actionCard, { backgroundColor: p.actionBg, borderColor: p.actionBorder }]}
      onPress={onPress}
      activeOpacity={0.82}
    >
      <View style={[s.actionIconWrap, { backgroundColor: p.arrowBg }]}>
        <MaterialIcons name={icon as any} size={20} color={p.arrowColor} />
      </View>
      <Text style={[s.actionCardTitle, { color: p.text }]}>{title}</Text>
      <Text style={[s.actionCardSub,   { color: p.mutedText }]}>{sub}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[s.root, { backgroundColor: p.pageBg }]}>
      <StatusBar barStyle="light-content" backgroundColor={p.headerBg} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 14, backgroundColor: p.headerBg }]}>
        <View style={s.heroTop}>
          <View style={s.identityWrap}>
            <View style={s.avatarWrap}>
              {profile?.company_logo_url
                ? <Image source={{ uri: profile.company_logo_url }} style={s.avatarImage} />
                : <Text style={s.avatarInitials}>{initials}</Text>}
            </View>
            <View style={s.identityTextWrap}>
              <Text style={s.greetingText}>Olá,</Text>
              <Text style={s.identityName} numberOfLines={1}>{identityName}</Text>
            </View>
          </View>

          <View style={s.headerActions}>
            <TouchableOpacity style={[s.headerBtn, s.notifBtn]} onPress={() => navigation.navigate('Notificacoes')} activeOpacity={0.8}>
              <MaterialIcons name="notifications-none" size={19} color="#FFFFFF" />
              {badgeCount > 0 && (
                <View style={s.badge}><Text style={s.badgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text></View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={s.headerBtn} onPress={() => navigation.navigate('Profile')} activeOpacity={0.8}>
              <MaterialIcons name="person-outline" size={17} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.statsGrid}>
          {[
            { value: stats.cotacoesAtivas,      label: 'Ativas',    color: '#FFFFFF' },
            { value: stats.fazendas,             label: 'Fazendas',  color: '#A8D5B5' },
            { value: stats.aguardandoAprovacao,  label: 'Pendentes', color: '#FFD97D' },
            { value: propostasRecebidas.reduce((a, c) => a + c.naoLidas, 0) || propostasRecebidas.length, label: 'Propostas', color: propostasRecebidas.some(c => c.naoLidas > 0) ? '#ffb400' : '#BFE7C9' },
          ].map((item, i, arr) => (
            <React.Fragment key={item.label}>
              <View style={s.statItem}>
                <Text style={[s.statNum, { color: item.color }]}>{item.value}</Text>
                <Text style={s.statLabel}>{item.label}</Text>
              </View>
              {i < arr.length - 1 && <View style={s.statSep} />}
            </React.Fragment>
          ))}
        </View>
      </View>

      {/* Ticker */}
      <QuoteTicker quotes={agroQuotes} isDark={isDark} />

      {/* Scroll */}
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 28 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1F6B3A']} tintColor="#1F6B3A" />}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Mercado Futuro (recolhível) ───────────────────────────────────── */}
        <MarketPanel
          quotes={agroQuotes}
          loading={agroLoading}
          error={agroError}
          source={agroSource}
          fetchedAt={agroFetchedAt}
          usdBrl={agroUsdBrl}
          isDark={isDark}
          onRefresh={fetchAgroData}
        />

        {/* ─── Ações Rápidas ─────────────────────────────────────────────────── */}
        <Text style={[s.sectionLabel, { color: p.sectionLabel }]}>AÇÕES RÁPIDAS</Text>

        <TouchableOpacity
          style={[s.primaryAction, { backgroundColor: p.primaryBg }]}
          onPress={() => navigation.navigate('NovaCotacao')}
          activeOpacity={0.86}
        >
          <View style={[s.primaryActionIcon, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
            <MaterialIcons name="add-circle-outline" size={24} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.primaryActionTitle}>Nova Cotação</Text>
            <Text style={s.primaryActionSub}>Criar proposta de insumos</Text>
          </View>
          <MaterialIcons name="chevron-right" size={22} color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>

        <View style={s.actionGrid}>
          <ActionCard icon="home-work"       title="Fazendas"   sub={`${stats.fazendas} cadastradas`}   onPress={() => navigation.navigate('PropriedadesList')} />
          <ActionCard icon="description"     title="Cotações"   sub="Ver histórico"                     onPress={() => navigation.navigate('CotacoesList')} />
          <ActionCard icon="account-balance" title="Gestão"     sub="Financeira"                        onPress={() => navigation.navigate('GestaoFinanceira')} />
        </View>

        {/* ─── Propostas Recebidas ───────────────────────────────────────────── */}
        {propostasRecebidas.length > 0 && (
          <>
            <View style={s.sectionRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[s.sectionLabel, { color: p.sectionLabel, marginBottom: 0 }]}>PROPOSTAS RECEBIDAS</Text>
                {propostasRecebidas.reduce((acc, c) => acc + c.naoLidas, 0) > 0 && (
                  <View style={s.propBadge}>
                    <Text style={s.propBadgeText}>
                      {propostasRecebidas.reduce((acc, c) => acc + c.naoLidas, 0)} nova{propostasRecebidas.reduce((acc, c) => acc + c.naoLidas, 0) > 1 ? 's' : ''}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {propostasRecebidas.map((item) => (
              <TouchableOpacity
                key={item.cotacaoId}
                style={[s.propRow, { backgroundColor: p.cardBg, borderColor: item.naoLidas > 0 ? '#ffb400' : p.cardBorder }]}
                onPress={() => navigation.navigate('PropostasFornecedor', { cotacaoId: item.cotacaoId, titulo: item.titulo })}
                activeOpacity={0.78}
              >
                <View style={[s.propStripe, { backgroundColor: item.naoLidas > 0 ? '#ffb400' : p.link }]} />
                <MaterialIcons name="storefront" size={20} color={item.naoLidas > 0 ? '#ffb400' : p.link} style={{ marginLeft: 14, marginRight: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.propTitle, { color: p.text }]} numberOfLines={1}>{item.titulo}</Text>
                  {item.fazenda ? <Text style={[s.propSub, { color: p.mutedText }]} numberOfLines={1}>{item.fazenda}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4, paddingRight: 14 }}>
                  <Text style={[s.propCount, { color: item.naoLidas > 0 ? '#ffb400' : p.mutedText }]}>
                    {item.totalPropostas} proposta{item.totalPropostas > 1 ? 's' : ''}
                  </Text>
                  {item.naoLidas > 0 && (
                    <View style={s.propNovaBadge}><Text style={s.propNovaBadgeText}>{item.naoLidas} não lida{item.naoLidas > 1 ? 's' : ''}</Text></View>
                  )}
                </View>
                <MaterialIcons name="chevron-right" size={18} color={p.mutedText} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* ─── Cotações ──────────────────────────────────────────────────────── */}
        <View style={s.sectionRow}>
          <Text style={[s.sectionLabel, { color: p.sectionLabel, marginBottom: 0 }]}>COTAÇÕES</Text>
          <TouchableOpacity onPress={() => navigation.navigate('CotacoesList')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[s.linkText, { color: p.link }]}>Ver todas</Text>
          </TouchableOpacity>
        </View>

        {recentes.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: p.cardBg, borderColor: p.cardBorder }]}>
            <Text style={[s.emptyTitle, { color: p.text }]}>Nenhuma cotação ainda</Text>
            <Text style={[s.emptySub,   { color: p.mutedText }]}>Crie sua primeira cotação para começar</Text>
            <TouchableOpacity style={[s.emptyBtn, { backgroundColor: p.primaryBg }]} onPress={() => navigation.navigate('NovaCotacao')} activeOpacity={0.85}>
              <Text style={s.emptyBtnText}>Nova Cotação</Text>
            </TouchableOpacity>
          </View>
        ) : (
          recentes.map((c, i) => {
            const color   = STATUS_COLOR[c.status] ?? '#888';
            const label   = STATUS_LABEL[c.status] ?? c.status;
            const fazenda = Array.isArray(c.fazendas) ? (c.fazendas[0]?.nome ?? '') : (c.fazendas?.nome ?? '');
            const data    = new Date(c.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
            return (
              <TouchableOpacity
                key={c.id}
                style={[s.recentRow, { backgroundColor: p.cardBg, borderColor: p.cardBorder }, i === recentes.length - 1 && { marginBottom: 0 }]}
                onPress={() => navigation.navigate('CotacoesList')}
                activeOpacity={0.78}
              >
                <View style={[s.recentStripe, { backgroundColor: color }]} />
                <View style={s.recentInfo}>
                  <Text style={[s.recentTitle, { color: p.text }]} numberOfLines={1}>{c.titulo}</Text>
                  {fazenda ? <Text style={[s.recentSub, { color: p.mutedText }]} numberOfLines={1}>{fazenda}</Text> : null}
                </View>
                <View style={s.recentRight}>
                  <View style={[s.statusPill, { borderColor: color }]}>
                    <Text style={[s.statusPillText, { color }]}>{label}</Text>
                  </View>
                  <Text style={[s.recentDate, { color: p.mutedText }]}>{data}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1 },
  header: { paddingHorizontal: 18, paddingBottom: 18 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, gap: 10 },

  identityWrap:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarWrap:       { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', overflow: 'hidden' },
  avatarImage:      { width: '100%', height: '100%' },
  avatarInitials:   { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  identityTextWrap: { flex: 1 },
  greetingText:     { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  identityName:     { fontSize: 17, fontWeight: '700', color: '#FFFFFF', marginTop: 1 },

  headerActions:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerBtn:      { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  notifBtn:       { width: 36, height: 36, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  badge:          { minWidth: 15, height: 15, borderRadius: 8, paddingHorizontal: 3, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center', position: 'absolute', top: -2, right: -2 },
  badgeText:      { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  headerBtnText:  { fontSize: 12, fontWeight: '600', color: '#FFFFFF' },

  statsGrid: { flexDirection: 'row', alignItems: 'center' },
  statItem:  { flex: 1, alignItems: 'center' },
  statSep:   { width: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.1)' },
  statNum:   { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2, letterSpacing: 0.2 },

  scroll:        { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel:  { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 },
  sectionRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 24 },
  linkText:      { fontSize: 13, fontWeight: '600' },

  primaryAction:      { borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 },
  primaryActionIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryActionTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 },
  primaryActionSub:   { fontSize: 12, color: 'rgba(255,255,255,0.6)' },

  actionGrid:      { flexDirection: 'row', gap: 8, marginBottom: 4 },
  actionCard:      { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12, gap: 8 },
  actionIconWrap:  { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionCardTitle: { fontSize: 13, fontWeight: '700' },
  actionCardSub:   { fontSize: 11 },

  recentRow:      { borderRadius: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', paddingRight: 14, paddingVertical: 13, overflow: 'hidden', borderWidth: 1 },
  recentStripe:   { width: 3, alignSelf: 'stretch', marginRight: 14, minHeight: 38 },
  recentInfo:     { flex: 1 },
  recentTitle:    { fontSize: 14, fontWeight: '600' },
  recentSub:      { fontSize: 12, marginTop: 3 },
  recentRight:    { alignItems: 'flex-end', gap: 5 },
  statusPill:     { borderRadius: 20, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  statusPillText: { fontSize: 11, fontWeight: '600' },
  recentDate:     { fontSize: 11 },

  emptyCard:    { borderRadius: 16, borderWidth: 1, padding: 24, gap: 6 },
  emptyTitle:   { fontSize: 15, fontWeight: '700' },
  emptySub:     { fontSize: 13, lineHeight: 20 },
  emptyBtn:     { marginTop: 10, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-start' },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  propRow:          { borderRadius: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', paddingVertical: 13, overflow: 'hidden', borderWidth: 1.5 },
  propStripe:       { width: 3, alignSelf: 'stretch', minHeight: 38 },
  propTitle:        { fontSize: 14, fontWeight: '600' },
  propSub:          { fontSize: 12, marginTop: 3 },
  propCount:        { fontSize: 12, fontWeight: '600' },
  propBadge:        { backgroundColor: '#ffb400', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  propBadgeText:    { fontSize: 10, fontWeight: '800', color: '#000' },
  propNovaBadge:    { backgroundColor: 'rgba(255,180,0,0.15)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  propNovaBadgeText:{ fontSize: 10, fontWeight: '700', color: '#b07a00' },
});