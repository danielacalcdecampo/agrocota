import React, { useState, useEffect, useCallback, Fragment } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Alert,
  Animated,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeContext';
import { Colors } from '../theme/colors';
import { RootStackParamList } from '../navigation/AppNavigator';
import { gerarRelatorioAdminPdf } from '../services/AdminRelatorioPdfService';

const ADMIN_EMAIL = 'agrocota64@gmail.com';

function fmtBRL(n: number) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function SimpleBarChart({ data, isDark }: { data: { label: string; value: number; color: string }[]; isDark: boolean }) {
  const maxV = Math.max(...data.map(d => d.value), 1);
  const barH = 100;
  const tc = isDark ? '#E9F2EC' : '#1A2C22';
  const mc = isDark ? '#7A9B85' : '#6B7B70';
  return (
    <View style={{
      backgroundColor: isDark ? '#1A2420' : '#FFFFFF',
      borderRadius: 16,
      padding: 20,
      marginVertical: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.3 : 0.08,
      shadowRadius: 8,
      elevation: 4,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: barH + 50 }}>
        {data.map((item, i) => {
          const h = maxV > 0 ? (item.value / maxV) * barH : 0;
          return (
            <View key={i} style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: tc, marginBottom: 8 }}>{fmtBRL(item.value)}</Text>
              <View style={{
                width: 44,
                minHeight: 4,
                height: Math.max(h, 4),
                backgroundColor: item.color,
                borderTopLeftRadius: 10,
                borderTopRightRadius: 10,
                marginBottom: 10,
              }} />
              <Text numberOfLines={2} style={{ fontSize: 11, fontWeight: '600', color: mc, textAlign: 'center' }}>{item.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AdminDashboard'>;
};

export default function AdminDashboardScreen({ navigation }: Props) {
  const { session } = useAuth();
  const { isDark } = useThemeMode();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'properties' | 'cotacoes'>('overview');

  // Overview stats
  const [nUsersAtivos, setNUsersAtivos] = useState(0);
  const [nUsersExcluidos, setNUsersExcluidos] = useState(0);
  const [nNovos24h, setNNovos24h] = useState(0);
  const [nNovos7d, setNNovos7d] = useState(0);
  const [nNovos30d, setNNovos30d] = useState(0);
  const [nCotacoes, setNCotacoes] = useState(0);
  const [nPropriedades, setNPropriedades] = useState(0);
  const [totalHa, setTotalHa] = useState(0);

  const [usersAtivos, setUsersAtivos] = useState<any[]>([]);
  const [usersExcluidos, setUsersExcluidos] = useState<any[]>([]);
  const [userFilter, setUserFilter] = useState<'todos' | '24h' | '7d' | '30d'>('todos');
  const [fazendas, setFazendas] = useState<any[]>([]);
  const [cotacoes, setCotacoes] = useState<any[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, any>>({});
  const [propostasCountMap, setPropostasCountMap] = useState<Record<string, { total: number; aceitas: number; descartadas: number }>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const bg = isDark ? '#0F1712' : Colors.background;
  const cardBg = isDark ? '#17241C' : Colors.surface;
  const border = isDark ? '#24372B' : Colors.border;
  const tc = isDark ? '#E9F2EC' : Colors.textPrimary;
  const tcMuted = isDark ? '#7A9B85' : Colors.textSecondary;

  const loadAll = useCallback(async () => {
    try {
      const now = new Date();
      const d24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [profilesRes, fazendasRes, cotacoesRes, talhoesRes, propostasRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, company_name, role, status, original_email, deleted_at, created_at'),
        supabase.from('fazendas').select('id, nome, municipio, estado, area_total_ha, consultor_id, produtor_nome, created_at'),
        supabase.from('cotacoes').select('id, titulo, status, fazenda_id, consultor_id, area_ha, created_at, approval_token, proposta_aceita_id'),
        supabase.from('talhoes').select('id, area_ha, fazenda_id'),
        supabase.from('propostas_fornecedor').select('id, cotacao_id, descartada'),
      ]);

      const profiles = (profilesRes.data ?? []) as any[];
      const allFazendas = (fazendasRes.data ?? []) as any[];
      const allCotacoes = (cotacoesRes.data ?? []) as any[];
      const allTalhoes = (talhoesRes.data ?? []) as any[];

      const ativos = profiles.filter(p => p.status !== 'deleted');
      const excluidos = profiles.filter(p => p.status === 'deleted');
      setNUsersAtivos(ativos.length);
      setNUsersExcluidos(excluidos.length);
      setNNovos24h(ativos.filter(p => p.created_at >= d24).length);
      setNNovos7d(ativos.filter(p => p.created_at >= d7).length);
      setNNovos30d(ativos.filter(p => p.created_at >= d30).length);

      setUsersAtivos(ativos);
      setUsersExcluidos(excluidos);
      setNCotacoes(allCotacoes.length);
      setNPropriedades(allFazendas.length);

      const haTalhoes = allTalhoes.reduce((s, t) => s + (Number(t.area_ha) || 0), 0);
      const haFazendas = allFazendas.reduce((s, f) => s + (Number(f.area_total_ha) || 0), 0);
      setTotalHa(haTalhoes > 0 ? haTalhoes : haFazendas);

      setFazendas(allFazendas);
      setCotacoes(allCotacoes);

      const cotacoesWithAceita = new Map<string, string>();
      (allCotacoes as any[]).forEach((c: any) => {
        if (c.proposta_aceita_id) cotacoesWithAceita.set(c.id, c.proposta_aceita_id);
      });
      const propMap: Record<string, { total: number; aceitas: number; descartadas: number }> = {};
      (propostasRes.data ?? []).forEach((p: any) => {
        const cid = p.cotacao_id;
        if (!propMap[cid]) propMap[cid] = { total: 0, aceitas: 0, descartadas: 0 };
        propMap[cid].total++;
        if (p.id === cotacoesWithAceita.get(cid)) propMap[cid].aceitas++;
        if (p.descartada) propMap[cid].descartadas++;
      });
      setPropostasCountMap(propMap);

      const pm: Record<string, any> = {};
      profiles.forEach(p => { pm[p.id] = p; });
      setProfilesMap(pm);
    } catch (e) {
      console.warn('[Admin] Erro:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filteredUsers = userFilter === 'todos'
    ? usersAtivos
    : userFilter === '24h'
      ? usersAtivos.filter(u => u.created_at >= new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      : userFilter === '7d'
        ? usersAtivos.filter(u => u.created_at >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        : usersAtivos.filter(u => u.created_at >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const handleGerarPdf = async (userId: string) => {
    setPdfLoading(true);
    try {
      await gerarRelatorioAdminPdf(userId);
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Erro ao gerar PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  if (session?.user?.email !== ADMIN_EMAIL) {
    return (
      <View style={[s.container, { backgroundColor: bg }]}>
        <View style={[s.header, { paddingTop: insets.top + 8, backgroundColor: cardBg, borderBottomColor: border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color={tc} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: tc }]}>Admin</Text>
        </View>
        <View style={s.denied}>
          <MaterialIcons name="lock" size={64} color={tcMuted} />
          <Text style={[s.deniedText, { color: tc }]}>Acesso restrito</Text>
        </View>
      </View>
    );
  }

  const overviewChartData = [
    { label: 'Ativos', value: nUsersAtivos, color: Colors.primary },
    { label: 'Excluídos', value: nUsersExcluidos, color: '#B82828' },
    { label: 'Cotações', value: nCotacoes, color: Colors.secondary },
    { label: 'Propriedades', value: nPropriedades, color: '#2563EB' },
  ];

  const renderOverview = () => (
    <>
      <Text style={[s.sectionTitle, { color: tc }]}>Visão geral</Text>
      <SimpleBarChart data={overviewChartData} isDark={isDark} />

      <View style={[s.statsGrid, { backgroundColor: cardBg, borderColor: border }]}>
        <View style={s.statItem}>
          <Text style={[s.statNum, { color: Colors.primary }]}>{nUsersAtivos}</Text>
          <Text style={[s.statLabel, { color: tcMuted }]}>Usuários ativos</Text>
        </View>
        <View style={s.statItem}>
          <Text style={[s.statNum, { color: '#B82828' }]}>{nUsersExcluidos}</Text>
          <Text style={[s.statLabel, { color: tcMuted }]}>Contas excluídas</Text>
        </View>
        <View style={s.statItem}>
          <Text style={[s.statNum, { color: Colors.secondary }]}>{nCotacoes}</Text>
          <Text style={[s.statLabel, { color: tcMuted }]}>Cotações</Text>
        </View>
        <View style={s.statItem}>
          <Text style={[s.statNum, { color: '#2563EB' }]}>{nPropriedades}</Text>
          <Text style={[s.statLabel, { color: tcMuted }]}>Propriedades</Text>
        </View>
        <View style={[s.statItem, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }]}>
          <Text style={[s.statNum, { color: Colors.success }]}>{fmtBRL(totalHa)} ha</Text>
          <Text style={[s.statLabel, { color: tcMuted }]}>Total de hectares</Text>
        </View>
      </View>

      <Text style={[s.sectionTitle, { color: tc }]}>Novos cadastros</Text>
      <View style={[s.statsRow, { backgroundColor: cardBg, borderColor: border }]}>
        <View style={s.miniStat}><Text style={[s.miniNum, { color: tc }]}>{nNovos24h}</Text><Text style={[s.miniLabel, { color: tcMuted }]}>24h</Text></View>
        <View style={s.miniStat}><Text style={[s.miniNum, { color: tc }]}>{nNovos7d}</Text><Text style={[s.miniLabel, { color: tcMuted }]}>7 dias</Text></View>
        <View style={s.miniStat}><Text style={[s.miniNum, { color: tc }]}>{nNovos30d}</Text><Text style={[s.miniLabel, { color: tcMuted }]}>30 dias</Text></View>
      </View>
    </>
  );

  const renderUsers = () => (
    <>
      <Text style={[s.sectionTitle, { color: tc }]}>Usuários ativos ({usersAtivos.length})</Text>
      <View style={[s.filterRow, { backgroundColor: cardBg, borderColor: border }]}>
        {(['todos', '24h', '7d', '30d'] as const).map(f => (
          <TouchableOpacity key={f} onPress={() => setUserFilter(f)} style={[s.filterBtn, userFilter === f && s.filterBtnActive]}>
            <Text style={[s.filterText, { color: userFilter === f ? '#FFF' : tcMuted }]}>
              {f === 'todos' ? 'Todos' : f === '24h' ? '24h' : f === '7d' ? '7 dias' : '30 dias'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[s.subSection, { color: tcMuted }]}>
        {userFilter === 'todos' ? `${filteredUsers.length} ativos` : `${filteredUsers.length} novos`}
      </Text>
      {filteredUsers.slice(0, 50).map((u) => (
        <View key={u.id} style={[s.listItem, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={[s.listTitle, { color: tc }]}>{u.full_name || u.company_name || '—'}</Text>
          <Text style={[s.listSub, { color: tcMuted }]}>{u.role || '—'} • {u.company_name || ''}</Text>
          <Text style={[s.listDate, { color: tcMuted }]}>{new Date(u.created_at).toLocaleDateString('pt-BR')}</Text>
          <TouchableOpacity onPress={() => handleGerarPdf(u.id)} style={[s.pdfBtn, { backgroundColor: Colors.primary }]} disabled={pdfLoading}>
            <MaterialIcons name="picture-as-pdf" size={16} color="#FFF" />
            <Text style={s.pdfBtnText}>Relatório PDF</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={[s.sectionTitle, { color: tc }]}>Usuários excluídos ({usersExcluidos.length})</Text>
      {usersExcluidos.map((u) => (
        <View key={u.id} style={[s.listItem, { backgroundColor: cardBg, borderColor: border, borderLeftColor: '#B82828', borderLeftWidth: 4 }]}>
          <Text style={[s.listTitle, { color: tc }]}>{u.full_name || u.company_name || '—'}</Text>
          <Text style={[s.listSub, { color: tcMuted }]}>E-mail: {u.original_email || '—'}</Text>
          <Text style={[s.listDate, { color: tcMuted }]}>Excluído em {u.deleted_at ? new Date(u.deleted_at).toLocaleDateString('pt-BR') : '—'}</Text>
          <TouchableOpacity onPress={() => handleGerarPdf(u.id)} style={[s.pdfBtn, { backgroundColor: Colors.primary }]} disabled={pdfLoading}>
            <MaterialIcons name="picture-as-pdf" size={16} color="#FFF" />
            <Text style={s.pdfBtnText}>Relatório PDF</Text>
          </TouchableOpacity>
        </View>
      ))}
    </>
  );

  const fazendasPorUsuario = fazendas.reduce((acc, f) => {
    const uid = f.consultor_id || 'sem-usuario';
    if (!acc[uid]) acc[uid] = [];
    acc[uid].push(f);
    return acc;
  }, {} as Record<string, any[]>);

  const renderProperties = () => (
    <>
      <Text style={[s.sectionTitle, { color: tc }]}>Propriedades por usuário ({fazendas.length})</Text>
      {Object.entries(fazendasPorUsuario).map(([consultorId, list]) => {
        const p = profilesMap[consultorId] || {};
        const nomeConsultor = consultorId === 'sem-usuario' ? 'Sem usuário vinculado' : (p.full_name || p.company_name || 'Usuário sem nome');
        return (
          <View key={consultorId} style={[s.userGroup, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={[s.userGroupTitle, { color: Colors.primary }]}>{nomeConsultor}</Text>
            <Text style={[s.userGroupSub, { color: tcMuted }]}>{list.length} propriedade(s)</Text>
            {list.map((f) => (
              <View key={f.id} style={[s.listItem, { backgroundColor: isDark ? '#0F1712' : '#F8FAF8', borderColor: border }]}>
                <Text style={[s.listTitle, { color: tc }]}>{f.nome}</Text>
                <Text style={[s.listSub, { color: tcMuted }]}>{f.municipio || '—'} / {f.estado || '—'}</Text>
                <Text style={[s.listSub, { color: tcMuted }]}>Produtor: {f.produtor_nome || '—'} • {Number(f.area_total_ha) || 0} ha</Text>
              </View>
            ))}
          </View>
        );
      })}
    </>
  );

  const excludedIds = new Set(usersExcluidos.map(u => u.id));
  const cotacoesAtivas = cotacoes.filter(c => {
    const uid = c.consultor_id || 'sem-usuario';
    return uid === 'sem-usuario' ? true : !excludedIds.has(uid);
  });
  const cotacoesExcluidos = cotacoes.filter(c => {
    const uid = c.consultor_id;
    return uid && excludedIds.has(uid);
  });

  const cotacoesAtivasPorUsuario = cotacoesAtivas.reduce((acc, c) => {
    const uid = c.consultor_id || 'sem-usuario';
    if (!acc[uid]) acc[uid] = [];
    acc[uid].push(c);
    return acc;
  }, {} as Record<string, any[]>);
  const cotacoesExcluidosPorUsuario = cotacoesExcluidos.reduce((acc, c) => {
    const uid = c.consultor_id || 'excl';
    if (!acc[uid]) acc[uid] = [];
    acc[uid].push(c);
    return acc;
  }, {} as Record<string, any[]>);

  const renderCotacaoCard = (c: any) => {
    const counts = propostasCountMap[c.id] || { total: 0, aceitas: 0, descartadas: 0 };
    return (
      <View style={[s.cotacaoCard, { backgroundColor: isDark ? '#0F1712' : '#FFFFFF', borderColor: border }]}>
        <View style={s.cotacaoCardHeader}>
          <Text style={[s.cotacaoCardTitle, { color: tc }]}>{c.titulo}</Text>
          <View style={s.badgeRow}>
            <View style={[s.badge, s.badgeStatus, c.status === 'aprovada' && { backgroundColor: '#16a34a20' }]}>
              <Text style={[s.badgeText, { color: c.status === 'aprovada' ? '#16a34a' : tcMuted }]}>{c.status || '—'}</Text>
            </View>
            <View style={s.badge}><Text style={[s.badgeText, { color: tcMuted }]}>{Number(c.area_ha) || 0} ha</Text></View>
          </View>
        </View>
        <View style={[s.badgeRow, { marginTop: 8 }]}>
          <View style={s.badge}><MaterialIcons name="storefront" size={12} color={tcMuted} /><Text style={[s.badgeText, { color: tcMuted }]}> {counts.total} propostas</Text></View>
          {counts.aceitas > 0 && <View style={[s.badge, s.badgeSuccess]}><Text style={s.badgeSuccessText}>✓ {counts.aceitas} aceita</Text></View>}
          {counts.descartadas > 0 && <View style={[s.badge, s.badgeDanger]}><Text style={s.badgeDangerText}>✕ {counts.descartadas} recusadas</Text></View>}
        </View>
        <View style={[s.cotacaoActions, { marginTop: 12 }]}>
          <TouchableOpacity style={[s.actionBtn, { backgroundColor: Colors.primary + '20' }]} onPress={() => navigation.navigate('Planilha', { cotacaoId: c.id, shareToken: c.approval_token || '', titulo: c.titulo, readOnly: true })}>
            <MaterialIcons name="visibility" size={18} color={Colors.primary} />
            <Text style={[s.actionBtnText, { color: Colors.primary }]}>Ver Planilha</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.actionBtn, { backgroundColor: Colors.secondary + '20' }]} onPress={() => navigation.navigate('PropostasFornecedor', { cotacaoId: c.id, titulo: c.titulo })}>
            <MaterialIcons name="storefront" size={18} color={Colors.secondary} />
            <Text style={[s.actionBtnText, { color: Colors.secondary }]}>Propostas</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#2563EB20' }]} onPress={() => navigation.navigate('CotacaoGraficos', { cotacaoId: c.id })}>
            <MaterialIcons name="bar-chart" size={18} color="#2563EB" />
            <Text style={[s.actionBtnText, { color: '#2563EB' }]}>Gráficos</Text>
          </TouchableOpacity>
        </View>
        <Text style={[s.cotacaoDate, { color: tcMuted }]}>{c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—'}</Text>
      </View>
    );
  };

  const renderCotacoes = () => (
    <>
      <Text style={[s.sectionTitle, { color: tc }]}>Cotações ativas ({cotacoesAtivas.length})</Text>
      {cotacoesAtivas.length === 0 ? (
        <View style={[s.emptyState, { backgroundColor: cardBg, borderColor: border }]}>
          <MaterialIcons name="description" size={32} color={tcMuted} />
          <Text style={[s.emptyStateText, { color: tcMuted }]}>Nenhuma cotação de usuários ativos</Text>
        </View>
      ) : Object.entries(cotacoesAtivasPorUsuario).map(([consultorId, list]) => {
        const p = profilesMap[consultorId] || {};
        const nomeConsultor = consultorId === 'sem-usuario' ? 'Sem usuário vinculado' : (p.full_name || p.company_name || 'Usuário sem nome');
        return (
          <View key={consultorId} style={[s.userGroup, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={[s.userGroupTitle, { color: Colors.primary }]}>{nomeConsultor}</Text>
            <Text style={[s.userGroupSub, { color: tcMuted }]}>{list.length} cotação(ões)</Text>
            {list.map((c) => <Fragment key={c.id}>{renderCotacaoCard(c)}</Fragment>)}
          </View>
        );
      })}

      {cotacoesExcluidos.length > 0 && (
        <>
          <Text style={[s.sectionTitle, { color: tc }]}>Cotações de usuários excluídos ({cotacoesExcluidos.length})</Text>
          <View style={[s.excludedBanner, { backgroundColor: '#B8282815', borderColor: '#B82828' }]}>
            <MaterialIcons name="person-off" size={20} color="#B82828" />
            <Text style={[s.excludedBannerText, { color: tc }]}>Cotações de contas excluídas — somente visualização</Text>
          </View>
          {Object.entries(cotacoesExcluidosPorUsuario).map(([consultorId, list]) => {
            const p = profilesMap[consultorId] || {};
            const nomeConsultor = p.full_name || p.company_name || p.original_email || 'Usuário excluído';
            return (
              <View key={consultorId} style={[s.userGroup, { backgroundColor: cardBg, borderColor: '#B82828', borderLeftWidth: 4 }]}>
                <Text style={[s.userGroupTitle, { color: '#B82828' }]}>{nomeConsultor}</Text>
                <Text style={[s.userGroupSub, { color: tcMuted }]}>{list.length} cotação(ões)</Text>
                {list.map((c) => <Fragment key={c.id}>{renderCotacaoCard(c)}</Fragment>)}
              </View>
            );
          })}
        </>
      )}
    </>
  );

  const tabs = [
    { key: 'overview' as const, label: 'Visão Geral', icon: 'dashboard' },
    { key: 'users' as const, label: 'Usuários', icon: 'people' },
    { key: 'properties' as const, label: 'Propriedades', icon: 'domain' },
    { key: 'cotacoes' as const, label: 'Cotações', icon: 'description' },
  ];

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <View style={[s.header, { paddingTop: insets.top + 8, backgroundColor: cardBg, borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color={tc} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: tc }]}>Painel Admin</Text>
      </View>

      <View style={[s.tabs, { backgroundColor: cardBg, borderBottomColor: border }]}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[s.tab, activeTab === t.key && { borderBottomColor: Colors.primary, borderBottomWidth: 2 }]}
          >
            <MaterialIcons name={t.icon as any} size={18} color={activeTab === t.key ? Colors.primary : tcMuted} />
            <Text style={[s.tabLabel, { color: activeTab === t.key ? Colors.primary : tcMuted }]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={s.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(); }} colors={[Colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'users' && renderUsers()}
          {activeTab === 'properties' && renderProperties()}
          {activeTab === 'cotacoes' && renderCotacoes()}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { marginRight: 12, padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 6 },
  tabLabel: { fontSize: 12, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, marginTop: 16 },
  subSection: { fontSize: 12, marginBottom: 8 },
  statsGrid: { padding: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 16 },
  statItem: { paddingVertical: 8 },
  statNum: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 12 },
  statsRow: { flexDirection: 'row', padding: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  miniStat: { flex: 1, alignItems: 'center' },
  miniNum: { fontSize: 24, fontWeight: '800' },
  miniLabel: { fontSize: 12 },
  filterRow: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  filterBtnActive: { backgroundColor: Colors.primary },
  filterText: { fontSize: 13, fontWeight: '600' },
  listItem: { padding: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  userGroup: { padding: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 16 },
  userGroupTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  userGroupSub: { fontSize: 12, marginBottom: 12 },
  cotacaoRow: { padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  cotacaoCard: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  cotacaoCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cotacaoCardTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeStatus: { backgroundColor: 'rgba(0,0,0,0.05)' },
  badgeText: { fontSize: 11, fontWeight: '600' },
  badgeSuccess: { backgroundColor: '#16a34a20' },
  badgeSuccessText: { fontSize: 11, fontWeight: '700', color: '#16a34a' },
  badgeDanger: { backgroundColor: '#B8282820' },
  badgeDangerText: { fontSize: 11, fontWeight: '700', color: '#B82828' },
  cotacaoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, gap: 6 },
  actionBtnText: { fontSize: 12, fontWeight: '700' },
  cotacaoDate: { fontSize: 11, marginTop: 8 },
  excludedBanner: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16, gap: 10 },
  excludedBannerText: { fontSize: 13, fontWeight: '600' },
  emptyState: { padding: 24, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', gap: 12 },
  emptyStateText: { fontSize: 14 },
  miniBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniBtnText: { fontSize: 12, fontWeight: '600' },
  listTitle: { fontSize: 15, fontWeight: '600' },
  listSub: { fontSize: 12, marginTop: 4 },
  listDate: { fontSize: 11, marginTop: 2 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, gap: 6, marginTop: 10 },
  pdfBtnText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  denied: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  deniedText: { fontSize: 18, fontWeight: '700', marginTop: 16 },
});
