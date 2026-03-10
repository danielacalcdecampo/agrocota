import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { View, LogBox, Platform } from 'react-native';

LogBox.ignoreLogs(['setLayoutAnimationEnabledExperimental']);
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ConnectivityProvider } from './src/context/ConnectivityContext';
import { ThemeProvider, useThemeMode } from './src/context/ThemeContext';
import {
  configurarPermissaoECanalNotificacoes,
  enviarNotificacaoLocal,
  iniciarSincronizacaoPushToken,
  registrarExpoPushToken,
  iniciarListenerPropostasFornecedor,
} from './src/services/NotificacoesService';
import { useConnectivity } from './src/context/ConnectivityContext';
import { flushSyncQueue } from './src/services/OfflineSyncService';
import { supabase } from './src/lib/supabase';
import AppNavigator, { navigationRef } from './src/navigation/AppNavigator';
import { OfflineBanner } from './src/components/OfflineBanner';

// ─── Navega para a tela certa com base nos dados da notificação ─────────────
async function navegarParaNotificacao(data) {
  if (!data || !navigationRef.isReady()) return;
  const tipo = data.tipo;
  const cotacaoId = data.cotacao_id;
  if (!cotacaoId) return;

  if (tipo === 'proposta_fornecedor') {
    // Busca o título da cotação para passar como parâmetro
    const { data: cot } = await supabase
      .from('cotacoes')
      .select('titulo')
      .eq('id', cotacaoId)
      .single();
    navigationRef.navigate('PropostasFornecedor', {
      cotacaoId,
      titulo: cot?.titulo ?? 'Proposta recebida',
    });
  } else if (tipo === 'aceite' || tipo === 'recusa') {
    navigationRef.navigate('CotacaoGraficos', { cotacaoId });
  }
}

export default function App() {
  return (
    <KeyboardProvider>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <ConnectivityProvider>
            <AuthProvider>
              <View style={{ flex: 1 }}>
                <ThemedRoot />
              </View>
            </AuthProvider>
          </ConnectivityProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </KeyboardProvider>
  );
}

// Registra Service Worker no PWA (web) para modo offline
function useRegisterServiceWorker() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.update();
    }).catch(() => {});
  }, []);
}

// O componente ThemedRoot permanece responsável pelas notificações e statusbar
function ThemedRoot() {
  useRegisterServiceWorker();
  const { isDark } = useThemeMode();
  const { session } = useAuth();
  const { isOnline } = useConnectivity();
  const wasOfflineRef = React.useRef(false);

  React.useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
    } else if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      flushSyncQueue().then(({ success }) => {
        if (success > 0) {
          try {
            enviarNotificacaoLocal('Sincronizado', `${success} alteração(ões) enviada(s) ao servidor.`, {});
          } catch (_) {}
        }
      });
    }
  }, [isOnline]);
  const uid = session?.user?.id;
  const realtimeChannelRef = useRef(null);

  useEffect(() => {
    let stopTokenSync = null;
    const registerNotifications = async () => {
      if (!uid) return;
      try {
        const granted = await configurarPermissaoECanalNotificacoes();
        if (granted) {
          await registrarExpoPushToken(uid);
          stopTokenSync = iniciarSincronizacaoPushToken(uid);
        }
      } catch (error) {
        console.warn('Falha notificações:', error);
      }
    };
    registerNotifications();
    return () => stopTokenSync && stopTokenSync();
  }, [uid]);

  // Trata a notificação que abriu o app quando estava completamente fechado
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      const data = response.notification.request.content.data;
      // Pequeno delay para garantir que o NavigationContainer está montado
      setTimeout(() => navegarParaNotificacao(data), 500);
    });
  }, []);

  useEffect(() => {
    if (!uid) return;

    // Listener 1: aceite/recusa do produtor (tabela consultor_notificacoes)
    const channel = supabase
      .channel(`global-notificacoes-${uid}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'consultor_notificacoes',
        filter: `consultor_id=eq.${uid}`,
      }, payload => {
        const tipo = payload.new?.tipo;
        if (tipo !== 'aceite' && tipo !== 'recusa') return;
        const titulo = tipo === 'aceite' ? 'Aceite recebido' : 'Recusa recebida';
        enviarNotificacaoLocal(titulo, payload.new?.mensagem ?? 'Nova atualização.', {
          tipo,
          cotacao_id: payload.new?.cotacao_id ?? null,
          notificacao_id: payload.new?.id ?? null,
        });
      })
      .subscribe();
    realtimeChannelRef.current = channel;

    // Listener 2: proposta do fornecedor (tabela notificacoes)
    const stopFornecedorListener = iniciarListenerPropostasFornecedor(uid);

    // Listener 3: toque do usuário em notificação do celular (popup)
    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      navegarParaNotificacao(data);
    });

    return () => {
      supabase.removeChannel(channel);
      stopFornecedorListener();
      responseSub.remove();
    };
  }, [uid]);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={isDark ? '#0F1712' : '#ffffff'} />
      <OfflineBanner />
      <AppNavigator />
    </>
  );
}