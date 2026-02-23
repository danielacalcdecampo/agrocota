import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Session, User } from '@supabase/supabase-js';
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);

  // sessionRef keeps the latest session available in callbacks without stale closures
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  // registeringRef allows the onAuthStateChange listener to skip fetchProfile
  // while the registration flow controls the profile load itself
  const registeringRef = useRef(false);
  registeringRef.current = registering;

  const fetchProfile = useCallback(async (userId: string, userEmail?: string) => {
    // Se o e-mail da sessão já é de uma conta excluída, não tenta carregar perfil
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
      // Conta excluída: faz logout automático
      if (prof.status === 'deleted') {
        await supabase.auth.signOut();
        setProfile(null);
        return;
      }
      setProfile(prof);
    }
  }, []);

  // uid explícito permite que a tela de cadastro passe o uid do signUp diretamente,
  // sem depender do sessionRef que pode ainda apontar para a sessão antiga
  const refreshProfile = useCallback(async (uid?: string) => {
    const id = uid ?? sessionRef.current?.user?.id;
    if (id) await fetchProfile(id);
  }, [fetchProfile]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      // Token inválido/expirado — limpa sessão local e força novo login
      if (error && (error.message?.includes('Refresh Token') || error.message?.includes('refresh_token'))) {
        supabase.auth.signOut();
        setLoading(false);
        return;
      }
      setSession(session);
      if (session?.user?.id) fetchProfile(session.user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Token refresh falhou — desloga automaticamente
      if (event === 'TOKEN_REFRESHED' && !session) {
        supabase.auth.signOut();
        setProfile(null);
        return;
      }
      // Atualiza o ref sincronamente antes de qualquer outra operação
      // para que refreshProfile() chamado logo após já enxergue a sessão correta
      sessionRef.current = session;
      setSession(session);
      if (session?.user?.id) {
        // Skip automatic fetchProfile during registration — the register screen
        // calls refreshProfile() explicitly after the profile row is created
        if (!registeringRef.current) fetchProfile(session.user.id, session.user.email);
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, registering, setRegistering, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
