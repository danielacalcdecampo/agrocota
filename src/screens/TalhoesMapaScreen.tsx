import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  StatusBar, TextInput, Modal, ActivityIndicator, FlatList, ScrollView, KeyboardAvoidingView, Platform,
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
import { fetchAltitude } from '../services/TalhaoMapService';
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

// Calcula o centro do polígono
function calcCentroid(pts: LatLng[]): LatLng {
  if (pts.length === 0) return { latitude: 0, longitude: 0 };
  const sum = pts.reduce((acc, p) => ({
    latitude: acc.latitude + p.latitude,
    longitude: acc.longitude + p.longitude
  }), { latitude: 0, longitude: 0 });
  return {
    latitude: sum.latitude / pts.length,
    longitude: sum.longitude / pts.length
  };
}

// (removido: altitude real via TalhaoMapService.fetchAltitude)

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

  // Selected talhão info (legenda)
  const [selectedTalhao, setSelectedTalhao] = useState<Talhao | null>(null);
  const [talhaoAltitude, setTalhaoAltitude] = useState<number | null>(null);
  const [altitudeLoading, setAltitudeLoading] = useState(false);

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
    if (!drawMode) {
      // Se não está em modo desenho, limpa a seleção ao clicar no mapa
      setSelectedTalhao(null);
      return;
    }
    const coord = { latitude: e.nativeEvent.coordinate.latitude, longitude: e.nativeEvent.coordinate.longitude };
    setDrawPoints(prev => [...prev, coord]);
  }, [drawMode]);

  const handleTalhaoPress = useCallback((talhao: Talhao) => {
    setSelectedTalhao(talhao);
  }, []);

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
    Alert.alert(
      'Deletar Talhão',
      `Tem certeza que deseja deletar o talhão "${nome}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Deletar',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('talhoes').delete().eq('id', id);
            if (error) Alert.alert('Erro', error.message);
            else {
              if (selectedTalhao?.id === id) setSelectedTalhao(null);
              fetchTalhoes();
            }
          },
        },
      ]
    );
  };

  const importarKML = async () => {
    try {
      const doc = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (doc.canceled) return;
      const file = doc.assets?.[0];
      if (!file?.uri) return;
      const content = await FileSystem.readAsStringAsync(file.uri, { encoding: 'utf8' });
      const coords = parseKMLCoordinates(content);
      if (coords.length < 3) { Alert.alert('Erro', 'Não foi possível extrair coordenadas do arquivo KML.'); return; }
      setDrawPoints(coords);
      setDrawMode(true);
    } catch (err: any) {
      Alert.alert('Erro', err.message || 'Não foi possível ler o arquivo.');
    }
  };

  const polygons = useMemo(() => talhoes.map(t => {
    const coords = t.coordenadas?.type === 'Polygon' && Array.isArray(t.coordenadas.coordinates?.[0])
      ? t.coordenadas.coordinates[0].map((c: [number, number]) => ({ latitude: c[1], longitude: c[0] }))
      : [];
    return { ...t, coords };
  }), [talhoes]);

  const initialRegion = useMemo(() => {
    if (fazendaLoc) return { ...fazendaLoc, latitudeDelta: 0.02, longitudeDelta: 0.02 };
    return { latitude: -15.7942, longitude: -47.8822, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  }, [fazendaLoc]);

  // Calcula infos síncronas + busca altitude real via API
  const selectedTalhaoInfo = useMemo(() => {
    if (!selectedTalhao) return null;
    const coords = selectedTalhao.coordenadas?.type === 'Polygon' && Array.isArray(selectedTalhao.coordenadas.coordinates?.[0])
      ? selectedTalhao.coordenadas.coordinates[0].map((c: [number, number]) => ({ latitude: c[1], longitude: c[0] }))
      : [];
    if (coords.length === 0) return null;
    const centroid = calcCentroid(coords);
    return { ...selectedTalhao, centroid, coords };
  }, [selectedTalhao]);

  useEffect(() => {
    if (!selectedTalhaoInfo) {
      setTalhaoAltitude(null);
      return;
    }
    let cancelled = false;
    setAltitudeLoading(true);
    fetchAltitude(selectedTalhaoInfo.centroid.latitude, selectedTalhaoInfo.centroid.longitude)
      .then(alt => { if (!cancelled) setTalhaoAltitude(alt); })
      .catch(() => { if (!cancelled) setTalhaoAltitude(null); })
      .finally(() => { if (!cancelled) setAltitudeLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTalhaoInfo?.centroid?.latitude, selectedTalhaoInfo?.centroid?.longitude]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#193C19" />
      
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top > 0 ? 0 : 14 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={s.backTxt}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{fazendaNome}</Text>
      </View>

      {/* Draw Instructions */}
      {drawMode && (
        <View style={s.drawInstructions}>
          <Text style={s.drawInstructionsTxt}>
            Toque no mapa para marcar os cantos do talhão
          </Text>
        </View>
      )}

      {/* Map */}
      <View style={s.mapContainer}>
        {loading ? (
          <View style={s.loadingContainer}>
            <ActivityIndicator size="large" color="#2E7D32" />
            <Text style={s.loadingTxt}>Carregando talhões...</Text>
          </View>
        ) : (
          <MapView
            ref={mapRef}
            style={s.map}
            initialRegion={initialRegion}
            onPress={handleMapPress}
            mapType="satellite"
            showsUserLocation
            showsMyLocationButton
          >
            {polygons.map(p => p.coords.length > 0 && (
              <Polygon
                key={p.id}
                coordinates={p.coords}
                fillColor={`${p.cor}40`}
                strokeColor={p.cor}
                strokeWidth={3}
                tappable
                onPress={() => handleTalhaoPress(p)}
              />
            ))}
            {drawPoints.length > 0 && (
              <>
                <Polyline coordinates={drawPoints} strokeColor="#FFD700" strokeWidth={3} />
                {drawPoints.length > 2 && (
                  <Polygon coordinates={drawPoints} fillColor="rgba(255,215,0,0.2)" strokeColor="#FFD700" strokeWidth={3} />
                )}
                {drawPoints.map((pt, idx) => (
                  <Marker key={idx} coordinate={pt} anchor={{ x: 0.5, y: 0.5 }}>
                    <View style={s.markerDot}>
                      <Text style={s.markerNum}>{idx + 1}</Text>
                    </View>
                  </Marker>
                ))}
              </>
            )}
          </MapView>
        )}

        {/* Legenda com informações do talhão selecionado */}
        {selectedTalhaoInfo && !drawMode && (
          <View style={s.infoCard}>
            <View style={s.infoHeader}>
              <View style={s.infoTitleRow}>
                <View style={[s.infoDot, { backgroundColor: selectedTalhaoInfo.cor }]} />
                <Text style={s.infoTitle} numberOfLines={1}>{selectedTalhaoInfo.nome}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedTalhao(null)} style={s.closeBtn}>
                <Text style={s.closeBtnTxt}>X</Text>
              </TouchableOpacity>
            </View>

            <View style={s.infoContent}>
              <View style={s.infoRow}>
                <View style={s.infoItemCompact}>
                  <Text style={s.infoLabel}>Area</Text>
                  <Text style={s.infoValue}>{selectedTalhaoInfo.area_ha?.toFixed(2) || '0.00'} ha</Text>
                </View>
                
                <View style={s.infoItemCompact}>
                  <Text style={s.infoLabel}>Altitude</Text>
                  <Text style={s.infoValue}>
                    {altitudeLoading ? '…' : talhaoAltitude != null ? `${talhaoAltitude} m` : '—'}
                  </Text>
                </View>
              </View>

              <View style={s.infoRow}>
                <View style={s.infoItemCompact}>
                  <Text style={s.infoLabel}>Latitude</Text>
                  <Text style={s.infoValueSmall}>{selectedTalhaoInfo.centroid.latitude.toFixed(6)}</Text>
                </View>

                <View style={s.infoItemCompact}>
                  <Text style={s.infoLabel}>Longitude</Text>
                  <Text style={s.infoValueSmall}>{selectedTalhaoInfo.centroid.longitude.toFixed(6)}</Text>
                </View>
              </View>

              <View style={s.infoRow}>
                <View style={s.infoItemCompact}>
                  <Text style={s.infoLabel}>Cultura</Text>
                  <Text style={s.infoValue} numberOfLines={1}>{selectedTalhaoInfo.cultura || 'N/D'}</Text>
                </View>

                <View style={s.infoItemCompact}>
                  <Text style={s.infoLabel}>Sistema</Text>
                  <Text style={s.infoValue} numberOfLines={1}>{selectedTalhaoInfo.sistema_plantio || 'N/D'}</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity 
              style={s.deleteFullBtn} 
              onPress={() => deletarTalhao(selectedTalhaoInfo.id, selectedTalhaoInfo.nome)}
              activeOpacity={0.8}
            >
              <Text style={s.deleteBtnTxt}>Deletar Talhao</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Lista de talhões */}
      {!loading && !drawMode && talhoes.length > 0 && !selectedTalhao && (
        <View style={s.listPanel}>
          <FlatList
            horizontal
            data={polygons}
            keyExtractor={p => p.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[s.talhaoChip, { borderColor: item.cor }]}
                onPress={() => handleTalhaoPress(item)}
                activeOpacity={0.8}
              >
                <View style={[s.talhaoChipDot, { backgroundColor: item.cor }]} />
                <Text style={s.talhaoChipTxt} numberOfLines={1}>{item.nome}</Text>
                <Text style={s.talhaoChipArea}>({item.area_ha?.toFixed(1) || 0} ha)</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Controls */}
      {!loading && (
        <>
          {drawMode ? (
            <View style={s.drawControls}>
              <View style={s.drawRow}>
                <TouchableOpacity style={s.drawCtrlBtn} onPress={undoLast} disabled={drawPoints.length === 0} activeOpacity={0.8}>
                  <Text style={[s.drawCtrlTxt, { color: '#2E7D32' }]}>← Desfazer</Text>
                </TouchableOpacity>
                <View style={s.drawAreaCenter}>
                  <Text style={s.drawAreaLabel}>ÁREA ESTIMADA</Text>
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
                <Text style={s.cancelTxt}>Cancelar Desenho</Text>
              </TouchableOpacity>
              <View style={{ height: insets.bottom || 16 }} />
            </View>
          ) : (
            <View style={[s.bottomBar, { paddingBottom: insets.bottom || 12 }]}>
              <TouchableOpacity style={s.newTalhaoBtn} onPress={() => setDrawMode(true)} activeOpacity={0.85}>
                <Text style={s.newTalhaoBtnTxt}>Desenhar Talhao</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.importKmlBtn} onPress={importarKML} activeOpacity={0.85}>
                <Text style={s.importKmlTxt}>Importar KML</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {/* Save Modal */}
      <Modal visible={saveModal} transparent animationType="slide" onRequestClose={() => setSaveModal(false)}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={s.modalTitle}>Salvar Talhao</Text>
            <Text style={s.modalSub}>Área estimada: {calcAreaHa(drawPoints).toFixed(2)} ha</Text>
            
            <Text style={s.inputLabel}>Nome do talhão *</Text>
            <TextInput 
              style={s.input} 
              value={nomeNovo} 
              onChangeText={setNomeNovo} 
              placeholder="Ex: Talhão 1, Gleba Norte..." 
              placeholderTextColor="#bbb" 
            />
            
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
            
            <Text style={s.inputLabel}>Cor do Talhão</Text>
            <View style={s.coresRow}>
              {CORES.map(c => (
                <TouchableOpacity 
                  key={c} 
                  style={[s.coreDot, { backgroundColor: c }, corNovo === c && s.coreSelected]} 
                  onPress={() => setCorNovo(c)} 
                  activeOpacity={0.7}
                />
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
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#193C19' },
  header: {
    backgroundColor: '#193C19',
    minHeight: 60,
    paddingVertical: 12, 
    paddingHorizontal: 16,
    flexDirection: 'row', 
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  backBtn: {
    paddingHorizontal: 14, 
    paddingVertical: 8, 
    borderRadius: 20, 
    marginRight: 12,
    backgroundColor: 'rgba(255,255,255,0.15)', 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.25)',
  },
  backTxt: { color: '#A5D6A7', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800', flex: 1 },
  drawInstructions: {
    position: 'absolute', 
    top: 16, 
    left: 16, 
    right: 16, 
    zIndex: 11,
    backgroundColor: 'rgba(255,235,59,0.95)', 
    borderRadius: 12, 
    paddingVertical: 12, 
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  drawInstructionsTxt: { 
    color: '#795548', 
    fontSize: 14, 
    textAlign: 'center', 
    fontWeight: '600' 
  },
  mapContainer: { flex: 1 },
  map: { width: '100%', height: '100%' },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingTxt: {
    marginTop: 12,
    fontSize: 16,
    color: '#2E7D32',
    fontWeight: '600',
  },
  markerDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFD700',
    borderWidth: 3,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  markerNum: {
    color: '#1A2E1A',
    fontSize: 14,
    fontWeight: '900',
  },
  
  // Info Card (Legenda)
  infoCard: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E8F5E9',
  },
  infoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  infoDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A2E1A',
    flex: 1,
  },
  closeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnTxt: {
    fontSize: 14,
    color: '#666',
    fontWeight: '700',
  },
  infoContent: {
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  infoItemCompact: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#2E7D32',
    textTransform: 'uppercase',
    marginBottom: 2,
    letterSpacing: 0.3,
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A2E1A',
  },
  infoValueSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1A2E1A',
  },
  deleteFullBtn: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1,
    borderColor: '#FFCDD2',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D32F2F',
  },

  listPanel: {
    backgroundColor: 'rgba(255,255,255,0.97)', 
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  talhaoChip: {
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#fff',
    borderRadius: 24, 
    paddingHorizontal: 14, 
    paddingVertical: 8, 
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  talhaoChipDot: { 
    width: 12, 
    height: 12, 
    borderRadius: 6, 
    marginRight: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  talhaoChipTxt: { 
    fontSize: 14, 
    fontWeight: '700', 
    color: '#1A2E1A', 
    maxWidth: 100 
  },
  talhaoChipArea: { 
    fontSize: 12, 
    color: '#666', 
    marginLeft: 4,
    fontWeight: '600',
  },
  drawControls: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    paddingHorizontal: 16, 
    paddingTop: 14, 
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  drawRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 12 
  },
  drawCtrlBtn: { 
    flex: 1, 
    alignItems: 'center', 
    paddingVertical: 8 
  },
  drawCtrlTxt: { 
    fontSize: 14, 
    fontWeight: '700' 
  },
  drawAreaCenter: { 
    flex: 2, 
    alignItems: 'center' 
  },
  drawAreaLabel: { 
    fontSize: 10, 
    color: '#888',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  drawAreaValue: { 
    fontSize: 24, 
    fontWeight: '900', 
    color: '#2E7D32' 
  },
  confirmBtn: {
    backgroundColor: '#2E7D32', 
    borderRadius: 14, 
    paddingVertical: 16,
    alignItems: 'center', 
    marginBottom: 8,
    shadowColor: '#2E7D32',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  confirmBtnTxt: { 
    color: '#fff', 
    fontWeight: '800', 
    fontSize: 16 
  },
  cancelBtn: { 
    width: '100%', 
    alignItems: 'center', 
    paddingVertical: 10 
  },
  cancelTxt: { 
    color: '#E53935', 
    fontWeight: '700', 
    fontSize: 14 
  },
  bottomBar: {
    backgroundColor: 'rgba(255,255,255,0.97)', 
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row', 
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  newTalhaoBtn: {
    flex: 1, 
    backgroundColor: '#2E7D32', 
    borderRadius: 14, 
    paddingVertical: 16, 
    alignItems: 'center',
    shadowColor: '#2E7D32',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  newTalhaoBtnTxt: { 
    color: '#fff', 
    fontWeight: '800', 
    fontSize: 15 
  },
  importKmlBtn: {
    flex: 1, 
    backgroundColor: '#1976D2', 
    borderRadius: 14, 
    paddingVertical: 16, 
    alignItems: 'center',
    shadowColor: '#1976D2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  importKmlTxt: { 
    color: '#fff', 
    fontWeight: '800', 
    fontSize: 15 
  },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.6)', 
    justifyContent: 'flex-end' 
  },
  modalCard: { 
    backgroundColor: '#fff', 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24, 
    padding: 24,
  },
  modalTitle: { 
    fontSize: 22, 
    fontWeight: '900', 
    color: '#1A2E1A', 
    marginBottom: 4 
  },
  modalSub: { 
    fontSize: 14, 
    color: '#666', 
    marginBottom: 24,
    fontWeight: '600',
  },
  inputLabel: { 
    fontSize: 12, 
    fontWeight: '700', 
    color: '#2E7D32', 
    marginBottom: 8, 
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 2, 
    borderColor: '#E0E0E0', 
    borderRadius: 12, 
    paddingHorizontal: 16,
    paddingVertical: 14, 
    fontSize: 16, 
    color: '#222', 
    marginBottom: 18,
    backgroundColor: '#FAFAFA',
  },
  pickChip: {
    paddingHorizontal: 16, 
    paddingVertical: 10, 
    borderRadius: 20,
    borderWidth: 2, 
    borderColor: '#E0E0E0', 
    backgroundColor: '#FAFAFA',
  },
  pickChipSel: { 
    backgroundColor: '#2E7D32', 
    borderColor: '#2E7D32' 
  },
  pickChipTxt: { 
    fontSize: 13, 
    color: '#555', 
    fontWeight: '700' 
  },
  pickChipTxtSel: { 
    color: '#fff' 
  },
  coresRow: { 
    flexDirection: 'row', 
    gap: 12, 
    marginBottom: 28, 
    marginTop: 8,
    flexWrap: 'wrap',
  },
  coreDot: { 
    width: 40, 
    height: 40, 
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#E0E0E0',
  },
  coreSelected: { 
    borderWidth: 4, 
    borderColor: '#1A2E1A', 
    shadowColor: '#000', 
    shadowOpacity: 0.3, 
    shadowRadius: 4, 
    shadowOffset: { width: 0, height: 2 }, 
    elevation: 6,
    transform: [{ scale: 1.1 }],
  },
  modalBtns: { 
    flexDirection: 'row', 
    gap: 12,
    marginTop: 8,
  },
  modalCancelBtn: { 
    flex: 1, 
    backgroundColor: '#F5F5F5', 
    borderRadius: 14, 
    paddingVertical: 16, 
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E0E0E0',
  },
  modalCancelTxt: { 
    color: '#666', 
    fontWeight: '700', 
    fontSize: 16 
  },
  modalSaveBtn: { 
    flex: 2, 
    backgroundColor: '#2E7D32', 
    borderRadius: 14, 
    paddingVertical: 16, 
    alignItems: 'center',
    shadowColor: '#2E7D32',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  modalSaveTxt: { 
    color: '#fff', 
    fontWeight: '800', 
    fontSize: 16 
  },
});