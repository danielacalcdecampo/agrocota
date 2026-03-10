import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  StatusBar, TextInput, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConnectivity } from '../context/ConnectivityContext';
import { getCache, setCache } from '../services/OfflineSyncService';
import { useThemeMode } from '../context/ThemeContext';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'PropriedadesList'> };

interface Fazenda {
  id: string;
  nome: string;
  produtor_nome: string | null;
  municipio: string | null;
  estado: string | null;
  area_total_ha: number | null;
  cultura_principal: string | null;
  latitude: number | null;
  longitude: number | null;
}

const CACHE_KEY_FAZENDAS = (uid: string) => `fazendas_${uid}`;

export default function PropriedadesListScreen({ navigation }: Props) {
  const { session } = useAuth();
  const { isDark } = useThemeMode();
  const { isOnline } = useConnectivity();
  const insets = useSafeAreaInsets();
  const [fazendas, setFazendas] = useState<Fazenda[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const fetchFazendas = useCallback(async () => {
    if (!session?.user?.id) return;
    const cacheKey = CACHE_KEY_FAZENDAS(session.user.id);
    if (!isOnline) {
      const cached = await getCache<Fazenda[]>(cacheKey);
      setFazendas(cached ?? []);
      setLoading(false);
      return;
    }
    try {
      const { data } = await supabase
        .from('fazendas')
        .select('id, nome, produtor_nome, municipio, estado, area_total_ha, cultura_principal, latitude, longitude')
        .eq('consultor_id', session.user.id)
        .order('nome');
      const list = (data as Fazenda[]) ?? [];
      setFazendas(list);
      await setCache(cacheKey, list);
    } catch {
      const cached = await getCache<Fazenda[]>(cacheKey);
      setFazendas(cached ?? []);
    } finally {
      setLoading(false);
    }
  }, [session, isOnline]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchFazendas(); }, [fetchFazendas]));

  const onRefresh = async () => { setRefreshing(true); await fetchFazendas(); setRefreshing(false); };

  const filtered = fazendas.filter(f =>
    f.nome.toLowerCase().includes(search.toLowerCase()) ||
    (f.produtor_nome ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const palette = {
    pageBg: isDark ? '#0F1712' : '#F7F8F7',
    headerBg: isDark ? '#111D16' : '#1F4E1F',
    searchWrapBg: isDark ? '#17241C' : '#FFFFFF',
    searchBorder: isDark ? '#24372B' : '#eee',
    searchInputBg: isDark ? '#1D2F24' : '#f2f4f2',
    searchText: isDark ? '#E8F2EC' : '#222',
    cardBg: isDark ? '#17241C' : '#fff',
    cardBorder: isDark ? '#24372B' : '#ECF0EC',
    cardNome: isDark ? '#E8F2EC' : '#1A2E1A',
    emptyTitle: isDark ? '#DCEBDD' : '#555',
    emptyDesc: isDark ? '#9FB4A7' : '#999',
    chevron: isDark ? '#8EA394' : '#ccc',
  };

  return (
    <View style={[s.root, { backgroundColor: palette.pageBg }]}>
      <StatusBar barStyle="light-content" backgroundColor={palette.headerBg} />
      <View style={[s.header, { paddingTop: insets.top + 14, backgroundColor: palette.headerBg }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8}>
          <Text style={s.backTxt}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Propriedades</Text>
        <View style={{ width: 88 }} />
      </View>

      <View style={[s.searchWrap, { backgroundColor: palette.searchWrapBg, borderBottomColor: palette.searchBorder }]}>
        <TextInput
          style={[s.searchInput, { backgroundColor: palette.searchInputBg, color: palette.searchText }]}
          placeholder="Buscar por nome ou produtor..."
          placeholderTextColor={isDark ? '#8EA394' : '#aaa'}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#2E7D32" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2E7D32']} />}
          contentContainerStyle={filtered.length === 0 ? s.center : s.list}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Text style={[s.emptyTitle, { color: palette.emptyTitle }]}>Nenhuma propriedade</Text>
              <Text style={[s.emptyDesc, { color: palette.emptyDesc }]}>Toque em + para cadastrar a primeira</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[s.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('DetalhePropriedade', { fazendaId: item.id })}
            >
              <View style={s.cardAccent} />
              <View style={s.cardBody}>
                <Text style={[s.cardNome, { color: palette.cardNome }]}>{item.nome}</Text>
                {item.produtor_nome ? <Text style={s.cardProd}>{item.produtor_nome}</Text> : null}
                <View style={s.cardMeta}>
                  {item.municipio ? <Text style={s.metaTag}>{item.municipio}{item.estado ? `/${item.estado}` : ''}</Text> : null}
                  {item.area_total_ha ? <Text style={s.metaTag}>{item.area_total_ha} ha</Text> : null}
                  {item.cultura_principal ? <Text style={s.metaTag}>{item.cultura_principal}</Text> : null}
                </View>
              </View>
              <Text style={[s.chevron, { color: palette.chevron }]}>{'>'}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity
        style={[s.fab, { bottom: insets.bottom + 28 }]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('CadastrarPropriedade', {})}
      >
        <Text style={s.fabTxt}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8F7' },
  header: {
    backgroundColor: '#1F4E1F', paddingTop: 14, paddingBottom: 16,
    minHeight: 80,
    paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    minWidth: 88, alignItems: 'center',
  },
  backTxt: { color: '#A5D6A7', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  searchWrap: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  searchInput: { backgroundColor: '#f2f4f2', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: '#222' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, gap: 10 },
  emptyWrap: { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#555', marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: '#999' },
  card: {
    backgroundColor: '#fff', borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#ECF0EC',
  },
  cardAccent: { width: 4, alignSelf: 'stretch', backgroundColor: '#2E7D32' },
  cardBody: { flex: 1, paddingVertical: 14, paddingHorizontal: 14 },
  cardNome: { fontSize: 15, fontWeight: '800', color: '#1A2E1A', marginBottom: 2 },
  cardProd: { fontSize: 13, color: '#4CAF50', fontWeight: '600', marginBottom: 6 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaTag: { backgroundColor: '#E8F5E9', color: '#2E7D32', fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chevron: { fontSize: 18, color: '#ccc', marginRight: 14 },
  fab: {
    position: 'absolute', bottom: 28, right: 24, width: 56, height: 56,  // bottom overridden by inline style
    backgroundColor: '#2E7D32', borderRadius: 28, justifyContent: 'center', alignItems: 'center',
    elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  fabTxt: { color: '#fff', fontSize: 30, fontWeight: '300', lineHeight: 34 },
});
