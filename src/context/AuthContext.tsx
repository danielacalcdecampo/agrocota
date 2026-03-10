import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, Profile } from '../lib/supabase';

interface AuthContextData {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  registering: boolean;
  signOut: () => Promise<void>;
  refreshProfile: (uid?: string) => Promise<void>;
  setRegistering: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const registeringRef = useRef(false);
  registeringRef.current = registering;

  // ─── Heartbeat ──────────────────────────────────────────────────────────────
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendHeartbeat = useCallback(async (userId?: string) => {
    const uid = userId ?? sessionRef.current?.user?.id;
    if (!uid) return;

    try {
      const token = await AsyncStorage.getItem('@agrocota_session_token');
      if (!token) return;

      // Renova só o timestamp — mantém o TTL ativo sem trocar o token
      await supabase
        .from('profiles')
        .update({ session_token_updated_at: new Date().toISOString() })
        .eq('id', uid)
        .eq('session_token', token); // só atualiza se o token ainda for o mesmo (segurança)
    } catch {
      // Silencia erros de rede para não derrubar sessão legítima
    }
  }, []);

  const startHeartbeat = useCallback((userId: string) => {
    // Limpa intervalo anterior se existir
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    // Bate imediatamente e depois a cada 5 minutos
    sendHeartbeat(userId);
    heartbeatIntervalRef.current = setInterval(() => sendHeartbeat(userId), HEARTBEAT_INTERVAL_MS);
  }, [sendHeartbeat]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  // Retoma o heartbeat quando o app volta do background
  useEffect(() => {
    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active' && sessionRef.current?.user?.id) {
        sendHeartbeat(sessionRef.current.user.id);
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [sendHeartbeat]);

  // Limpa o heartbeat quando o componente desmonta
  useEffect(() => {
    return () => stopHeartbeat();
  }, [stopHeartbeat]);

  // ─── Profile ────────────────────────────────────────────────────────────────
  const fetchProfile = useCallback(async (userId: string, userEmail?: string) => {
    if (userEmail && userEmail.includes('@agrocota.deleted')) {
      await supabase.auth.signOut();
      setProfile(null);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!error && data) {
      const prof = data as Profile;
      if (prof.status === 'deleted') {
        await supabase.auth.signOut();
        setProfile(null);
        return;
      }
      setProfile(prof);
    }
  }, []);

  const refreshProfile = useCallback(async (uid?: string) => {
    const id = uid ?? sessionRef.current?.user?.id;
    if (id) await fetchProfile(id);
  }, [fetchProfile]);

  // ─── Auth listener ───────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error && (error.message?.includes('Refresh Token') || error.message?.includes('refresh_token'))) {
        supabase.auth.signOut();
        setLoading(false);
        return;
      }
      setSession(session);
      if (session?.user?.id) {
        fetchProfile(session.user.id);
        startHeartbeat(session.user.id); // ← inicia heartbeat ao restaurar sessão
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && !session) {
        supabase.auth.signOut();
        setProfile(null);
        stopHeartbeat();
        return;
      }

      sessionRef.current = session;
      setSession(session);

      if (session?.user?.id) {
        if (!registeringRef.current) {
          fetchProfile(session.user.id, session.user.email);
        }
        startHeartbeat(session.user.id); // ← inicia heartbeat ao logar
      } else {
        setProfile(null);
        stopHeartbeat(); // ← para heartbeat ao deslogar
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ─── Sign out ────────────────────────────────────────────────────────────────
  const signOut = async () => {
    try {
      const userId = await AsyncStorage.getItem('@agrocota_user_id');

      if (userId) {
        // Limpa o token no banco → libera o acesso em outro dispositivo
        await supabase
          .from('profiles')
          .update({ session_token: null, session_token_updated_at: null })
          .eq('id', userId);
      }
    } catch {
      // Silencia erros para garantir que o logout local sempre aconteça
    } finally {
      stopHeartbeat();
      await AsyncStorage.multiRemove(['@agrocota_session_token', '@agrocota_user_id']);
      await supabase.auth.signOut();
      setProfile(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        registering,
        setRegistering,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);