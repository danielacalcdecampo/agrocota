import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  StatusBar,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { MaterialIcons } from '@expo/vector-icons';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Notificacoes'>;
};

type NotificacaoConsultor = {
  id: string;
  tipo: 'aceite' | 'recusa';
  mensagem: string;
  created_at: string;
  lida_em: string | null;
  cotacao_id: string | null;
  fonte: 'consultor_notificacoes';
};

type NotificacaoFornecedor = {
  id: string;
  tipo: 'proposta_fornecedor';
  titulo: string;
  mensagem: string | null;
  empresa_fornecedor: string | null;
  created_at: string;
  lida: boolean;
  cotacao_id: string | null;
  fonte: 'notificacoes';
};

type Notificacao = NotificacaoConsultor | NotificacaoFornecedor;

const normalizarMensagem = (mensagem: string) => {
  if (!mensagem) return mensagem;
  return mensagem
    .replace(/propriet[áa]rio\s+da\s+fazenda\s+fazenda/gi, 'proprietário')
    .replace(/propriet[áa]rio\s+da\s+fazenda/gi, 'proprietário')
    .replace(/propriet[áa]ria\(o\)/gi, 'proprietário')
    .replace(/\bfazenda\s+fazenda\b/gi, 'fazenda');
};

export default function NotificationsScreen({ navigation }: Props) {
  const { session } = useAuth();
  const { isDark } = useThemeMode();
  const [items, setItems] = useState<Notificacao[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const pal = {
    pageBg:    isDark ? '#0F1712' : '#F3F6F4',
    headerBg:  isDark ? '#111D16' : '#154D2A',
    border:    isDark ? '#25372C' : '#E6ECE8',
    cardBg:    isDark ? '#17241C' : '#FFFFFF',
    cardBorderNova: isDark ? '#2B7A49' : '#A8D5B5',
    cardBorderLida: isDark ? '#25372C' : '#E6ECE8',
    textPrimary:   isDark ? '#E8F1EB' : '#173A2B',
    textSecondary: isDark ? '#A9BEAF' : '#557466',
    deleteBg:  isDark ? '#2A1A1A' : '#FDECEC',
    deleteText: isDark ? '#E07070' : '#B3261E',
  };

  // ─── Carrega — respeita os IDs já excluídos localmente ────────────────────
  const fetchNotificacoes = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) return;

    // Busca da tabela consultor_notificacoes (aceites/recusas)
    const { data: dataConsultor } = await supabase
      .from('consultor_notificacoes')
      .select('id, tipo, mensagem, created_at, lida_em, cotacao_id')
      .eq('consultor_id', uid)
      .order('created_at', { ascending: false })
      .limit(100);

    // Busca da tabela notificacoes (propostas de fornecedor)
    const { data: dataFornecedor } = await supabase
      .from('notificacoes')
      .select('id, tipo, titulo, mensagem, empresa_fornecedor, created_at, lida, cotacao_id')
      .eq('consultor_id', uid)
      .order('created_at', { ascending: false })
      .limit(100);

    // Normaliza e combina ambas as fontes
    const consultorRows: NotificacaoConsultor[] = (dataConsultor ?? []).map(item => ({
      ...item,
      fonte: 'consultor_notificacoes' as const,
    }));

    const fornecedorRows: NotificacaoFornecedor[] = (dataFornecedor ?? []).map(item => ({
      ...item,
      tipo: 'proposta_fornecedor' as const,
      fonte: 'notificacoes' as const,
    }));

    // Combina e ordena por data (mais recente primeiro)
    const todas: Notificacao[] = [...consultorRows, ...fornecedorRows]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Marca notificações não lidas
    const agora = new Date().toISOString();
    const consultorNaoLidas = consultorRows.filter(item => !item.lida_em);
    const fornecedorNaoLidas = fornecedorRows.filter(item => !item.lida);

    setItems(todas.map(item => {
      if (item.fonte === 'consultor_notificacoes' && !item.lida_em) {
        return { ...item, lida_em: agora };
      }
      if (item.fonte === 'notificacoes' && !item.lida) {
        return { ...item, lida: true };
      }
      return item;
    }));

    // Atualiza ambas as tabelas se houver não lidas
    if (consultorNaoLidas.length > 0) {
      await supabase
        .from('consultor_notificacoes')
        .update({ lida_em: agora })
        .eq('consultor_id', uid)
        .is('lida_em', null);
    }

    if (fornecedorNaoLidas.length > 0) {
      await supabase
        .from('notificacoes')
        .update({ lida: true })
        .eq('consultor_id', uid)
        .eq('lida', false);
    }
  }, [session?.user?.id]);

  useFocusEffect(useCallback(() => { fetchNotificacoes(); }, [fetchNotificacoes]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchNotificacoes();
    setRefreshing(false);
  };

  // ─── Excluir uma notificação ──────────────────────────────────────────────
  const excluirNotificacao = useCallback(async (id: string, fonte: 'consultor_notificacoes' | 'notificacoes') => {
    const uid = session?.user?.id;
    if (!uid) return;

    console.log('[Notificações] Tentando excluir:', { id, fonte, uid });

    // Exclui da tabela correta
    const tabela = fonte === 'consultor_notificacoes' ? 'consultor_notificacoes' : 'notificacoes';
    const { data, error } = await supabase
      .from(tabela)
      .delete()
      .eq('id', id)
      .eq('consultor_id', uid)
      .select();

    console.log('[Notificações] Resultado da exclusão:', { data, error, tabela });

    if (error) {
      console.error('[Notificações] Erro ao excluir notificação:', error);
      Alert.alert('Erro', `Não foi possível excluir a notificação. ${error.message}`);
      return;
    }

    // Remove do estado local apenas após sucesso
    setItems(prev => prev.filter(item => item.id !== id));
  }, [session?.user?.id]);

  // ─── Excluir todas ────────────────────────────────────────────────────────
  const excluirTodas = useCallback(() => {
    Alert.alert(
      'Excluir todas',
      'Tem certeza que deseja excluir todas as notificações?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            const uid = session?.user?.id;
            if (!uid) return;
            
            console.log('[Notificações] Tentando excluir todas para uid:', uid);

            // Exclui de ambas as tabelas
            const [result1, result2] = await Promise.all([
              supabase
                .from('consultor_notificacoes')
                .delete()
                .eq('consultor_id', uid)
                .select(),
              supabase
                .from('notificacoes')
                .delete()
                .eq('consultor_id', uid)
                .select(),
            ]);

            console.log('[Notificações] Resultado consultor_notificacoes:', result1);
            console.log('[Notificações] Resultado notificacoes:', result2);

            if (result1.error || result2.error) {
              console.error('[Notificações] Erro ao excluir notificações:', result1.error, result2.error);
              Alert.alert('Erro', `Não foi possível excluir todas as notificações. ${result1.error?.message || result2.error?.message}`);
              return;
            }

            // Limpa o estado apenas após sucesso
            setItems([]);
            console.log('[Notificações] Todas excluídas com sucesso');
          },
        },
      ]
    );
  }, [session?.user?.id]);

  // ─── Navega para a tela correta com base no tipo ─────────────────────────
  const navegarParaNotificacao = useCallback(async (item: Notificacao) => {
    const cotacaoId = item.cotacao_id;
    if (!cotacaoId) return;

    if (item.tipo === 'proposta_fornecedor') {
      const { data: cot } = await supabase
        .from('cotacoes')
        .select('titulo')
        .eq('id', cotacaoId)
        .single();
      navigation.navigate('PropostasFornecedor', {
        cotacaoId,
        titulo: cot?.titulo ?? 'Proposta recebida',
      });
    } else if (item.tipo === 'aceite' || item.tipo === 'recusa') {
      navigation.navigate('CotacaoGraficos', { cotacaoId });
    }
  }, [navigation]);

  // ─── Card ─────────────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: Notificacao }) => {
    let tipoTexto: string;
    let stripeColor: string;
    let tipoColor: string;
    let iconName: keyof typeof MaterialIcons.glyphMap;
    let mensagemTexto: string;
    const temLink = !!item.cotacao_id;

    if (item.tipo === 'proposta_fornecedor') {
      tipoTexto = 'Proposta recebida';
      stripeColor = '#2D8A53';
      tipoColor = isDark ? '#5DB87A' : '#1A6B3A';
      iconName = 'storefront';
      const empresa = (item as NotificacaoFornecedor).empresa_fornecedor || 'Fornecedor';
      mensagemTexto = `${empresa} enviou uma proposta`;
    } else {
      const isAceite = item.tipo === 'aceite';
      tipoTexto = isAceite ? 'Aceite recebido' : 'Recusa recebida';
      stripeColor = isAceite ? '#2D8A53' : '#C62828';
      tipoColor = isAceite
        ? (isDark ? '#5DB87A' : '#1A6B3A')
        : (isDark ? '#E07070' : '#C62828');
      iconName = isAceite ? 'check-circle' : 'cancel';
      mensagemTexto = normalizarMensagem((item as NotificacaoConsultor).mensagem);
    }

    return (
      <TouchableOpacity
        activeOpacity={temLink ? 0.75 : 1}
        onPress={() => temLink && navegarParaNotificacao(item)}
        style={[
          s.card,
          {
            backgroundColor: pal.cardBg,
            borderColor: pal.cardBorderLida,
          },
        ]}
      >
        {/* Stripe lateral colorida */}
        <View style={[s.stripe, { backgroundColor: stripeColor }]} />

        <View style={s.cardBody}>
          {/* Topo: ícone + tipo + seta de navegação */}
          <View style={s.rowTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <MaterialIcons name={iconName} size={15} color={tipoColor} />
              <Text style={[s.tipoText, { color: tipoColor }]}>{tipoTexto}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[s.data, { color: pal.textSecondary }]}>
                {new Date(item.created_at).toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', year: '2-digit',
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
              {temLink && <MaterialIcons name="chevron-right" size={16} color={pal.textSecondary} />}
            </View>
          </View>

          {/* Mensagem */}
          <Text style={[s.msg, { color: pal.textPrimary }]}>{mensagemTexto}</Text>

          {/* Dica de navegação + botão excluir */}
          <View style={s.rowBottom}>
            {temLink && (
              <Text style={[s.tapHint, { color: tipoColor }]}>
                Toque para ver detalhes
              </Text>
            )}
            <TouchableOpacity
              onPress={() => excluirNotificacao(item.id, item.fonte)}
              activeOpacity={0.8}
              style={[s.deleteBtn, { backgroundColor: pal.deleteBg }]}
            >
              <Text style={[s.deleteBtnText, { color: pal.deleteText }]}>Excluir</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[s.root, { backgroundColor: pal.pageBg }]}>
      <StatusBar barStyle="light-content" backgroundColor={pal.headerBg} />

      {/* Header */}
      <View style={[s.header, { backgroundColor: pal.headerBg }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.voltarBtn} activeOpacity={0.8}>
          <Text style={s.voltarTxt}>Voltar</Text>
        </TouchableOpacity>

        <View style={s.headerTextWrap}>
          <Text style={s.title}>Central de notificações</Text>
          <Text style={s.subtitle}>{items.length} notificaç{items.length === 1 ? 'ão' : 'ões'}</Text>
        </View>

        {items.length > 0 && (
          <TouchableOpacity onPress={excluirTodas} style={s.excluirTodasBtn} activeOpacity={0.8}>
            <Text style={s.excluirTodasTxt}>Excluir todas</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={items.length === 0 ? s.emptyContainer : s.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1F6B3A']} tintColor="#1F6B3A" />
        }
        ListEmptyComponent={
          <View style={[s.emptyCard, { backgroundColor: pal.cardBg, borderColor: pal.border }]}>
            <Text style={[s.emptyTitle, { color: pal.textPrimary }]}>Nenhuma notificação</Text>
            <Text style={[s.emptyDesc, { color: pal.textSecondary }]}>
              Quando o produtor aceitar ou recusar cotações, ou quando fornecedores enviarem propostas, aparecerá aqui.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  header: {
    minHeight: 80,
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  voltarBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  voltarTxt: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  headerTextWrap: { flex: 1 },
  title: { fontSize: 17, fontWeight: '900', color: '#FFFFFF' },
  subtitle: { marginTop: 2, fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: '600' },

  excluirTodasBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(180,40,40,0.25)',
  },
  excluirTodasTxt: { color: '#FFAAAA', fontWeight: '700', fontSize: 12 },

  listContent: { padding: 14, gap: 10 },
  emptyContainer: { flexGrow: 1, padding: 16, justifyContent: 'center' },
  emptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 15, fontWeight: '900' },
  emptyDesc: { fontSize: 13, textAlign: 'center', lineHeight: 20 },

  card: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 2,
  },
  stripe: {
    width: 4,
    alignSelf: 'stretch',
  },
  cardBody: {
    flex: 1,
    padding: 13,
    gap: 6,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tipoText: {
    fontSize: 13,
    fontWeight: '800',
  },
  data: {
    fontSize: 11,
    fontWeight: '600',
  },
  msg: {
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '600',
  },
  rowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  tapHint: {
    fontSize: 11,
    fontWeight: '700',
  },
  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  deleteBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
});