import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

export const AGROCOTA_NOTIFICATION_CHANNEL_ID = 'agrocota-consultor';

// ─── Handler global de notificações ─────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const getEasProjectId = () =>
  Constants.expoConfig?.extra?.eas?.projectId ||
  Constants.easConfig?.projectId ||
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

// ─── Configura permissões e canal Android ───────────────────────────────────
export const configurarPermissaoECanalNotificacoes = async (): Promise<boolean> => {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(AGROCOTA_NOTIFICATION_CHANNEL_ID, {
        name: 'Agrocota - Consultor',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1F6B3A',
        sound: 'default',
      });
    }

    const permissaoAtual = await Notifications.getPermissionsAsync();
    let statusFinal = permissaoAtual.status;

    if (statusFinal !== 'granted') {
      const solicitacao = await Notifications.requestPermissionsAsync();
      statusFinal = solicitacao.status;
    }

    return statusFinal === 'granted';
  } catch (error) {
    console.warn('Falha ao configurar permissões/canal de notificação:', error);
    return false;
  }
};

// ─── Registra token Expo Push no Supabase ───────────────────────────────────
export const registrarExpoPushToken = async (userId: string): Promise<string | null> => {
  const projectId = getEasProjectId();

  console.log('[Push] Iniciando registro de token. userId:', userId, '| projectId:', projectId);

  if (!projectId) {
    console.warn('[Push] projectId EAS ausente — notificações push desativadas.');
    return null;
  }

  let expoToken: string | null = null;
  try {
    // Timeout de 10s para evitar travar o app quando FCM está indisponível
    const tokenPromise = Notifications.getExpoPushTokenAsync({ projectId });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout ao obter token push')), 10_000),
    );
    const tokenResp = await Promise.race([tokenPromise, timeoutPromise]);
    expoToken = (tokenResp as any)?.data ?? null;
    console.log('[Push] Token gerado:', expoToken);
  } catch (err: any) {
    // SERVICE_NOT_AVAILABLE = Google Play / FCM indisponível (não é erro fatal)
    const msg: string = err?.message ?? String(err);
    if (msg.includes('SERVICE_NOT_AVAILABLE') || msg.includes('Timeout')) {
      console.warn('[Push] FCM indisponível — notificações push desativadas temporariamente.');
    } else {
      console.warn('[Push] Falha ao gerar token push:', msg);
    }
    return null;
  }

  if (!expoToken) {
    console.error('[Push] Token vazio após getExpoPushTokenAsync.');
    return null;
  }

  const { error } = await supabase.rpc('save_push_token', {
    p_token: expoToken,
    p_platform: Platform.OS,
  });

  if (error) {
    console.error('[Push] ERRO ao salvar token no Supabase:', error.message, error.code);
  } else {
    console.log('[Push] Token salvo no Supabase com sucesso.');
  }

  return expoToken;
};

// ─── Exibe notificação local imediata ───────────────────────────────────────
export const enviarNotificacaoLocal = async (
  titulo: string,
  mensagem: string,
  data?: Record<string, unknown>,
) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: titulo,
        body: mensagem,
        data: data ?? {},
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: AGROCOTA_NOTIFICATION_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('Falha ao exibir notificação local:', error);
  }
};

// ─── Sincronização automática de token ──────────────────────────────────────
export const iniciarSincronizacaoPushToken = (userId: string) => {
  const tokenSubscription = Notifications.addPushTokenListener(async token => {
    const novoToken = token?.data;
    if (!novoToken) return;
    try {
      await supabase.rpc('save_push_token', {
        p_token: novoToken,
        p_platform: Platform.OS,
      });
    } catch (error) {
      console.warn('Falha ao sincronizar atualização de push token:', error);
    }
  });

  return () => {
    tokenSubscription.remove();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Listener Realtime — escuta INSERT em AMBAS as tabelas de notificações
//
// Fluxo:
//   1. Fornecedor preenche agrocota-fornecedor.html e envia
//      → HTML faz INSERT em propostas_fornecedor + INSERT em notificacoes
//        (tipo = 'proposta_fornecedor', consultor_id = dono da cotação)
//
//   2. Produtor aceita/recusa cotação pelo app ou link
//      → App/Link faz INSERT em consultor_notificacoes
//        (tipo = 'aceite' | 'recusa', consultor_id = dono da cotação)
//
//   3. Este listener captura os INSERTs via Realtime e dispara push local
//      no dispositivo do consultor imediatamente
//
// Uso:
//   const stopListener = iniciarListenerNotificacoes(userId, (notif) => {
//     setBadgeCount(prev => prev + 1);
//     setNotificacoes(prev => [notif, ...prev]);
//   });
//   // No logout / unmount: stopListener();
// ─────────────────────────────────────────────────────────────────────────────

let _realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

export const iniciarListenerPropostasFornecedor = (
  userId: string,
  onNovaNotificacao?: (notif: NotificacaoRow | ConsultorNotificacaoRow) => void,
): (() => void) => {
  // Evita canais duplicados
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }

  const channel = supabase
    .channel(`notificacoes-completo:${userId}`)
    // Escuta tabela notificacoes (propostas de fornecedor)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notificacoes',
        filter: `consultor_id=eq.${userId}`,
      },
      async (payload) => {
        const notif = payload.new as NotificacaoRow;
        console.log('[Realtime] Nova notificação (fornecedor):', notif.tipo, '|', notif.titulo);

        const empresa = notif.empresa_fornecedor || 'Fornecedor';
        const tituloSimples = 'Proposta recebida';
        const mensagemSimples = `${empresa} enviou uma proposta`;

        await enviarNotificacaoLocal(
          tituloSimples,
          mensagemSimples,
          {
            tipo:           notif.tipo,
            cotacao_id:     notif.cotacao_id,
            notificacao_id: notif.id,
          },
        );

        if (onNovaNotificacao) {
          onNovaNotificacao(notif);
        }
      },
    )
    // Escuta tabela consultor_notificacoes (aceites/recusas)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'consultor_notificacoes',
        filter: `consultor_id=eq.${userId}`,
      },
      async (payload) => {
        const notif = payload.new as ConsultorNotificacaoRow;
        console.log('[Realtime] Nova notificação (consultor):', notif.tipo);

        const tituloSimples = notif.tipo === 'aceite' ? 'Aceite recebido' : 'Recusa recebida';
        const mensagemSimples = notif.mensagem;

        await enviarNotificacaoLocal(
          tituloSimples,
          mensagemSimples,
          {
            tipo:           notif.tipo,
            cotacao_id:     notif.cotacao_id,
            notificacao_id: notif.id,
          },
        );

        if (onNovaNotificacao) {
          onNovaNotificacao(notif);
        }
      },
    )
    .subscribe((status) => {
      console.log('[Realtime] Status canal notificacoes completo:', status);
    });

  _realtimeChannel = channel;

  return () => {
    if (_realtimeChannel) {
      supabase.removeChannel(_realtimeChannel);
      _realtimeChannel = null;
    }
  };
};

// ─── Busca notificações do consultor (ambas as tabelas, desc) ───────────────
export const buscarNotificacoesNaoLidas = async (
  userId: string,
): Promise<Array<NotificacaoRow | ConsultorNotificacaoRow>> => {
  // Busca da tabela notificacoes (propostas de fornecedor)
  const { data: dataNotificacoes, error: errorNotificacoes } = await supabase
    .from('notificacoes')
    .select('*')
    .eq('consultor_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  // Busca da tabela consultor_notificacoes (aceites/recusas)
  const { data: dataConsultorNotif, error: errorConsultorNotif } = await supabase
    .from('consultor_notificacoes')
    .select('*')
    .eq('consultor_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (errorNotificacoes || errorConsultorNotif) {
    console.warn('[Notificacoes] Erro ao buscar:', errorNotificacoes?.message, errorConsultorNotif?.message);
    return [];
  }

  // Combina e ordena por data
  const todas = [
    ...(dataNotificacoes ?? []),
    ...(dataConsultorNotif ?? []),
  ].sort((a: any, b: any) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return todas as Array<NotificacaoRow | ConsultorNotificacaoRow>;
};

// ─── Busca propostas de fornecedores de uma cotação ─────────────────────────
export const buscarPropostasFornecedor = async (
  cotacaoId: string,
): Promise<PropostaFornecedorRow[]> => {
  const { data, error } = await supabase
    .from('propostas_fornecedor')
    .select('*')
    .eq('cotacao_id', cotacaoId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[PropostasFornecedor] Erro ao buscar:', error.message);
    return [];
  }
  return (data ?? []) as PropostaFornecedorRow[];
};

// ─── Marca uma notificação como lida ────────────────────────────────────────
export const marcarNotificacaoComoLida = async (notificacaoId: string): Promise<void> => {
  await supabase
    .from('notificacoes')
    .update({ lida: true })
    .eq('id', notificacaoId);
};

// ─── Marca todas as notificações do usuário como lidas ──────────────────────
export const marcarTodasNotificacoesComoLidas = async (userId: string): Promise<void> => {
  await supabase
    .from('notificacoes')
    .update({ lida: true })
    .eq('consultor_id', userId)
    .eq('lida', false);
};

// ─── Exclui todas as notificações do usuário ────────────────────────────────
export const excluirTodasNotificacoes = async (userId: string): Promise<void> => {
  const { error } = await supabase
    .from('notificacoes')
    .delete()
    .eq('consultor_id', userId);
  
  if (error) {
    console.error('[Notificacoes] Erro ao excluir todas:', error.message);
    throw error;
  }
};

// ─── Conta notificações não lidas (ambas as tabelas) ────────────────────────
export const contarNotificacoesNaoLidas = async (userId: string): Promise<number> => {
  // Conta da tabela notificacoes
  const { count: countNotificacoes } = await supabase
    .from('notificacoes')
    .select('*', { count: 'exact', head: true })
    .eq('consultor_id', userId)
    .eq('lida', false);

  // Conta da tabela consultor_notificacoes
  const { count: countConsultorNotif } = await supabase
    .from('consultor_notificacoes')
    .select('*', { count: 'exact', head: true })
    .eq('consultor_id', userId)
    .is('lida_em', null);

  return (countNotificacoes ?? 0) + (countConsultorNotif ?? 0);
};

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipos de notificação válidos no sistema.
 *
 * ATENÇÃO: a tabela "notificacoes" NÃO tem CHECK constraint em "tipo",
 * mas o HTML do fornecedor e o listener esperam exatamente 'proposta_fornecedor'.
 * Se adicionar novos tipos, atualize aqui e no SQL (policy anon_insert_notificacao_proposta).
 *
 * NÃO confundir com "consultor_notificacoes" (tabela separada, tipos: 'aceite' | 'recusa').
 */
export type TipoNotificacao =
  | 'proposta_fornecedor'   // fornecedor enviou proposta via agrocota-fornecedor.html
  | 'aceite'                 // produtor aceitou cotação (via app)
  | 'recusa'                 // produtor recusou cotação (via app)
  | (string & {});           // outros tipos futuros sem quebrar TypeScript

export interface NotificacaoRow {
  id: string;
  created_at: string;
  consultor_id: string;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem?: string;
  empresa_fornecedor?: string;
  cotacao_id?: string;
  token_cotacao?: string;
  lida: boolean;
}

export interface PropostaFornecedorRow {
  id: string;
  created_at: string;
  cotacao_id: string | null;
  token_cotacao: string;
  empresa_nome: string;
  responsavel_nome: string;
  telefone: string | null;
  email: string | null;
  validade_proposta: string | null;  // date ISO 'YYYY-MM-DD'
  observacoes: string | null;
  itens_json: PropostaItem[];
  total_proposta: number;
  user_agent: string | null;
  lida: boolean;
}

export interface PropostaItem {
  id: string;        // UUID do item_cotacao
  produto: string;
  cat: string;
  dose: string;      // ex: '1.5 L/ha'
  valor_ha: number;
  info: string;      // prazo de entrega, condições, etc.
}

/**
 * Row da tabela consultor_notificacoes (aceites/recusas do produtor)
 */
export interface ConsultorNotificacaoRow {
  id: string;
  consultor_id: string;
  cotacao_id: string | null;
  tipo: 'aceite' | 'recusa';
  mensagem: string;
  titulo_cotacao: string | null;
  nome_fazenda: string | null;
  lida_em: string | null;  // timestamp ISO
  created_at: string;       // timestamp ISO
}