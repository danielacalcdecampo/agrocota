/**
 * Stub para react-native-maps no build web.
 * O mapa nativo só funciona em iOS/Android.
 */
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';

const styles = StyleSheet.create({
  container: {
    height: 300,
    backgroundColor: '#e8f0ea',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c5d9ca',
  },
  text: {
    color: '#4a6b53',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NoOp = ({ children, style, ...rest }: any) => (
  <View style={[styles.container, style]} {...rest}>
    {children}
  </View>
);

export const PROVIDER_GOOGLE = 'google';

export interface MapPressEvent {
  nativeEvent: { coordinate: { latitude: number; longitude: number } };
}

export default function MapView({
  style,
  children,
  ...rest
}: {
  style?: ViewStyle;
  children?: React.ReactNode;
  [key: string]: unknown;
}) {
  return (
    <View style={[styles.container, style]} {...rest}>
      <Text style={styles.text}>Mapa disponível no app mobile</Text>
      {children}
    </View>
  );
}

export const Marker = NoOp;
export const Polygon = NoOp;
export const Polyline = NoOp;
export const UrlTile = NoOp;
