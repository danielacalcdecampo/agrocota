import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  StatusBar, Linking, Alert, ActivityIndicator, FlatList,
  Platform,
} from 'react-native';
import MapView, { Marker, Polygon, PROVIDER_GOOGLE } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeContext';
import { RootStackParamList } from '../navigation/AppNavigator';

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'DetalhePropriedade'>;
  route: RouteProp<RootStackParamList, 'DetalhePropriedade'>;
};

type Tab = 'info' | 'talhoes' | 'anotacoes';

interface Fazenda {
  id: string; nome: string; produtor_nome: string | null;
  produtor_phone: string | null; produtor_email: string | null;
  municipio: string | null; estado: string | null;
  area_total_ha: number | null; observacoes: string | null;
  latitude: number | null; longitude: number | null;
  culturas_fazenda: { nome: string }[] | null;
}
interface Talhao {
  id: string; nome: string; area_ha: number | null;
  cultura: string | null; sistema_plantio: string | null;
  cor: string; coordenadas: any;
}
interface Anotacao { id: string; titulo: string; cor: string; updated_at: string; pinned: boolean; }

const geoToLatLng = (coordenadas: any): { latitude: number; longitude: number }[] => {
  try {
    const ring = coordenadas?.coordinates?.[0];
    if (!Array.isArray(ring)) return [];
    return (ring as [number, number][]).map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  } catch {
    return [];
  }
};

function calcCentroid(pts: { latitude: number; longitude: number }[]): { latitude: number; longitude: number } {
  if (pts.length === 0) return { latitude: 0, longitude: 0 };
  const sum = pts.reduce((acc, p) => ({ latitude: acc.latitude + p.latitude, longitude: acc.longitude + p.longitude }), { latitude: 0, longitude: 0 });
  return { latitude: sum.latitude / pts.length, longitude: sum.longitude / pts.length };
}

function calcAltitude(lat: number, lon: number): number {
  return Math.round(300 + (lat * 10) + (lon * 5));
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'info',      label: 'Info'    },
  { key: 'talhoes',   label: 'Talhoes' },
  { key: 'anotacoes', label: 'Notas'   },
];

// ─────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────

export default function DetalhePropriedadeScreen({ navigation, route }: Props) {
  const { fazendaId } = route.params;
  const { isDark } = useThemeMode();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('info');
  const [fazenda, setFazenda] = useState<Fazenda | null>(null);
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [anotacoes, setAnotacoes] = useState<Anotacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTalhao, setSelectedTalhao] = useState<Talhao | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [fazRes, talhRes, anotRes] = await Promise.all([
        supabase.from('fazendas').select('*, culturas_fazenda(nome)').eq('id', fazendaId).single(),
        supabase.from('talhoes').select('id,nome,area_ha,cultura,sistema_plantio,cor,coordenadas').eq('fazenda_id', fazendaId),
        supabase.from('anotacoes').select('id,titulo,cor,updated_at,pinned').eq('fazenda_id', fazendaId).order('pinned', { ascending: false }).order('updated_at', { ascending: false }),
      ]);
      if (fazRes.data) {
        const raw = fazRes.data as any;
        setFazenda({ ...raw, culturas_fazenda: raw.culturas_fazenda ?? [] } as Fazenda);
      }
      setTalhoes((talhRes.data ?? []) as Talhao[]);
      setAnotacoes((anotRes.data ?? []) as Anotacao[]);
    } catch (e) {
      console.warn('fetchAll error', e);
    } finally {
      setLoading(false);
    }
  }, [fazendaId]);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  const abrirWaze = () => {
    if (!fazenda?.latitude || !fazenda?.longitude) return;
    const url = `waze://?ll=${fazenda.latitude},${fazenda.longitude}&navigate=yes`;
    const fallback = `https://waze.com/ul?ll=${fazenda.latitude},${fazenda.longitude}&navigate=yes`;
    Linking.canOpenURL(url).then(ok => Linking.openURL(ok ? url : fallback));
  };

  const abrirGoogleMaps = () => {
    if (!fazenda?.latitude || !fazenda?.longitude) return;
    Linking.openURL(`https://maps.google.com/?q=${fazenda.latitude},${fazenda.longitude}`);
  };

  const deletarAnotacao = (id: string, titulo: string) => {
    Alert.alert('Excluir nota', `"${titulo}" sera excluida permanentemente.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => {
        await supabase.from('anotacoes').delete().eq('id', id);
        setAnotacoes(prev => prev.filter(a => a.id !== id));
      }},
    ]);
  };

  const palette = {
    pageBg: isDark ? '#0F1712' : BG,
    cardBg: isDark ? '#17241C' : '#FFFFFF',
    cardBorder: isDark ? '#24372B' : '#E8EDE8',
    divider: isDark ? '#24372B' : '#F0F2F0',
    title: isDark ? '#E8F2EC' : '#1A2E1A',
    text: isDark ? '#B8CCBE' : '#666666',
    muted: isDark ? '#8FA898' : '#AAB2AA',
    tabBg: isDark ? '#17241C' : '#FFFFFF',
    tabBorder: isDark ? '#24372B' : '#EEF0EE',
    tabText: isDark ? '#7C9384' : '#AAB2AA',
    summaryBg: isDark ? '#17241C' : '#FFFFFF',
    summaryBorder: isDark ? '#24372B' : '#EEF0EE',
    chipOverlay: isDark ? 'rgba(15,23,18,0.92)' : 'rgba(255,255,255,0.95)',
    chipBg: isDark ? '#1A2A21' : '#FFFFFF',
    emptyTitle: isDark ? '#DDEBE2' : '#333333',
    emptySub: isDark ? '#8FA898' : '#AAB2AA',
    infoPanelBg: isDark ? '#17241C' : '#FFFFFF',
    infoPanelBorder: isDark ? '#24372B' : '#E0E8E0',
    infoItemBg: isDark ? '#1D2F24' : '#F4F6F4',
    infoLabel: isDark ? '#6B8C75' : '#9FB4A7',
    infoValue: isDark ? '#E8F2EC' : '#1A2E1A',
  };

  if (loading) {
    return (
      <View style={[s.loadRoot, { backgroundColor: palette.pageBg }]}>
        <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }
  if (!fazenda) return <View style={[s.loadRoot, { backgroundColor: palette.pageBg }]}><Text style={[s.notFound, { color: palette.emptySub }]}>Propriedade nao encontrada</Text></View>;

  const hasLocation = !!(fazenda.latitude && fazenda.longitude);
  const location = hasLocation
    ? { latitude: fazenda.latitude!, longitude: fazenda.longitude! }
    : null;

  // Calcula info do talhão selecionado para a legenda
  const selectedTalhaoInfo = (() => {
    if (!selectedTalhao) return null;
    const coords = geoToLatLng(selectedTalhao.coordenadas);
    if (coords.length === 0) return null;
    const centroid = calcCentroid(coords);
    return { ...selectedTalhao, centroid, altitude: calcAltitude(centroid.latitude, centroid.longitude) };
  })();

  return (
    <View style={[s.root, { backgroundColor: palette.pageBg }]}>
      <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8}>
          <Text style={s.backTxt}>‹  Voltar</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{fazenda.nome}</Text>
          {fazenda.produtor_nome ? (
            <Text style={s.headerSub} numberOfLines={1}>{fazenda.produtor_nome}</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={s.editBtn}
          onPress={() => navigation.navigate('CadastrarPropriedade', { fazendaId })}
          activeOpacity={0.8}
        >
          <Text style={s.editTxt}>Editar</Text>
        </TouchableOpacity>
      </View>

      {/* ── Tab bar ── */}
      <View style={[s.tabBar, { backgroundColor: palette.tabBg, borderBottomColor: palette.tabBorder }]}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={s.tabBtn}
            onPress={() => { setTab(t.key); setSelectedTalhao(null); }}
            activeOpacity={0.8}
          >
            <Text style={[s.tabTxt, { color: palette.tabText }, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
            {tab === t.key && <View style={s.tabIndicator} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* ══════════════════════════════════════════
          TAB INFO
      ══════════════════════════════════════════ */}
      {tab === 'info' && (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Location banner */}
          {hasLocation && location && (
            <MapView
              style={s.heroMap}
              provider={PROVIDER_GOOGLE}
              mapType="hybrid"
              initialRegion={{ ...location, latitudeDelta: 0.06, longitudeDelta: 0.06 }}
              scrollEnabled={false}
              zoomEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
            >
              <Marker coordinate={location} pinColor="#76FF03" />
              {talhoes.filter(t => t.coordenadas?.coordinates?.length > 0).map(t => {
                const coords = geoToLatLng(t.coordenadas);
                if (coords.length < 3) return null;
                return (
                  <Polygon
                    key={t.id}
                    coordinates={coords}
                    strokeColor={t.cor ?? '#2E7D32'}
                    fillColor={(t.cor ?? '#2E7D32') + '55'}
                    strokeWidth={2}
                  />
                );
              })}
            </MapView>
          )}

          {/* Navigation buttons */}
          {hasLocation && (
            <View style={[s.navRow, { backgroundColor: palette.tabBg, borderBottomColor: palette.tabBorder }]}>
              <TouchableOpacity style={s.navBtn} onPress={abrirWaze} activeOpacity={0.85}>
                <Text style={s.navBtnTxt}>Waze</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.navBtn, s.navBtnAlt]} onPress={abrirGoogleMaps} activeOpacity={0.85}>
                <Text style={s.navBtnTxt}>Google Maps</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Properties grid */}
          <View style={s.propsGrid}>
            <PropCard label="Municipio" value={
              fazenda.municipio && fazenda.estado
                ? `${fazenda.municipio} / ${fazenda.estado}`
                : fazenda.municipio ?? '—'
            } isDark={isDark} />
            <PropCard label="Area total" value={fazenda.area_total_ha ? `${fazenda.area_total_ha} ha` : '—'} isDark={isDark} />
          </View>

          {/* Contact card */}
          {(fazenda.produtor_phone || fazenda.produtor_email) && (
            <View style={[s.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
              <Text style={[s.cardLabel, { color: palette.muted }]}>Contato</Text>
              {fazenda.produtor_phone && (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(`tel:${fazenda.produtor_phone}`)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.contactType, { color: palette.muted }]}>Telefone</Text>
                  <Text style={s.contactValue}>{fazenda.produtor_phone}</Text>
                </TouchableOpacity>
              )}
              {fazenda.produtor_email && fazenda.produtor_phone && <View style={[s.rowDivider, { backgroundColor: palette.divider }]} />}
              {fazenda.produtor_email && (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(`mailto:${fazenda.produtor_email}`)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.contactType, { color: palette.muted }]}>E-mail</Text>
                  <Text style={s.contactValue}>{fazenda.produtor_email}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Culturas */}
          {(fazenda.culturas_fazenda ?? []).length > 0 && (
            <View style={[s.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
              <Text style={[s.cardLabel, { color: palette.muted }]}>Culturas</Text>
              <View style={s.chipsRow}>
                {(fazenda.culturas_fazenda ?? []).map(c => (
                  <View key={c.nome} style={[s.chip, isDark && { backgroundColor: '#1D2F24' }]}>
                    <Text style={[s.chipTxt, isDark && { color: '#8DE1A9' }]}>{c.nome}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Observacoes */}
          {!!fazenda.observacoes && (
            <View style={[s.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
              <Text style={[s.cardLabel, { color: palette.muted }]}>Observacoes</Text>
              <Text style={[s.obsText, { color: palette.text }]}>{fazenda.observacoes}</Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════
          TAB TALHOES
      ══════════════════════════════════════════ */}
      {tab === 'talhoes' && (
        <View style={{ flex: 1 }}>
          {hasLocation && location ? (
            <>
              <MapView
                style={{ flex: 1 }}
                provider={PROVIDER_GOOGLE}
                mapType="hybrid"
                initialRegion={{ ...location, latitudeDelta: 0.06, longitudeDelta: 0.06 }}
                onPress={() => setSelectedTalhao(null)}
              >
                <Marker coordinate={location} pinColor="#76FF03" title={fazenda.nome} />
                {talhoes.filter(t => t.coordenadas?.coordinates?.length > 0).map(t => {
                  const coords = geoToLatLng(t.coordenadas);
                  if (coords.length < 3) return null;
                  return (
                    <Polygon
                      key={t.id}
                      coordinates={coords}
                      strokeColor={t.cor ?? '#2E7D32'}
                      fillColor={
                        selectedTalhao?.id === t.id
                          ? (t.cor ?? '#2E7D32') + 'AA'
                          : (t.cor ?? '#2E7D32') + '55'
                      }
                      strokeWidth={selectedTalhao?.id === t.id ? 3 : 2}
                      tappable
                      onPress={() => setSelectedTalhao(t)}
                    />
                  );
                })}
              </MapView>

              {/* Talhao chips overlay — clicáveis para mostrar legenda */}
              {talhoes.length > 0 && !selectedTalhao && (
                <View style={[s.overlayCips, { bottom: insets.bottom + 72, backgroundColor: palette.chipOverlay }]}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
                    {talhoes.map(t => (
                      <TouchableOpacity
                        key={t.id}
                        style={[s.talhaoChip, { borderColor: t.cor, backgroundColor: palette.chipBg }]}
                        onPress={() => setSelectedTalhao(t)}
                        activeOpacity={0.8}
                      >
                        <View style={[s.talhaoChipDot, { backgroundColor: t.cor }]} />
                        <Text style={[s.talhaoChipNome, { color: palette.title }]}>{t.nome}</Text>
                        {t.area_ha ? <Text style={[s.talhaoChipArea, { color: palette.muted }]}> {t.area_ha}ha</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Legenda de informações do talhão selecionado */}
              {selectedTalhaoInfo && (
                <View style={[s.talhaoInfoPanel, { bottom: insets.bottom + 72, backgroundColor: palette.infoPanelBg, borderColor: palette.infoPanelBorder }]}>
                  <View style={s.talhaoInfoHeader}>
                    <View style={[s.talhaoInfoDot, { backgroundColor: selectedTalhaoInfo.cor }]} />
                    <Text style={[s.talhaoInfoNome, { color: palette.title }]} numberOfLines={1}>{selectedTalhaoInfo.nome}</Text>
                    <TouchableOpacity onPress={() => setSelectedTalhao(null)} style={s.talhaoInfoClose}>
                      <Text style={[s.talhaoInfoCloseTxt, { color: palette.muted }]}>X</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={s.talhaoInfoGrid}>
                    <View style={[s.talhaoInfoItem, { backgroundColor: palette.infoItemBg }]}>
                      <Text style={[s.talhaoInfoLabel, { color: palette.infoLabel }]}>Área</Text>
                      <Text style={[s.talhaoInfoValue, { color: palette.infoValue }]}>{selectedTalhaoInfo.area_ha?.toFixed(2) ?? '—'} ha</Text>
                    </View>
                    <View style={[s.talhaoInfoItem, { backgroundColor: palette.infoItemBg }]}>
                      <Text style={[s.talhaoInfoLabel, { color: palette.infoLabel }]}>Altitude</Text>
                      <Text style={[s.talhaoInfoValue, { color: palette.infoValue }]}>{selectedTalhaoInfo.altitude} m</Text>
                    </View>
                    <View style={[s.talhaoInfoItem, { backgroundColor: palette.infoItemBg }]}>
                      <Text style={[s.talhaoInfoLabel, { color: palette.infoLabel }]}>Latitude</Text>
                      <Text style={[s.talhaoInfoValueSm, { color: palette.infoValue }]}>{selectedTalhaoInfo.centroid.latitude.toFixed(6)}</Text>
                    </View>
                    <View style={[s.talhaoInfoItem, { backgroundColor: palette.infoItemBg }]}>
                      <Text style={[s.talhaoInfoLabel, { color: palette.infoLabel }]}>Longitude</Text>
                      <Text style={[s.talhaoInfoValueSm, { color: palette.infoValue }]}>{selectedTalhaoInfo.centroid.longitude.toFixed(6)}</Text>
                    </View>
                    <View style={[s.talhaoInfoItem, { backgroundColor: palette.infoItemBg }]}>
                      <Text style={[s.talhaoInfoLabel, { color: palette.infoLabel }]}>Cultura</Text>
                      <Text style={[s.talhaoInfoValue, { color: palette.infoValue }]} numberOfLines={1}>{selectedTalhaoInfo.cultura || 'N/D'}</Text>
                    </View>
                    <View style={[s.talhaoInfoItem, { backgroundColor: palette.infoItemBg }]}>
                      <Text style={[s.talhaoInfoLabel, { color: palette.infoLabel }]}>Sistema</Text>
                      <Text style={[s.talhaoInfoValue, { color: palette.infoValue }]} numberOfLines={1}>{selectedTalhaoInfo.sistema_plantio || 'N/D'}</Text>
                    </View>
                  </View>
                </View>
              )}
            </>
          ) : (
            <View style={s.emptyBlock}>
              <Text style={[s.emptyTitle, { color: palette.emptyTitle }]}>Sem localizacao cadastrada</Text>
              <Text style={[s.emptySub, { color: palette.emptySub }]}>Edite a propriedade e adicione o GPS para ver o mapa de talhoes.</Text>
            </View>
          )}

          {/* FAB talhoes */}
          <TouchableOpacity
            style={[s.fab, { bottom: insets.bottom + 24 }]}
            onPress={() => navigation.navigate('TalhoesMapa', { fazendaId, fazendaNome: fazenda.nome })}
            activeOpacity={0.85}
          >
            <Text style={s.fabTxt}>+</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ══════════════════════════════════════════
          TAB ANOTACOES
      ══════════════════════════════════════════ */}
      {tab === 'anotacoes' && (
        <View style={{ flex: 1 }}>
          <FlatList
            data={anotacoes}
            keyExtractor={i => i.id}
            numColumns={2}
            contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
            columnWrapperStyle={{ gap: 10 }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={s.emptyBlock}>
                <Text style={[s.emptyTitle, { color: palette.emptyTitle }]}>Sem anotacoes</Text>
                <Text style={[s.emptySub, { color: palette.emptySub }]}>Toque em + para criar a primeira nota desta propriedade.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[s.noteCard, { backgroundColor: item.cor ?? '#FFF9C4' }]}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('NovaAnotacao', { fazendaId, anotacaoId: item.id })}
                onLongPress={() => deletarAnotacao(item.id, item.titulo)}
              >
                {item.pinned && (
                  <View style={s.pinnedBadge}><Text style={s.pinnedTxt}>fixada</Text></View>
                )}
                <Text style={s.noteTitle} numberOfLines={4}>{item.titulo}</Text>
                <Text style={s.noteDate}>{new Date(item.updated_at).toLocaleDateString('pt-BR')}</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity
            style={[s.fab, { bottom: insets.bottom + 24 }]}
            onPress={() => navigation.navigate('NovaAnotacao', { fazendaId })}
            activeOpacity={0.85}
          >
            <Text style={s.fabTxt}>+</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────

function PropCard({ label, value, isDark = false }: { label: string; value: string; isDark?: boolean }) {
  return (
    <View style={[s.propCard, { backgroundColor: isDark ? '#17241C' : '#fff', borderColor: isDark ? '#24372B' : '#E8EDE8' }]}>
      <Text style={[s.propCardLabel, { color: isDark ? '#8FA898' : '#AAB2AA' }]}>{label.toUpperCase()}</Text>
      <Text style={[s.propCardValue, { color: isDark ? '#E8F2EC' : '#1A2E1A' }]}>{value}</Text>
    </View>
  );
}

function MetaTag({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaTag}>
      <Text style={s.metaTagLabel}>{label}</Text>
      <Text style={s.metaTagValue}>{value}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────

const GREEN = '#1F4E1F';
const GREEN_LIGHT = '#2E7D32';
const BG = '#F4F6F4';

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  loadRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG },
  notFound: { color: '#888', fontSize: 15 },

  // Header
  header: {
    backgroundColor: GREEN, paddingTop: 14, paddingBottom: 14, paddingHorizontal: 20,
    minHeight: 80,
    flexDirection: 'row', alignItems: 'center',
  },
  backBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    minWidth: 88, alignItems: 'center',
  },
  backTxt: { color: '#A5D6A7', fontSize: 14, fontWeight: '700' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  headerSub: { color: '#A5D6A7', fontSize: 12, marginTop: 2 },
  editBtn: {
    minWidth: 88, alignItems: 'flex-end',
  },
  editTxt: { color: '#A5D6A7', fontSize: 14, fontWeight: '600' },

  // Tab bar
  tabBar: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#EEF0EE',
  },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', position: 'relative' },
  tabTxt: { fontSize: 13, color: '#AAB2AA', fontWeight: '600' },
  tabTxtActive: { color: GREEN_LIGHT, fontWeight: '800' },
  tabIndicator: {
    position: 'absolute', bottom: 0, left: '20%', right: '20%',
    height: 2, backgroundColor: GREEN_LIGHT, borderRadius: 1,
  },

  // ── INFO tab ──
  scroll: { paddingTop: 0, paddingBottom: 40 },

  heroMap: {
    height: 220, marginBottom: 0,
  },
  navRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEF0EE',
  },
  navBtn: {
    flex: 1, backgroundColor: GREEN_LIGHT, paddingVertical: 11,
    borderRadius: 10, alignItems: 'center',
  },
  navBtnAlt: { backgroundColor: '#1565C0' },
  navBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  propsGrid: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 14, gap: 10, marginBottom: 10 },
  propCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#E8EDE8',
  },
  propCardLabel: { fontSize: 10, color: '#AAB2AA', fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  propCardValue: { fontSize: 15, color: '#1A2E1A', fontWeight: '600', lineHeight: 20 },

  card: {
    backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 16,
    marginBottom: 10, borderWidth: 1, borderColor: '#E8EDE8', overflow: 'hidden',
  },
  cardLabel: {
    fontSize: 10, color: '#AAB2AA', fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
  },
  rowDivider: { height: 1, backgroundColor: '#F0F2F0', marginLeft: 16 },
  contactRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  contactType: { fontSize: 13, color: '#AAB2AA', fontWeight: '600', width: 70 },
  contactValue: { fontSize: 15, color: '#1565C0', fontWeight: '500', flex: 1 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  chip: { backgroundColor: '#E8F5E9', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  chipTxt: { color: GREEN_LIGHT, fontSize: 13, fontWeight: '600' },

  obsText: { fontSize: 14, color: '#555', lineHeight: 21, paddingHorizontal: 16, paddingBottom: 14 },

  // ── TALHOES tab ──
  overlayCips: {
    position: 'absolute', bottom: 72, left: 0, right: 0,
    backgroundColor: 'rgba(255,255,255,0.95)', paddingVertical: 10,
  },
  talhaoChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 2,
  },
  talhaoChipDot: { width: 9, height: 9, borderRadius: 5, marginRight: 7 },
  talhaoChipNome: { fontSize: 13, fontWeight: '700', color: '#1A2E1A', maxWidth: 110 },
  talhaoChipArea: { fontSize: 11, color: '#888' },

  // Legenda do talhão selecionado
  talhaoInfoPanel: {
    position: 'absolute', left: 12, right: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1, borderColor: '#E0E8E0',
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    elevation: 12,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: -2 },
  },
  talhaoInfoHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
  },
  talhaoInfoDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  talhaoInfoNome: { flex: 1, fontSize: 15, fontWeight: '900', color: '#1A2E1A' },
  talhaoInfoClose: {
    backgroundColor: '#F0F4F0', borderRadius: 14, width: 28, height: 28,
    justifyContent: 'center', alignItems: 'center',
  },
  talhaoInfoCloseTxt: { color: '#555', fontSize: 13, fontWeight: '700' },
  talhaoInfoGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  talhaoInfoItem: {
    width: '31%', flexGrow: 1, backgroundColor: '#F4F6F4', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  talhaoInfoLabel: {
    fontSize: 9, fontWeight: '800', color: '#9FB4A7',
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2,
  },
  talhaoInfoValue: { fontSize: 13, fontWeight: '700', color: '#1A2E1A' },
  talhaoInfoValueSm: { fontSize: 11, fontWeight: '600', color: '#1A2E1A' },

  // ── PLANTIO tab ──
  talhaoSummaryBar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEF0EE', flexGrow: 0 },
  talhaoSummaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F4F6F4', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  talhaoSummaryDot: { width: 12, height: 12, borderRadius: 6 },
  talhaoSummaryNome: { fontSize: 13, fontWeight: '700', color: '#1A2E1A' },
  talhaoSummaryCultura: { fontSize: 12, color: '#666', marginTop: 1 },
  talhaoSummaryArea: { fontSize: 11, color: '#AAB2AA', marginTop: 1 },

  plantioCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#E8EDE8',
  },
  plantioHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  plantioNome: { fontSize: 16, fontWeight: '800', color: '#1A2E1A', flex: 1 },
  safraBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  safraTxt: { fontSize: 12, color: GREEN_LIGHT, fontWeight: '700' },
  plantioMetas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  plantioObs: { fontSize: 13, color: '#777', marginTop: 10, lineHeight: 18 },
  plantioHint: { fontSize: 10, color: '#C0C8C0', marginTop: 8, textAlign: 'right', letterSpacing: 0.2 },
  metaTag: { backgroundColor: '#F4F6F4', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  metaTagLabel: { fontSize: 10, color: '#AAB2AA', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaTagValue: { fontSize: 13, color: '#333', fontWeight: '600', marginTop: 2 },

  // ── ANOTACOES tab ──
  noteCard: {
    flex: 1, borderRadius: 14, padding: 14, minHeight: 130, marginBottom: 10,
    justifyContent: 'space-between',
  },
  pinnedBadge: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.08)',
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 7,
  },
  pinnedTxt: { fontSize: 10, fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },
  noteTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A', lineHeight: 20, flex: 1 },
  noteDate: { fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 10 },

  // ── Shared ──
  emptyBlock: { paddingTop: 60, paddingHorizontal: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#AAB2AA', textAlign: 'center', lineHeight: 21 },

  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: GREEN_LIGHT, justifyContent: 'center', alignItems: 'center',
    elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  fabTxt: { color: '#fff', fontSize: 28, fontWeight: '300', lineHeight: 32 },

  // ── REGISTROS tab ──
  filtroWrap: {
    borderBottomWidth: 1,
    borderBottomColor: '#EEF0EE',
    flexGrow: 0,
    minHeight: 62,
  },
  filtroRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    alignItems: 'center',
  },
  filtroChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.3,
    borderColor: '#CFE2CF',
    backgroundColor: 'transparent',
  },
  filtroChipActive: {
    backgroundColor: '#2E7D32',
    borderColor: '#2E7D32',
  },
  filtroChipTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5F7A5F',
  },
  filtroChipTxtActive: {
    color: '#fff',
  },
  registrosSummary: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#EEF0EE',
    paddingVertical: 14,
  },
  summaryCol: { flex: 1, alignItems: 'center' },
  summaryNum: { fontSize: 18, fontWeight: '800', color: '#1A2E1A' },
  summaryLbl: { fontSize: 11, color: '#AAB2AA', fontWeight: '600', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryDividerV: { width: 1, backgroundColor: '#EEF0EE', marginVertical: 4 },

  safraHeader: { marginBottom: 8, marginTop: 8 },
  safraHeaderTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5F7A5F',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },

  // ── REGISTROS: cotacao cards ──
  cotCard: {
    backgroundColor: '#fff', borderRadius: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#E8EDE8', overflow: 'hidden',
  },
  cotHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4,
  },
  cotHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cotTitulo: { fontSize: 15, fontWeight: '800', color: '#1A2E1A', flex: 1, marginRight: 8 },
  cotBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  cotBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  cotData: { fontSize: 12, color: '#AAB2AA', paddingHorizontal: 14, paddingBottom: 10 },
  cotResumo: { fontSize: 12, fontWeight: '600', paddingHorizontal: 14, paddingBottom: 10 },
  expandBtn: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  expandBtnTxt: { fontSize: 11, fontWeight: '700' },

  registroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  registroActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CFE2CF',
    backgroundColor: '#F3FAF3',
  },
  registroActionBtnWarn: {
    borderColor: '#E8D3D3',
    backgroundColor: '#FFF3F3',
  },
  registroActionTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2E7D32',
  },
  registroActionTxtWarn: {
    color: '#A33A3A',
  },
  registroActionMeta: {
    fontSize: 11,
    color: '#7C8F7C',
    fontWeight: '600',
  },

  aceiteRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  aceiteProduto: { fontSize: 14, fontWeight: '700', color: '#1A2E1A' },
  aceiteMeta: { fontSize: 12, color: '#888', marginTop: 2 },

  compraBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#F4F6F4', borderWidth: 1, borderColor: '#D0D8D0',
    marginLeft: 8,
  },
  compraBtnDone: { backgroundColor: '#E8F5E9', borderColor: '#A5D6A7' },
  compraBtnTxt: { fontSize: 12, fontWeight: '700', color: '#555' },
  compraBtnTxtDone: { color: '#2E7D32' },

  cardHint: { fontSize: 10, color: '#C0C8C0', marginTop: 8, textAlign: 'right', letterSpacing: 0.2 },
});