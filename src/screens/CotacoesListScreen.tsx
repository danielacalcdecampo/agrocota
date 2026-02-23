import React, { useCallback, useState } from 'react';
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
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../navigation/AppNavigator';

const NETLIFY = 'https://eloquent-belekoy-0f88af.netlify.app';

interface Cotacao {
  id: string;
  titulo: string;
  status: string;
  created_at: string;
  approval_token: string | null;
  fazendas: { nome: string } | { nome: string }[] | null;
}

const STATUS_LABEL: Record<string, string> = {
  rascunho:  'Rascunho',
  enviada:   'Enviada',
  aprovada:  'Aprovada',
  recusada:  'Recusada',
};
const STATUS_COLOR: Record<string, string> = {
  rascunho: '#78909C',
  enviada:  '#F57C00',
  aprovada: '#2E7D32',
  recusada: '#C62828',
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CotacoesList'>;
};

function fazendaNome(f: Cotacao['fazendas']): string {
  if (!f) return '-';
  if (Array.isArray(f)) return f[0]?.nome ?? '-';
  return (f as { nome: string }).nome ?? '-';
}

export default function CotacoesListScreen({ navigation }: Props) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data } = await supabase
      .from('cotacoes')
      .select('id, titulo, status, created_at, approval_token, fazendas(nome)')
      .eq('consultor_id', session.user.id)
      .order('created_at', { ascending: false });
    setCotacoes((data ?? []) as Cotacao[]);
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

  const handleShare = async (c: Cotacao) => {
    if (!c.approval_token) {
      Alert.alert('Sem link', 'Esta cotacao nao possui token de compartilhamento.');
      return;
    }
    const url = `${NETLIFY}?t=${c.approval_token}`;
    try {
      await Share.share({
        message: `Cotacao ${c.titulo} — acesse e confirme os produtos:\n${url}`,
        url,
        title: c.titulo,
      });
    } catch {
      Alert.alert('Link da cotacao', url);
    }
  };

  const handleOpen = (c: Cotacao) => {
    if (!c.approval_token) {
      Alert.alert('Sem graficos', 'Esta cotacao ainda nao possui itens importados.');
      return;
    }
    navigation.navigate('CotacaoGraficos', {
      cotacaoId: c.id,
      shareToken: c.approval_token,
    });
  };

  const handleDelete = (c: Cotacao) => {
    Alert.alert(
      'Excluir cotacao',
      `Tem certeza que deseja excluir "${c.titulo}"? Esta acao nao pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            // Remove itens primeiro (FK), depois a cotacao
            await supabase.from('itens_cotacao').delete().eq('cotacao_id', c.id);
            const { error } = await supabase.from('cotacoes').delete().eq('id', c.id);
            if (error) {
              Alert.alert('Erro', 'Nao foi possivel excluir. Tente novamente.');
            } else {
              setCotacoes(prev => prev.filter(x => x.id !== c.id));
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={s.loadRoot}>
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#1F4E1F" />

      {/* HEADER */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={s.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.backText}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Minhas Cotacoes</Text>
        <Text style={s.headerSub}>{cotacoes.length} cotacoes</Text>
      </View>

      <FlatList
        data={cotacoes}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2E7D32']} />
        }
        contentContainerStyle={s.list}
        ListEmptyComponent={
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Nenhuma cotacao</Text>
            <Text style={s.emptyDesc}>Crie uma cotacao em Nova Cotacao</Text>
          </View>
        }
        renderItem={({ item: c }) => (
          <TouchableOpacity
            style={s.card}
            activeOpacity={0.82}
            onPress={() => handleOpen(c)}
          >
            {/* status accent bar */}
            <View style={[s.accent, { backgroundColor: STATUS_COLOR[c.status] ?? '#ccc' }]} />

            <View style={s.cardBody}>
              {/* top row */}
              <View style={s.topRow}>
                <Text style={s.titulo} numberOfLines={1}>{c.titulo}</Text>
                <View style={[s.badge, { backgroundColor: (STATUS_COLOR[c.status] ?? '#888') + '18' }]}>
                  <Text style={[s.badgeText, { color: STATUS_COLOR[c.status] ?? '#888' }]}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </Text>
                </View>
              </View>

              {/* meta row */}
              <Text style={s.meta}>
                {fazendaNome(c.fazendas)}
                {'  ·  '}
                {new Date(c.created_at).toLocaleDateString('pt-BR')}
              </Text>

              {/* link preview */}
              {c.approval_token ? (
                <Text style={s.linkPreview} numberOfLines={1}>
                  {NETLIFY}?t={c.approval_token}
                </Text>
              ) : (
                <Text style={s.noToken}>Sem token de compartilhamento</Text>
              )}

              {/* action row */}
              <View style={s.actionRow}>
                <TouchableOpacity
                  style={s.btnGraficos}
                  activeOpacity={0.8}
                  onPress={() => handleOpen(c)}
                >
                  <Text style={s.btnGraficosText}>Ver graficos</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btnShare, !c.approval_token && s.btnDisabled]}
                  activeOpacity={0.8}
                  onPress={() => handleShare(c)}
                  disabled={!c.approval_token}
                >
                  <Text style={s.btnShareText}>Compartilhar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.btnDelete}
                  activeOpacity={0.8}
                  onPress={() => handleDelete(c)}
                >
                  <Text style={s.btnDeleteText}>🗑</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8F7' },
  loadRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F7F8F7' },

  header: {
    backgroundColor: '#1F4E1F',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  backBtn: { marginBottom: 14 },
  backText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  headerTitle: { fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: -0.4 },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontWeight: '500' },

  list: { padding: 16, gap: 12 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#ECF0EC',
  },
  accent: { width: 3 },
  cardBody: { flex: 1, padding: 15, gap: 6 },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titulo: { flex: 1, fontSize: 15, fontWeight: '800', color: '#1A2E1A' },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  meta: { fontSize: 11, color: '#8FA08F', fontWeight: '500' },
  linkPreview: { fontSize: 10, color: '#2E7D32', fontFamily: 'monospace', marginTop: 2 },
  noToken: { fontSize: 10, color: '#BDBDBD', fontStyle: 'italic', marginTop: 2 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  btnGraficos: {
    flex: 1,
    backgroundColor: '#F0F6F0',
    borderRadius: 9,
    paddingVertical: 9,
    alignItems: 'center',
  },
  btnGraficosText: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  btnShare: {
    flex: 1.4,
    backgroundColor: '#1F4E1F',
    borderRadius: 9,
    paddingVertical: 9,
    alignItems: 'center',
  },
  btnShareText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  btnDisabled: { backgroundColor: '#CFD8DC', opacity: 0.6 },
  btnDelete: {
    backgroundColor: '#FFF0F0',
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  btnDeleteText: { fontSize: 14 },

  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ECF0EC',
    marginTop: 20,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1A2E1A', marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: '#8FA08F', textAlign: 'center' },
});
