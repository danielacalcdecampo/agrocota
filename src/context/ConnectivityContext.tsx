import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';

const SUPABASE_URL = 'https://fafjknchnibdflpqyssf.supabase.co';

interface ConnectivityContextData {
  isOnline: boolean;
  isConnected: boolean | null;
}

const ConnectivityContext = createContext<ConnectivityContextData>({
  isOnline: true,
  isConnected: null,
});

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  const checkOnline = useCallback(async () => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'onLine' in navigator) {
      setIsOnline(navigator.onLine);
      setIsConnected(navigator.onLine);
      return;
    }
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(SUPABASE_URL, { method: 'HEAD', signal: controller.signal });
      clearTimeout(t);
      const ok = res.ok || res.status < 500;
      setIsOnline(ok);
      setIsConnected(ok);
    } catch {
      setIsOnline(false);
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onOnline = () => { setIsOnline(true); setIsConnected(true); };
      const onOffline = () => { setIsOnline(false); setIsConnected(false); };
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      setIsOnline(navigator.onLine);
      setIsConnected(navigator.onLine);
      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    }

    let mounted = true;
    const interval = setInterval(() => {
      if (mounted) checkOnline();
    }, 15000);
    checkOnline();
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [checkOnline]);

  return (
    <ConnectivityContext.Provider value={{ isOnline, isConnected }}>
      {children}
    </ConnectivityContext.Provider>
  );
}

export const useConnectivity = () => useContext(ConnectivityContext);
