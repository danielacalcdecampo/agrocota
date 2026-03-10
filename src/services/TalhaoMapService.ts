/**
 * Serviço para mapa e dados do talhão:
 * - Imagem de satélite estática (Google Static Maps)
 * - Altitude real via Open-Elevation API
 */

import Constants from 'expo-constants';

const GOOGLE_MAPS_KEY =
  Constants.expoConfig?.android?.config?.googleMaps?.apiKey ??
  (process.env as any).EXPO_PUBLIC_GOOGLE_MAPS_KEY ??
  '';

/**
 * Extrai pontos do polígono GeoJSON do talhão
 */
function extractPolygonPoints(coordenadas: any): { lat: number; lng: number }[] {
  if (!coordenadas) return [];
  let ring: any[] = [];
  if (coordenadas?.type === 'Polygon' && Array.isArray(coordenadas.coordinates?.[0])) {
    ring = coordenadas.coordinates[0];
  } else if (Array.isArray(coordenadas)) {
    ring = coordenadas[0] ?? coordenadas;
  }
  return ring
    .map((c: any) => {
      if (Array.isArray(c)) return { lng: Number(c[0]), lat: Number(c[1]) };
      return { lng: Number(c.longitude ?? c.lng ?? 0), lat: Number(c.latitude ?? c.lat ?? 0) };
    })
    .filter((p: { lat: number; lng: number }) => !isNaN(p.lat) && !isNaN(p.lng));
}

/**
 * Calcula o centroid do polígono
 */
export function calcCentroid(points: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (points.length === 0) return { lat: 0, lng: 0 };
  const sum = points.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/**
 * Calcula o zoom apropriado para o polígono (empírico)
 */
function calcZoomForBounds(points: { lat: number; lng: number }[]): number {
  if (points.length < 2) return 15;
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const span = Math.max(latSpan, lngSpan);
  if (span > 1) return 8;
  if (span > 0.5) return 9;
  if (span > 0.2) return 10;
  if (span > 0.1) return 11;
  if (span > 0.05) return 12;
  if (span > 0.02) return 13;
  if (span > 0.01) return 14;
  return 15;
}

/**
 * Gera URL da imagem de satélite do talhão via Google Static Maps API
 * Retorna null se não houver coordenadas ou chave
 */
export function getSatelliteImageUrl(coordenadas: any, width = 600, height = 200): string | null {
  if (!GOOGLE_MAPS_KEY) return null;
  const points = extractPolygonPoints(coordenadas);
  if (points.length < 3) return null;

  const centroid = calcCentroid(points);
  const zoom = calcZoomForBounds(points);

  // path: color|weight|fillcolor|lat,lng|lat,lng|...
  const pathCoords = [...points, points[0]]
    .map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
    .join('|');
  const path = `path=color:0x16a34a80|weight:2|fillcolor:0x16a34a40|${pathCoords}`;

  const params = new URLSearchParams({
    center: `${centroid.lat},${centroid.lng}`,
    zoom: String(zoom),
    size: `${width}x${height}`,
    maptype: 'satellite',
    path,
    key: GOOGLE_MAPS_KEY,
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

/**
 * Busca altitude real via Open-Elevation API (gratuita)
 */
export async function fetchAltitude(lat: number, lng: number): Promise<number | null> {
  try {
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;
    const res = await fetch(url);
    const json = await res.json();
    const elev = json?.results?.[0]?.elevation;
    return typeof elev === 'number' ? Math.round(elev) : null;
  } catch {
    return null;
  }
}

/**
 * Formata coordenadas para exibição (centro do talhão)
 */
export function formatCoordenadas(coordenadas: any): string {
  const points = extractPolygonPoints(coordenadas);
  if (points.length === 0) return '';
  const c = calcCentroid(points);
  return `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
}

/**
 * Retorna o centroid (lat, lng) do polígono do talhão
 */
export function getCentroidFromCoordenadas(coordenadas: any): { lat: number; lng: number } | null {
  const points = extractPolygonPoints(coordenadas);
  if (points.length === 0) return null;
  return calcCentroid(points);
}
