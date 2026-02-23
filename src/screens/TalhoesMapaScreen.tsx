import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  StatusBar, TextInput, Modal, ActivityIndicator, FlatList, ScrollView,
} from 'react-native';
import MapView, { Marker, Polygon, Polyline, UrlTile } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TalhoesMapa'>;
  route: RouteProp<RootStackParamList, 'TalhoesMapa'>;
};

type LatLng = { latitude: number; longitude: number };

const CORES = ['#E53935','#8E24AA','#1E88E5','#00ACC1','#43A047','#FFB300','#F4511E','#6D4C41'];

const CULTURAS_TALHAO = [
  'Soja','Milho','Algodao','Feijao','Trigo','Cana-de-acucar',
  'Cafe','Arroz','Sorgo','Pastagem','Girassol','Outros',
];

const SISTEMAS_PLANTIO = [
  'Plantio Direto','Convencional','Cultivo Minimo',
  'Organico','ILP','ILPF',
];

interface Talhao {
  id: string; nome: string; area_ha: number | null;
  cultura: string | null; sistema_plantio: string | null;
  cor: string; coordenadas: any;
}

function calcAreaHa(pts: LatLng[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  const n = pts.length;
  const R = 6371000;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = pts[i].longitude * (Math.PI / 180) * R * Math.cos(pts[i].latitude * (Math.PI / 180));
    const yi = pts[i].latitude * (Math.PI / 180) * R;
    const xj = pts[j].longitude * (Math.PI / 180) * R * Math.cos(pts[j].latitude * (Math.PI / 180));
    const yj = pts[j].latitude * (Math.PI / 180) * R;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area / 2) / 10000;
}

// Extracts the first polygon from a KML string
function parseKMLCoordinates(kml: string): LatLng[] {
  // Support both <coordinates> inside <Polygon> and <LineString>
  const match = kml.match(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
  if (!match) return [];
  const points: LatLng[] = [];
  const tokens = match[1].trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const parts = token.split(',');
    if (parts.length >= 2) {
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) points.push({ latitude: lat, longitude: lng });
    }
  }
  // Remove duplicate closing point (GeoJSON/KML often repeats the first point at the end)
  if (points.length > 1) {
    const first = points[0], last = points[points.length - 1];
    if (Math.abs(first.latitude - last.latitude) < 0.000001 &&
        Math.abs(first.longitude - last.longitude) < 0.000001) {
      points.pop();
    }
  }
  return points;
}

export default function TalhoesMapaScreen({ navigation, route }: Props) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const { fazendaId, fazendaNome } = route.params;
  const mapRef = useRef<MapView>(null);

  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [fazendaLoc, setFazendaLoc] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(true);

  // Drawing state
  const [drawMode, setDrawMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([]);

  // Save modal
  const [saveModal, setSaveModal] = useState(false);
  const [nomeNovo, setNomeNovo] = useState('');
  const [cultNovo, setCultNovo] = useState('');
  const [sistemaPlantio, setSistemaPlantio] = useState('');
  const [corNovo, setCorNovo] = useState(CORES[0]);
  const [saving, setSaving] = useState(false);

  const fetchTalhoes = useCallback(async () => {
    setLoading(true);
    const [locRes, tRes] = await Promise.all([
      supabase.from('fazendas').select('latitude,longitude').eq('id', fazendaId).single(),
      supabase.from('talhoes').select('id,nome,area_ha,cultura,sistema_plantio,cor,coordenadas').eq('fazenda_id', fazendaId),
    ]);
    if (locRes.data?.latitude) setFazendaLoc({ latitude: locRes.data.latitude, longitude: locRes.data.longitude });
    setTalhoes((tRes.data ?? []) as Talhao[]);
    setLoading(false);
  }, [fazendaId]);

  useFocusEffect(useCallback(() => { fetchTalhoes(); }, [fetchTalhoes]));

  const handleMapPress = useCallback((e: { nativeEvent: { coordinate: LatLng } }) => {
    if (!drawMode) return;
    const coord = { latitude: e.nativeEvent.coordinate.latitude, longitude: e.nativeEvent.coordinate.longitude };
    setDrawPoints(prev => [...prev, coord]);
  }, [drawMode]);

  const undoLast = () => setDrawPoints(prev => prev.slice(0, -1));

  const limparDesenho = () => {
    Alert.alert(
      'Limpar desenho',
      'Deseja remover todos os pontos marcados?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Limpar', style: 'destructive', onPress: () => setDrawPoints([]) },
      ]
    );
  };

  const cancelDraw = () => {
    setDrawMode(false);
    setDrawPoints([]);
  };

  const confirmDraw = () => {
    if (drawPoints.length < 3) { Alert.alert('Atenção', 'Marque pelo menos 3 pontos para formar um talhão.'); return; }
    setSaveModal(true);
  };

  const saveTalhao = async () => {
    if (!nomeNovo.trim()) { Alert.alert('Atenção', 'Informe um nome para o talhão.'); return; }
    setSaving(true);
    const area = parseFloat(calcAreaHa(drawPoints).toFixed(2));
    const geojson = {
      type: 'Polygon',
      coordinates: [[...drawPoints.map(p => [p.longitude, p.latitude]), [drawPoints[0].longitude, drawPoints[0].latitude]]],
    };
    const { error } = await supabase.from('talhoes').insert({
      fazenda_id: fazendaId,
      nome: nomeNovo.trim(),
      cultura: cultNovo || null,
      sistema_plantio: sistemaPlantio || null,
      area_ha: area,
      cor: corNovo,
      coordenadas: geojson,
    });
    setSaving(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    setSaveModal(false);
    setNomeNovo(''); setCultNovo(''); setSistemaPlantio(''); setCorNovo(CORES[0]);
    setDrawMode(false);
    setDrawPoints([]);
    fetchTalhoes();
  };

  const deletarTalhao = (id: string, nome: string) => {
    Alert.alert('Excluir talhão', `"${nome}" será excluído.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => {
        await supabase.from('talhoes').delete().eq('id', id);
        setTalhoes(prev => prev.filter(t => t.id !== id));
      }},
    ]);
  };

  const importarKML = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.google-earth.kml+xml', 'text/xml', 'application/xml', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const content = await FileSystem.readAsStringAsync(res.assets[0].uri);
      const points = parseKMLCoordinates(content);
      if (points.length < 3) {
        Alert.alert(
          'Arquivo invalido',
          'Nenhum poligono valido encontrado.\n\nNo Google Earth: clique com botao direito no poligono > Salvar local como > Formato KML.'
        );
        return;
      }
      setDrawPoints(points);
      setDrawMode(true);
      // Fly map to the imported polygon
      if (mapRef.current) {
        const lats = points.map(p => p.latitude);
        const lngs = points.map(p => p.longitude);
        mapRef.current.animateToRegion({
          latitude: (Math.max(...lats) + Math.min(...lats)) / 2,
          longitude: (Math.max(...lngs) + Math.min(...lngs)) / 2,
          latitudeDelta: (Math.max(...lats) - Math.min(...lats)) * 1.5 + 0.002,
          longitudeDelta: (Math.max(...lngs) - Math.min(...lngs)) * 1.5 + 0.002,
        }, 800);
      }
    } catch {
      Alert.alert('Erro', 'Nao foi possivel ler o arquivo KML.');
    }
  };

  // Memoised so existing polygons don't re-render while drawing
  const talhaoPolygons = useMemo(() =>
    talhoes.filter(t => t.coordenadas?.coordinates?.[0]?.length > 0).map(t => {
      const coords: LatLng[] = (t.coordenadas.coordinates[0] as [number, number][]).map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
      return (
        <Polygon
          key={t.id}
          coordinates={coords}
          strokeColor={t.cor ?? '#2E7D32'}
          fillColor={(t.cor ?? '#2E7D32') + '55'}
          strokeWidth={2}
          tappable
          onPress={() => Alert.alert(
            t.nome,
            [
              t.cultura ? `Cultura: ${t.cultura}` : '',
              t.sistema_plantio ? `Sistema: ${t.sistema_plantio}` : '',
              t.area_ha ? `Area: ${t.area_ha} ha` : '',
            ].filter(Boolean).join('\n'),
            [
              { text: 'Fechar' },
              { text: 'Excluir', style: 'destructive', onPress: () => deletarTalhao(t.id, t.nome) },
            ]
          )}
        />
      );
    })
  , [talhoes]);

  const centralRegion = fazendaLoc
    ? { latitude: fazendaLoc.latitude, longitude: fazendaLoc.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { latitude: -15, longitude: -54, latitudeDelta: 30, longitudeDelta: 30 };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#193C19" />

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#2E7D32" />
        </View>
      ) : (
        <>
          {/* ── Header ── */}
          <View style={s.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8}>
              <Text style={s.backTxt}>‹  Voltar</Text>
            </TouchableOpacity>
            <Text style={s.headerTitle} numberOfLines={1}>Talhoes — {fazendaNome}</Text>
          </View>

          {/* ── Map container, flex: 1 ── */}
          <View style={s.mapContainer}>
            <MapView
              ref={mapRef}
              style={s.map}
              initialRegion={centralRegion}
              scrollEnabled={true}
              zoomEnabled={true}
              rotateEnabled={false}
              pitchEnabled={false}
              onPress={handleMapPress}
            >
              <UrlTile
                urlTemplate="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maximumZ={19}
                flipY={false}
                zIndex={-1}
              />
              {fazendaLoc && <Marker coordinate={fazendaLoc} pinColor="#2E7D32" title={fazendaNome} />}
              {talhaoPolygons}
              {drawMode && drawPoints.length >= 3 && (
                <Polygon coordinates={drawPoints} fillColor={corNovo + '40'} strokeColor={corNovo} strokeWidth={3} />
              )}
              {drawMode && drawPoints.length >= 2 && (
                <Polyline coordinates={drawPoints} strokeColor={corNovo} strokeWidth={3} />
              )}
            </MapView>

            {/* Instruction banner — absolute inside map */}
            {drawMode && (
              <View style={s.drawInstructions}>
                <Text style={s.drawInstructionsTxt}>
                  Toque no mapa para adicionar pontos e formar o contorno do talhao
                </Text>
              </View>
            )}
          </View>

          {/* ── Talhões chips (only when not drawing) ── */}
          {!drawMode && talhoes.length > 0 && (
            <View style={s.listPanel}>
              <FlatList
                data={talhoes}
                keyExtractor={t => t.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[s.talhaoChip, { borderColor: item.cor }]}
                    activeOpacity={0.8}
                    onPress={() => {
                      if (!item.coordenadas?.coordinates?.[0]?.length) return;
                      const coords: LatLng[] = (item.coordenadas.coordinates[0] as [number, number][]).map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
                      const lats = coords.map(c => c.latitude);
                      const lngs = coords.map(c => c.longitude);
                      mapRef.current?.animateToRegion({
                        latitude: (Math.max(...lats) + Math.min(...lats)) / 2,
                        longitude: (Math.max(...lngs) + Math.min(...lngs)) / 2,
                        latitudeDelta: Math.max(...lats) - Math.min(...lats) + 0.005,
                        longitudeDelta: Math.max(...lngs) - Math.min(...lngs) + 0.005,
                      }, 600);
                    }}
                  >
                    <View style={[s.talhaoChipDot, { backgroundColor: item.cor }]} />
                    <Text style={s.talhaoChipTxt} numberOfLines={1}>{item.nome}</Text>
                    {item.area_ha ? <Text style={s.talhaoChipArea}>{item.area_ha}ha</Text> : null}
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {/* ── Draw controls / Bottom bar ── */}
          {drawMode ? (
            <View style={s.drawControls}>
              <View style={s.drawRow}>
                <TouchableOpacity style={s.drawCtrlBtn} onPress={undoLast} disabled={drawPoints.length === 0} activeOpacity={0.8}>
                  <Text style={[s.drawCtrlTxt, { color: '#F59E0B' }]}>Desfazer</Text>
                </TouchableOpacity>
                <View style={s.drawAreaCenter}>
                  <Text style={s.drawAreaLabel}>Area estimada</Text>
                  <Text style={s.drawAreaValue}>{calcAreaHa(drawPoints).toFixed(2)} ha</Text>
                </View>
                <TouchableOpacity style={s.drawCtrlBtn} onPress={limparDesenho} disabled={drawPoints.length === 0} activeOpacity={0.8}>
                  <Text style={[s.drawCtrlTxt, { color: '#EF4444' }]}>Limpar</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[s.confirmBtn, drawPoints.length < 3 && { opacity: 0.4 }]}
                onPress={confirmDraw}
                disabled={drawPoints.length < 3}
                activeOpacity={0.85}
              >
                <Text style={s.confirmBtnTxt}>Confirmar ({drawPoints.length} pontos)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.cancelBtn} onPress={cancelDraw}>
                <Text style={s.cancelTxt}>Cancelar</Text>
              </TouchableOpacity>
              <View style={{ height: insets.bottom }} />
            </View>
          ) : (
            <View style={s.bottomBar}>
              <TouchableOpacity style={s.newTalhaoBtn} onPress={() => setDrawMode(true)} activeOpacity={0.85}>
                <Text style={s.newTalhaoBtnTxt}>+ Desenhar Talhao</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.importKmlBtn} onPress={importarKML} activeOpacity={0.85}>
                <Text style={s.importKmlTxt}>Importar KML</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={{ height: insets.bottom, backgroundColor: 'rgba(255,255,255,0.97)' }} />
        </>
      )}

      {/* Save Modal */}
      <Modal visible={saveModal} transparent animationType="slide" onRequestClose={() => setSaveModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Salvar Talhao</Text>
            <Text style={s.modalSub}>Area estimada: {calcAreaHa(drawPoints).toFixed(2)} ha</Text>
            <Text style={s.inputLabel}>Nome do talhao *</Text>
            <TextInput style={s.input} value={nomeNovo} onChangeText={setNomeNovo} placeholder="Ex: Talhao 1, Gleba Norte..." placeholderTextColor="#bbb" />
            <Text style={s.inputLabel}>Cultura</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
              {CULTURAS_TALHAO.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[s.pickChip, cultNovo === c && s.pickChipSel]}
                  onPress={() => setCultNovo(prev => prev === c ? '' : c)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.pickChipTxt, cultNovo === c && s.pickChipTxtSel]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={s.inputLabel}>Sistema de Plantio</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
              {SISTEMAS_PLANTIO.map(sp => (
                <TouchableOpacity
                  key={sp}
                  style={[s.pickChip, sistemaPlantio === sp && s.pickChipSel]}
                  onPress={() => setSistemaPlantio(prev => prev === sp ? '' : sp)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.pickChipTxt, sistemaPlantio === sp && s.pickChipTxtSel]}>{sp}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={s.inputLabel}>Cor</Text>
            <View style={s.coresRow}>
              {CORES.map(c => (
                <TouchableOpacity key={c} style={[s.coreDot, { backgroundColor: c }, corNovo === c && s.coreSelected]} onPress={() => setCorNovo(c)} />
              ))}
            </View>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => setSaveModal(false)} disabled={saving}>
                <Text style={s.modalCancelTxt}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalSaveBtn} onPress={saveTalhao} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.modalSaveTxt}>Salvar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#193C19' },
  header: {
    backgroundColor: '#193C19',
    paddingVertical: 14, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center',
  },
  backBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginRight: 10,
    backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    minWidth: 88, alignItems: 'center',
  },
  backTxt: { color: '#A5D6A7', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '800', flex: 1 },
  drawInstructions: {
    position: 'absolute', top: 10, left: 16, right: 16, zIndex: 11,
    backgroundColor: 'rgba(254,243,199,0.95)', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14,
  },
  drawInstructionsTxt: { color: '#92400E', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  mapContainer: { flex: 1 },
  map: { width: '100%', height: '100%' },
  listPanel: {
    backgroundColor: 'rgba(255,255,255,0.97)', paddingVertical: 10,
  },
  talhaoChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F7F8F7',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 2,
  },
  talhaoChipDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  talhaoChipTxt: { fontSize: 13, fontWeight: '700', color: '#1A2E1A', maxWidth: 100 },
  talhaoChipArea: { fontSize: 11, color: '#888', marginLeft: 4 },
  drawControls: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
  },
  drawRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  drawCtrlBtn: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  drawCtrlTxt: { fontSize: 14, fontWeight: '700' },
  drawAreaCenter: { flex: 2, alignItems: 'center' },
  drawAreaLabel: { fontSize: 11, color: '#888' },
  drawAreaValue: { fontSize: 20, fontWeight: '800', color: '#1A2E1A' },
  confirmBtn: {
    backgroundColor: '#2E7D32', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginBottom: 6,
  },
  confirmBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  cancelBtn: { width: '100%', alignItems: 'center', paddingVertical: 8 },
  cancelTxt: { color: '#E53935', fontWeight: '700', fontSize: 13 },
  bottomBar: {
    backgroundColor: 'rgba(255,255,255,0.97)', padding: 12,
    flexDirection: 'row', gap: 10,
  },
  newTalhaoBtn: {
    flex: 1, backgroundColor: '#2E7D32', borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  newTalhaoBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  importKmlBtn: {
    flex: 1, backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  importKmlTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1A2E1A', marginBottom: 4 },
  modalSub: { fontSize: 13, color: '#888', marginBottom: 20 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#2E7D32', marginBottom: 6, textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 11, fontSize: 15, color: '#222', marginBottom: 14,
  },
  pickChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fafafa',
  },
  pickChipSel: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  pickChipTxt: { fontSize: 13, color: '#555', fontWeight: '600' },
  pickChipTxtSel: { color: '#fff' },
  coresRow: { flexDirection: 'row', gap: 10, marginBottom: 24, marginTop: 4 },
  coreDot: { width: 32, height: 32, borderRadius: 16 },
  coreSelected: { borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 4 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalCancelTxt: { color: '#666', fontWeight: '700', fontSize: 15 },
  modalSaveBtn: { flex: 2, backgroundColor: '#2E7D32', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalSaveTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
