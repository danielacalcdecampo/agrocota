import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useConnectivity } from '../context/ConnectivityContext';
import { getCache, setCache } from '../services/OfflineSyncService';

/**
 * Hook para consultas offline-first.
 * Quando online: busca do Supabase e faz cache.
 * Quando offline: retorna cache se existir.
 */
export function useOfflineQuery<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  deps: React.DependencyList = []
) {
  const { isOnline } = useConnectivity();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isOnline) {
        const result = await fetcher();
        setData(result);
        await setCache(cacheKey, result);
      } else {
        const cached = await getCache<T>(cacheKey);
        setData(cached);
      }
    } catch (e) {
      if (isOnline) {
        setError(e instanceof Error ? e : new Error(String(e)));
        const cached = await getCache<T>(cacheKey);
        if (cached) setData(cached);
      } else {
        const cached = await getCache<T>(cacheKey);
        setData(cached ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [cacheKey, isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [...deps, load]);

  return { data, loading, error, refetch: load };
}
