import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

export function useSessionHeartbeat(userId: string | null) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const beat = async () => {
    if (!userId) return;
    const token = await AsyncStorage.getItem('@agrocota_session_token');
    if (!token) return;

    // Atualiza só o timestamp — renova o TTL sem trocar o token
    await supabase
      .from('profiles')
      .update({ session_token_updated_at: new Date().toISOString() })
      .eq('id', userId)
      .eq('session_token', token); // só atualiza se o token ainda for o mesmo
  };

  useEffect(() => {
    if (!userId) return;

    beat();
    intervalRef.current = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') beat();
    };
    const sub = AppState.addEventListener('change', handleAppState);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
  }, [userId]);
}