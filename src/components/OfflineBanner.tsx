import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useConnectivity } from '../context/ConnectivityContext';
import { useAuth } from '../context/AuthContext';
import { getPendingCount } from '../services/OfflineSyncService';

export function OfflineBanner() {
  const { isOnline } = useConnectivity();
  const { session } = useAuth();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    getPendingCount().then(setPending);
  }, [isOnline]);

  if (isOnline || !session) return null;

  const msg = pending > 0
    ? `Modo offline — ${pending} alteração(ões) aguardando sincronização.`
    : 'Modo offline — suas alterações serão sincronizadas quando a conexão voltar.';

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{msg}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#C8900A',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#1a1a1a',
    fontSize: 13,
    fontWeight: '600',
  },
});
