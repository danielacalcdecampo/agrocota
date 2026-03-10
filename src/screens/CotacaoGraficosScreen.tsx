import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  StatusBar, Alert, ActivityIndicator, Share,
} from 'react-native';

import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useThemeMode } from '../context/ThemeContext';
import { RootStackParamList } from '../navigation/AppNavigator';
import * as FileSystem from 'expo-file-system/legacy';
import { exportarCotacaoPdf } from '../services/CotacaoPdfExportService';
import { getSatelliteImageUrl, fetchAltitude, formatCoordenadas, getCentroidFromCoordenadas } from '../services/TalhaoMapService';
import { Colors } from '../theme/colors';

const FORNECEDOR_HTML = 'https://agrocota64-ctrl.github.io/agrocota-web/agrocota-fornecedor.html';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItemCotacao {
  id: string;
  produto_nome: string;
  fornecedor: string | null;
  categoria: string | null;
  valor_ha: number | null;
  dose_ha: number | null;
  unidade: string | null;
  principio_ativo: string | null;
  fonte: string | null;
  estagio: string | null;
  n_aplicacoes: number | null;
  obs: string | null;
  alvo?: string | null;
  tecnologia?: string | null;
  grupo_alvo?: string | null;
  campo_adicional?: string | null;
}

interface OpcaoRevenda {
  id: string;
  revenda: string;
  valor_ha: number;
  dose_ha: number | null;
  unidade: string | null;
  estagio: string | null;
  n_aplicacoes: number | null;
  obs: string | null;
  alvo: string | null;
  tecnologia: string | null;
  grupo_alvo: string | null;
  campo_adicional: string | null;
  isAlternativa?: boolean;
  produtoAlternativo?: string;
  pctDiferencaDose?: number;
  doseAlternativa?: string;
  indisponivel?: boolean;
}

interface ProdutoAgrupado {
  produto: string;
  principio_ativo: string | null;
  fonte: string | null;
  estagio: string | null;
  alvo: string | null;
  tecnologia: string | null;
  grupo_alvo: string | null;
  campo_adicional: string | null;
  opcoes: OpcaoRevenda[];
}

interface GrupoPAFonte {
  chave: string;
  principio_ativo: string | null;
  fonte: string | null;
  produtos: ProdutoAgrupado[];
  custoGrupo: number;
}

interface CategoriaCompleta {
  categoria: string;
  color: string;
  custoCategoria: number;
  numProdutos: number;
  grupos: GrupoPAFonte[];
}

interface CotacaoComparativaResumo {
  id: string;
  titulo: string;
  totalGeral: number;
  categoriaTotais: Record<string, number>;
  produtoMenorPreco: Record<string, number>;
}

interface ProdutoComparativo {
  key: string;
  categoria: string;
  produto: string;
  principio_ativo: string | null;
  fonte: string | null;
  precos: {
    cotacaoId: string;
    titulo: string;
    valor: number;
    dose?: string;
    produtoAlternativo?: string;
    doseAlternativa?: string;
    pctDiferencaDose?: number;
  }[];
}

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CotacaoGraficos'>;
  route: RouteProp<RootStackParamList, 'CotacaoGraficos'>;
};

// ─── Tipos internos do useMemo (escopo do módulo para inferência correta) ──────

interface ProdEntry {
  opcoes: OpcaoRevenda[];
  pa: string | null;
  fonte: string | null;
  estagio: string | null;
  alvo: string | null;
  tecnologia: string | null;
  grupo_alvo: string | null;
  campo_adicional: string | null;
}
type ProdMap     = Record<string, ProdEntry>;
type SubcatEntry = Record<string, ProdMap>;
type CatEntry    = Record<string, SubcatEntry>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Cores agrícolas por categoria — igual ao theme/colors (app, PDFs, viewers)
const CAT_AGRICOLA: Record<string, string> = {
  Fungicida: '#7C3AED', Herbicida: '#EA580C', Inseticida: '#2563EB', Nematicida: '#0891B2', Defensivo: '#DC2626',
  Fertilizantes: '#16A34A', 'Nutricao / Fertilizante Foliar': '#16A34A', 'Fertilizante de Base': '#16A34A',
  Sementes: '#92400E', 'Sementes / Hibridos': '#92400E',
  Adjuvante: '#CA8A04', Biologico: '#0D9488', 'Corretivo de Solo': '#78716C',
};
const CAT_FALLBACK = ['#6366F1', '#DB2777', '#059669', '#F59E0B', '#64748B'];
const _catColorMap: Record<string, string> = {};
function getCatColor(cat: string): string {
  const c = String(cat ?? '').trim();
  if (CAT_AGRICOLA[c]) return CAT_AGRICOLA[c];
  if (!_catColorMap[c]) _catColorMap[c] = CAT_FALLBACK[Object.keys(_catColorMap).length % CAT_FALLBACK.length];
  return _catColorMap[c];
}

// Cores distintas por cotação no comparativo (não tons de verde)
const COT_COLORS = ['#DC2626','#F57C00','#1565C0','#6A1B9A','#00838F','#16a34a','#eab308','#C62828'];

function fmtBRL(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function productKey(cat: string | null, prod: string | null) {
  return `${String(cat ?? '').trim().toLowerCase()}||${String(prod ?? '').trim().toLowerCase()}`;
}
function buildSubcatKey(pa: string | null, fonte: string | null): string {
  const paStr    = (pa    ?? '').trim().toLowerCase();
  const fonteStr = (fonte ?? '').trim().toLowerCase();
  if (!paStr && !fonteStr) return '__sem_classificacao__';
  return `${paStr}|||${fonteStr}`;
}
function gerarToken() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// ─── Mini componentes ─────────────────────────────────────────────────────────

function DonutChart({ values, colors, labels, size = 200, isDark = true }: {
  values: number[]; colors: string[]; labels: string[]; size?: number; isDark?: boolean;
}) {
  const total = values.reduce((a, b) => a + b, 0);
  const cx = size / 2, cy = size / 2, R = size / 2 - 8, r = R * 0.65;
  const centerBg = isDark ? '#0C0F0D' : '#F5F7F5';

  if (total === 0) {
    return (
      <View style={{ alignItems: 'center', gap: 16 }}>
        <View style={{ width: size, height: size, borderRadius: size/2, backgroundColor: centerBg, borderWidth: 16, borderColor: isDark ? '#252E27' : '#E8EDE9', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 12, color: isDark ? '#4A6050' : '#8EA898', fontWeight: '600', textAlign: 'center', paddingHorizontal: 16 }}>Sem dados</Text>
        </View>
        <View style={{ width: '100%', gap: 8 }}>
          {labels.map((lbl, i) => (
            <View key={i} style={[dn.chip, { backgroundColor: isDark ? '#161C17' : '#F9FBF9', borderColor: isDark ? '#252E27' : '#E8EDE9' }]}>
              <View style={[dn.dot, { backgroundColor: colors[i] }]} />
              <Text style={[dn.chipLabel, { color: isDark ? '#7A9480' : '#5A7060' }]} numberOfLines={1}>{lbl}</Text>
              <Text style={[dn.chipVal, { color: colors[i] }]}>R$ 0,00</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const diff = maxVal - minVal;
  const menorIdx = values.indexOf(minVal);

  // Garante valor mínimo visual para evitar arcos degenerados (0° sweep)
  // e arcos de círculo completo (360°) que SVG não renderiza com um único comando A.
  const MIN_SWEEP_FRAC = 0.003; // 0,3% mínimo visual por fatia
  const safeValues = values.map(v => Math.max(v, total * MIN_SWEEP_FRAC));
  const safeTotal  = safeValues.reduce((a, b) => a + b, 0);

  const slices: { path: string; color: string }[] = [];
  let angle = -Math.PI / 2;

  safeValues.forEach((val, i) => {
    const sweep = (val / safeTotal) * 2 * Math.PI;

    // Arco completo (único slice ou quase): SVG não renderiza A de ponto para si mesmo.
    // Solução: dois arcos de 180° cada.
    if (sweep >= 2 * Math.PI - 0.002) {
      const mid = angle + Math.PI;
      const ax1 = cx + R * Math.cos(angle), ay1 = cy + R * Math.sin(angle);
      const ax2 = cx + R * Math.cos(mid),   ay2 = cy + R * Math.sin(mid);
      const ai1 = cx + r * Math.cos(mid),   ai2 = cy + r * Math.sin(mid);
      const ai3 = cx + r * Math.cos(angle), ai4 = cy + r * Math.sin(angle);
      slices.push({
        path: `M ${ax1} ${ay1} A ${R} ${R} 0 0 1 ${ax2} ${ay2} L ${ai1} ${ai2} A ${r} ${r} 0 0 0 ${ai3} ${ai4} Z`,
        color: colors[i],
      });
      slices.push({
        path: `M ${ax2} ${ay2} A ${R} ${R} 0 0 1 ${ax1} ${ay1} L ${ai3} ${ai4} A ${r} ${r} 0 0 0 ${ai1} ${ai2} Z`,
        color: colors[i],
      });
      angle += sweep;
      return;
    }

    const end = angle + sweep;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(end),   y2 = cy + R * Math.sin(end);
    const ix1 = cx + r * Math.cos(end),  iy1 = cy + r * Math.sin(end);
    const ix2 = cx + r * Math.cos(angle),iy2 = cy + r * Math.sin(angle);
    const lg = sweep > Math.PI ? 1 : 0;
    const path = `M ${x1} ${y1} A ${R} ${R} 0 ${lg} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${r} ${r} 0 ${lg} 0 ${ix2} ${iy2} Z`;
    if (!path.includes('NaN')) slices.push({ path, color: colors[i] });
    angle = end;
  });

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {slices.map((sl, i) => (
          <Path key={i} d={sl.path} fill={sl.color} stroke={centerBg} strokeWidth={1} />
        ))}
        <SvgText x={cx} y={cy - 6} textAnchor="middle" fontSize={8} fontWeight="600" fill={isDark ? '#4A6050' : '#8EA898'} letterSpacing={0.5}>ECONOMIA</SvgText>
        <SvgText x={cx} y={cy + 8} textAnchor="middle" fontSize={diff > 0 ? 11 : 13} fontWeight="700" fill={Colors.success}>
          {diff > 0 ? `R$ ${fmtBRL(diff)}` : '—'}
        </SvgText>
      </Svg>

      <View style={[dn.legend, { marginTop: 20 }]}>
        {labels.map((lbl, i) => {
          const isMenor = i === menorIdx;
          return (
            <View key={i} style={[dn.chip, isMenor && dn.chipMenor, { backgroundColor: isDark ? '#161C17' : '#F9FBF9', borderColor: isMenor ? Colors.success + '66' : (isDark ? '#252E27' : '#E8EDE9') }]}>
              <View style={[dn.dot, { backgroundColor: colors[i] }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[dn.chipLabel, { color: isDark ? '#ECF2EE' : '#0D1F13' }]} numberOfLines={1}>{lbl}</Text>
                <Text style={[dn.chipVal, { color: colors[i] }]}>R$ {fmtBRL(values[i])}</Text>
              </View>
              {isMenor && <Text style={dn.menorTag}>MELHOR</Text>}
            </View>
          );
        })}
      </View>

      {diff > 0 && (
        <View style={[dn.diffRow, { backgroundColor: Colors.successBg, borderColor: Colors.success + '33' }]}>
          <View>
            <Text style={[dn.diffLabel, { color: Colors.success }]}>Economia potencial</Text>
            <Text style={[dn.diffSub, { color: isDark ? '#4A6050' : '#8EA898' }]}>Entre maior e menor cotação</Text>
          </View>
          <Text style={[dn.diffVal, { color: Colors.success }]}>R$ {fmtBRL(diff)}</Text>
        </View>
      )}
    </View>
  );
}
const dn = StyleSheet.create({
  legend: { width: '100%', gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1 },
  chipMenor: {},
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  chipVal: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  menorTag: { fontSize: 10, fontWeight: '800', color: '#fff', backgroundColor: Colors.success, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  diffRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginTop: 16, width: '100%', borderWidth: 1 },
  diffLabel: { fontSize: 13, fontWeight: '600' },
  diffSub: { fontSize: 11, marginTop: 2 },
  diffVal: { fontSize: 17, fontWeight: '800' },
});

function CompBar({ label, value, maxValue, minValue, color, isMenorOverride }: {
  label: string; value: number; maxValue: number; minValue: number; color: string; isMenorOverride?: boolean;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  const isMenor = isMenorOverride !== undefined ? isMenorOverride : (value === minValue && minValue > 0);
  return (
    <View style={[cb.row, isMenor && cb.rowMenor]}>
      <View style={cb.leftCol}>
        <Text style={[cb.label, isMenor && { color: Colors.success }]} numberOfLines={1}>{label}</Text>
        {isMenor && <Text style={cb.menorBadge}>menor preço</Text>}
      </View>
      <View style={cb.track}>
        <View style={[cb.fill, { width: `${Math.max(pct, 3)}%`, backgroundColor: isMenor ? Colors.success : color }]} />
      </View>
      <Text style={[cb.val, { color: isMenor ? Colors.success : color }]}>R$ {fmtBRL(value)}</Text>
    </View>
  );
}
const cb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10, paddingVertical: 4 },
  rowMenor: { backgroundColor: Colors.successBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  leftCol: { width: 100 },
  label: { fontSize: 12, fontWeight: '600', color: '#7A9480' },
  menorBadge: { fontSize: 9, fontWeight: '700', color: Colors.success, marginTop: 2 },
  track: { flex: 1, height: 8, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 8, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 8 },
  val: { width: 82, fontSize: 12, fontWeight: '700', textAlign: 'right' },
});

// Barra de preço por revenda (com suporte a alternativa)
function RevendaBar({ revenda, value, max, color, isAlternativa, produtoAlternativo, pctDiferencaDose }: {
  revenda: string; value: number; max: number; color: string;
  isAlternativa?: boolean; produtoAlternativo?: string; pctDiferencaDose?: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 100;
  return (
    <View style={rb.row}>
      <View style={{ flex: 0, width: 110 }}>
        <Text style={rb.revenda} numberOfLines={1}>{revenda || 'Sem revenda'}</Text>
        {isAlternativa && produtoAlternativo && (
          <View style={[rb.altBadge, { borderColor: color + '66', backgroundColor: color + '14' }]}>
            <Text style={[rb.altLabel, { color }]}>Alternativa: {produtoAlternativo}</Text>
            {pctDiferencaDose !== undefined && pctDiferencaDose !== 0 && (
              <Text style={[rb.altPct, { color: pctDiferencaDose > 0 ? '#E07B00' : '#1A7A3A' }]}>
                {pctDiferencaDose > 0 ? '+' : ''}{pctDiferencaDose}% dose
              </Text>
            )}
          </View>
        )}
      </View>
      <View style={rb.trackWrap}>
        <View style={[rb.track, { backgroundColor: color + '22' }]}>
          <View style={[rb.fill, { width: `${Math.max(pct, 3)}%`, backgroundColor: color }]} />
        </View>
      </View>
      <Text style={[rb.val, { color }]}>R$ {fmtBRL(value)}</Text>
    </View>
  );
}
const rb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  revenda: { fontSize: 12, fontWeight: '600', color: '#7A9480' },
  altBadge: { marginTop: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1 },
  altLabel: { fontSize: 11, fontWeight: '600' },
  altPct: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  trackWrap: { flex: 1 },
  track: { height: 6, borderRadius: 6, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 6 },
  val: { width: 78, fontSize: 12, fontWeight: '700', textAlign: 'right' },
});

// Chip de informação do produto
function InfoChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[ic.chip, { borderColor: color + '44', backgroundColor: color + '14' }]}>
      <Text style={[ic.label, { color: color + 'AA' }]}>{label}</Text>
      <Text style={[ic.value, { color }]}>{value}</Text>
    </View>
  );
}
const ic = StyleSheet.create({
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, marginRight: 8, marginBottom: 6 },
  label: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  value: { fontSize: 12, fontWeight: '600' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CotacaoGraficosScreen({ navigation, route }: Props) {
  const { cotacaoId, shareToken, compareCotacaoIds } = route.params;
  const { isDark } = useThemeMode();
  const insets = useSafeAreaInsets();

  const [itens, setItens]                             = useState<ItemCotacao[]>([]);
  const [comparativoCotacoes, setComparativoCotacoes] = useState<CotacaoComparativaResumo[]>([]);
  const [comparativoProdutos, setComparativoProdutos] = useState<ProdutoComparativo[]>([]);
  const [loading, setLoading]                         = useState(true);
  const [titulo, setTitulo]                           = useState('');

  // Só categorias expandem
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const [showAllCats, setShowAllCats]   = useState(false);

  const [fazendaNome, setFazendaNome]               = useState('');
  const [produtorNome, setProdutorNome]             = useState('');
  const [fazendaLocalizacao, setFazendaLocalizacao] = useState('');
  const [consultorEmpresa, setConsultorEmpresa]     = useState<any>({});
  const [excelItensJson, setExcelItensJson]         = useState<any[]>([]);
  const [talhaoNome, setTalhaoNome]                 = useState('');
  const [talhaoAreaHa, setTalhaoAreaHa]             = useState(0);
  const [talhaoCoordenadas, setTalhaoCoordenadas]   = useState<any>(null);

  const [propostaAceitaEmpresa, setPropostaAceitaEmpresa] = useState<string | null>(null);
  const [propostaAceitaItens, setPropostaAceitaItens]   = useState<{ empresa_nome: string; itens_json: any[] } | null>(null);
  const [totalPropostas, setTotalPropostas]               = useState(0);
  const [gerandoLink, setGerandoLink]                     = useState(false);
  const [linkRevenda, setLinkRevenda]                     = useState<string | null>(null);

  const shareUrl      = shareToken ? `https://agrocota64-ctrl.github.io/aceite-agrocota/?t=${shareToken}` : '';
  const isComparativo = (compareCotacaoIds?.length ?? 0) > 1;

  // Design tokens alinhados com CotacoesListScreen (verde Agrocota)
  const c = {
    bg:          isDark ? '#0C0F0D' : '#F5F7F5',
    headerBg:    isDark ? '#0F1610' : '#0F3D1F',
    surface:     isDark ? '#161C17' : '#FFFFFF',
    surfaceAlt:  isDark ? '#1C241E' : '#F9FBF9',
    border:      isDark ? '#252E27' : '#E8EDE9',
    borderLight: isDark ? '#2E3A30' : '#E0E8E2',
    title:       isDark ? '#ECF2EE' : '#0D1F13',
    body:        isDark ? '#7A9480' : '#5A7060',
    muted:       isDark ? '#4A6050' : '#8EA898',
    accent:      '#1A6B30',
    accentLight: isDark ? '#1E3A24' : '#EAF4ED',
    track:       isDark ? '#252E27' : '#E0E8E2',
    paText:      Colors.success,
    success:     Colors.success,
    successBg:   Colors.successBg,
  };

  // ── Data fetching ──────────────────────────────────────────────────────────

  const carregarPropostas = useCallback(async () => {
    if (!cotacaoId || isComparativo) return;
    const [{ count }, cotData] = await Promise.all([
      supabase.from('propostas_fornecedor').select('*', { count: 'exact', head: true }).eq('cotacao_id', cotacaoId),
      supabase.from('cotacoes').select('proposta_aceita_id').eq('id', cotacaoId).single(),
    ]);
    setTotalPropostas(count ?? 0);
    const aceitaId = cotData.data?.proposta_aceita_id ?? null;
    if (aceitaId) {
      const { data: p } = await supabase
        .from('propostas_fornecedor').select('empresa_nome')
        .eq('id', aceitaId).single();
      setPropostaAceitaEmpresa(p?.empresa_nome ?? null);
    } else {
      // Limpa estado quando o aceite foi desfeito
      setPropostaAceitaEmpresa(null);
    }
  }, [cotacaoId, isComparativo]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const ids = Array.from(new Set(
        (compareCotacaoIds?.length ? compareCotacaoIds : [cotacaoId]).filter(Boolean)
      ));

      const [cotRes, itensRes] = await Promise.all([
        supabase.from('cotacoes').select('*').eq('id', cotacaoId).single(),
        // Busca apenas colunas que existem no schema base.
        // Colunas extras (alvo, tecnologia, grupo_alvo, campo_adicional) são buscadas
        // separadamente para não quebrar se não existirem no banco.
        supabase.from('itens_cotacao')
          .select('id, produto_nome, fornecedor, categoria, valor_ha, dose_ha, unidade, principio_ativo, fonte, estagio, n_aplicacoes, obs')
          .eq('cotacao_id', cotacaoId)
          .order('categoria')
          .order('principio_ativo')
          .order('produto_nome'),
      ]);

      // Tenta buscar colunas extras separadamente (podem não existir no schema)
      let extrasMap: Record<string, { alvo: string | null; tecnologia: string | null; grupo_alvo: string | null; campo_adicional: string | null }> = {};
      try {
        const { data: extrasData } = await supabase
          .from('itens_cotacao')
          .select('id, alvo, tecnologia, grupo_alvo, campo_adicional')
          .eq('cotacao_id', cotacaoId);
        (extrasData ?? []).forEach((row: any) => {
          extrasMap[row.id] = {
            alvo:            row.alvo ?? null,
            tecnologia:      row.tecnologia ?? null,
            grupo_alvo:      row.grupo_alvo ?? null,
            campo_adicional: row.campo_adicional ?? null,
          };
        });
      } catch {
        // colunas extras não existem no schema — ignora silenciosamente
      }

      if (cotRes.data) {
        setTitulo(cotRes.data.titulo);
        const propostaAceitaId = (cotRes.data as any)?.proposta_aceita_id;
        if (propostaAceitaId) {
          const { data: propostaAceita } = await supabase
            .from('propostas_fornecedor')
            .select('empresa_nome, itens_json')
            .eq('id', propostaAceitaId)
            .single();
          if (propostaAceita) {
            setPropostaAceitaItens({
              empresa_nome: propostaAceita.empresa_nome ?? '',
              itens_json: Array.isArray(propostaAceita.itens_json) ? propostaAceita.itens_json : [],
            });
          } else {
            setPropostaAceitaItens(null);
          }
        } else {
          setPropostaAceitaItens(null);
        }
        const [fazRes, profileRes, talhaoRes] = await Promise.all([
          cotRes.data.fazenda_id
            ? supabase.from('fazendas').select('nome,produtor_nome,municipio,estado').eq('id', cotRes.data.fazenda_id).single()
            : Promise.resolve({ data: null } as any),
          cotRes.data.consultor_id
            ? supabase.from('profiles').select('full_name,company_name,cnpj,phone,company_logo_url').eq('id', cotRes.data.consultor_id).single()
            : Promise.resolve({ data: null } as any),
          (cotRes.data as any).talhao_id
            ? supabase.from('talhoes').select('nome,area_ha,coordenadas').eq('id', (cotRes.data as any).talhao_id).single()
            : Promise.resolve({ data: null } as any),
        ]);
        setFazendaNome(fazRes?.data?.nome ?? '');
        setProdutorNome(fazRes?.data?.produtor_nome ?? '');
        setFazendaLocalizacao([fazRes?.data?.municipio, fazRes?.data?.estado].filter(Boolean).join(' - '));
        setConsultorEmpresa({
          companyName:   profileRes?.data?.company_name,
          consultorNome: profileRes?.data?.full_name,
          cnpj:          profileRes?.data?.cnpj,
          phone:         profileRes?.data?.phone,
          logoUrl:       profileRes?.data?.company_logo_url,
        });
        setTalhaoNome(talhaoRes?.data?.nome ?? '');
        setTalhaoCoordenadas(talhaoRes?.data?.coordenadas ?? null);
        const am = Number((cotRes.data as any)?.area_ha);
        const at = Number(talhaoRes?.data?.area_ha);
        setTalhaoAreaHa(am > 0 ? am : at > 0 ? at : 0);
        setExcelItensJson(
          Array.isArray((cotRes.data as any)?.excel_itens_json)
            ? (cotRes.data as any).excel_itens_json : []
        );
      }

      if (itensRes.data) {
        // Mescla colunas extras (se existirem) nos itens base
        const enriched = itensRes.data.map((it: any) => ({
          ...it,
          alvo:            extrasMap[it.id]?.alvo ?? null,
          tecnologia:      extrasMap[it.id]?.tecnologia ?? null,
          grupo_alvo:      extrasMap[it.id]?.grupo_alvo ?? null,
          campo_adicional: extrasMap[it.id]?.campo_adicional ?? null,
        }));
        setItens(enriched as ItemCotacao[]);
      }

      if (ids.length > 1) {
        const [cotacoesRes, itensCompareRes] = await Promise.all([
          supabase.from('cotacoes').select('id, titulo, area_ha, proposta_aceita_id').in('id', ids),
          supabase.from('itens_cotacao')
            .select('id, cotacao_id, categoria, produto_nome, valor_ha, dose_ha, unidade, principio_ativo, fonte')
            .in('cotacao_id', ids),
        ]);
        const titleById = new Map<string, string>();
        const areaById  = new Map<string, number>();
        const propostaAceitaIdByCotacao = new Map<string, string>();
        (cotacoesRes.data ?? []).forEach((r: any) => {
          titleById.set(r.id, r.titulo ?? 'Cotação');
          const a = Number(r.area_ha ?? 0);
          areaById.set(r.id, a > 0 ? a : 1);
          if (r.proposta_aceita_id) propostaAceitaIdByCotacao.set(r.id, r.proposta_aceita_id);
        });

        // Busca propostas aceitas para cotações que as possuem
        const propostaMap = new Map<string, { empresa_nome: string; itens_json: any[] }>();
        if (propostaAceitaIdByCotacao.size > 0) {
          const pIds = Array.from(propostaAceitaIdByCotacao.values());
          const { data: props } = await supabase
            .from('propostas_fornecedor')
            .select('id, empresa_nome, itens_json')
            .in('id', pIds);
          const cotByPropId = new Map<string, string>();
          propostaAceitaIdByCotacao.forEach((pId, cotId) => cotByPropId.set(pId, cotId));
          (props ?? []).forEach((prop: any) => {
            const cotId = cotByPropId.get(prop.id);
            if (cotId) propostaMap.set(cotId, {
              empresa_nome: prop.empresa_nome ?? '',
              itens_json: Array.isArray(prop.itens_json) ? prop.itens_json : [],
            });
          });
        }

        // doseMap[cotacaoId][productKey] = { dose, produtoAlternativo, doseAlternativa, pctDiferencaDose }
        const doseMap: Record<string, Record<string, {
          dose?: string; produtoAlternativo?: string; doseAlternativa?: string; pctDiferencaDose?: number;
        }>> = {};
        (itensCompareRes.data ?? []).forEach((r: any) => {
          if (!doseMap[r.cotacao_id]) doseMap[r.cotacao_id] = {};
          const k = productKey(r.categoria, (r.produto_nome ?? '').trim());
          const doseStr = r.dose_ha != null && Number(r.dose_ha) > 0
            ? `${fmtBRL(Number(r.dose_ha))} ${r.unidade ?? ''}`.trim()
            : undefined;
          doseMap[r.cotacao_id][k] = { dose: doseStr };
        });
        // Override com alternativas das propostas aceitas
        propostaMap.forEach((proposta, cotId) => {
          if (!doseMap[cotId]) doseMap[cotId] = {};
          proposta.itens_json.forEach((item: any) => {
            if (item.disponivel === false && item.alternativa) {
              let alt = item.alternativa;
              if (typeof alt === 'string') { try { alt = JSON.parse(alt); } catch { return; } }
              const nomeLimpo = (item.produto ?? '').trim();
              const cat = String((item as any).cat || (item as any).categoria || 'Insumo');
              const k = productKey(cat, nomeLimpo);
              const origStr = String(item.dose_orig || item.dose || '').trim();
              const altDoseStr = String(alt?.dose ?? '').trim();
              const altUnidade = String(alt?.unidade || 'L/ha').trim();
              const origNum = parseFloat(origStr.replace(',', '.')) || 0;
              const altNum  = parseFloat(altDoseStr.replace(',', '.')) || 0;
              const pct = origNum > 0 ? Math.round(((altNum - origNum) / origNum) * 100) : 0;
              doseMap[cotId][k] = {
                dose: origStr || doseMap[cotId][k]?.dose,
                produtoAlternativo: String(alt?.nome ?? '').trim() || undefined,
                doseAlternativa: altDoseStr ? `${altDoseStr} ${altUnidade}`.trim() : undefined,
                pctDiferencaDose: pct || undefined,
              };
            }
          });
        });
        const byCotacao = new Map<string, any[]>();
        (itensCompareRes.data ?? []).forEach((r: any) => {
          if (!byCotacao.has(r.cotacao_id)) byCotacao.set(r.cotacao_id, []);
          byCotacao.get(r.cotacao_id)!.push(r);
        });
        const resumo: CotacaoComparativaResumo[] = ids.map(id => {
          const linhas = byCotacao.get(id) ?? [];
          const fator  = areaById.get(id) ?? 1;
          const categoriaTotais: Record<string, number>  = {};
          const produtoMenorPreco: Record<string, number> = {};
          linhas.forEach((r: any) => {
            const cat = String(r.categoria ?? 'Insumo');
            const val = Number(r.valor_ha ?? 0) * fator;
            categoriaTotais[cat] = (categoriaTotais[cat] ?? 0) + val;
            // Normaliza produto_nome (trim) para bater com origMap
            const nomeLimpo = (r.produto_nome ?? '').trim();
            const k = productKey(r.categoria, nomeLimpo);
            if (!produtoMenorPreco[k] || val < produtoMenorPreco[k]) produtoMenorPreco[k] = val;
          });
          return {
            id, titulo: titleById.get(id) ?? 'Cotação',
            totalGeral: Object.values(categoriaTotais).reduce((s, v) => s + v, 0),
            categoriaTotais, produtoMenorPreco,
          };
        });
        // origMap: chave = productKey(categoria, produto_nome)
        // Valor: categoria, produto, principio_ativo, fonte
        // Estratégia: percorre TODAS as fontes de dados para preencher PA e Fonte,
        // priorizando o valor preenchido sobre null (independente da ordem de chegada)
        const origMap: Record<string, { categoria: string; produto: string; principio_ativo: string | null; fonte: string | null }> = {};

        const mergeIntoOrigMap = (rows: any[]) => {
          rows.forEach((r: any) => {
            // Normaliza para evitar mismatch por espaços ou capitalização
            const nomeLimpo = (r.produto_nome ?? '').trim();
            const catLimpa  = (r.categoria ?? '');
            if (!nomeLimpo) return;
            const k = productKey(catLimpa, nomeLimpo);
            if (!origMap[k]) {
              origMap[k] = {
                categoria:       catLimpa || 'Insumo',
                produto:         nomeLimpo,
                principio_ativo: r.principio_ativo ? String(r.principio_ativo).trim() : null,
                fonte:           r.fonte           ? String(r.fonte).trim()           : null,
              };
            } else {
              // Sempre sobrescreve com valor preenchido (nunca regride de preenchido para null)
              if (r.principio_ativo && String(r.principio_ativo).trim()) {
                origMap[k].principio_ativo = String(r.principio_ativo).trim();
              }
              if (r.fonte && String(r.fonte).trim()) {
                origMap[k].fonte = String(r.fonte).trim();
              }
            }
          });
        };

        // 1ª passagem: dados do comparativo (todas as cotações)
        mergeIntoOrigMap(itensCompareRes.data ?? []);
        // 2ª passagem: dados individuais (cotação principal — pode ter PA/Fonte mais completo)
        if (itensRes.data) mergeIntoOrigMap(itensRes.data);
        // Inclui TODOS os produtos de TODAS as cotações (não só os que aparecem em todas)
        const allKeys = Object.keys(resumo.reduce<Record<string, true>>((acc, r) => {
          Object.keys(r.produtoMenorPreco).forEach(k => { acc[k] = true; });
          return acc;
        }, {}));
        const prodRows: ProdutoComparativo[] = allKeys.map(k => {
          const orig = origMap[k];
          return {
            key: k,
            categoria:       orig?.categoria ?? 'Insumo',
            produto:         orig?.produto ?? '',
            principio_ativo: orig?.principio_ativo ?? null,
            fonte:           orig?.fonte ?? null,
            precos: resumo
              .filter(r => (r.produtoMenorPreco[k] ?? 0) > 0)
              .map(r => {
                const di = doseMap[r.id]?.[k];
                return {
                  cotacaoId: r.id, titulo: r.titulo, valor: r.produtoMenorPreco[k] ?? 0,
                  dose: di?.dose,
                  produtoAlternativo: di?.produtoAlternativo,
                  doseAlternativa: di?.doseAlternativa,
                  pctDiferencaDose: di?.pctDiferencaDose,
                };
              })
              .sort((a, b) => a.valor - b.valor),
          };
        }).filter(p => p.precos.length > 0);
        // Ordena: por categoria, depois por maior diferença (mais relevante primeiro)
        prodRows.sort((a, b) => {
          const catCmp = a.categoria.localeCompare(b.categoria);
          if (catCmp !== 0) return catCmp;
          const diffA = (a.precos.at(-1)?.valor ?? 0) - (a.precos[0]?.valor ?? 0);
          const diffB = (b.precos.at(-1)?.valor ?? 0) - (b.precos[0]?.valor ?? 0);
          return diffB - diffA;
        });
        setComparativoCotacoes(resumo.sort((a, b) => a.totalGeral - b.totalGeral));
        setComparativoProdutos(prodRows); // sem limite — exibe todos os produtos
      } else {
        setComparativoCotacoes([]);
        setComparativoProdutos([]);
      }
    } finally { setLoading(false); }
  }, [compareCotacaoIds, cotacaoId]);

  // Recarrega ao focar na tela (ex: ao voltar de PropostasFornecedor)
  useFocusEffect(
    useCallback(() => {
      fetchData();
      carregarPropostas();
    }, [fetchData, carregarPropostas]),
  );

  // Realtime: atualiza automaticamente quando cotacao ou propostas mudam
  useEffect(() => {
    if (!cotacaoId || isComparativo) return;

    const channel = supabase
      .channel(`cotacao-realtime-${cotacaoId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cotacoes', filter: `id=eq.${cotacaoId}` },
        () => { fetchData(); carregarPropostas(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'propostas_fornecedor', filter: `cotacao_id=eq.${cotacaoId}` },
        () => { carregarPropostas(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itens_cotacao', filter: `cotacao_id=eq.${cotacaoId}` },
        () => { fetchData(); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [cotacaoId, isComparativo, fetchData, carregarPropostas]);

  // ── Agrupamento ────────────────────────────────────────────────────────────
  //
  //  Categoria  (expansível)
  //  └─ Grupo P.A.+Fonte  (cabeçalho visual simples)
  //      └─ Produto  (chips de info + barras de revenda sempre visíveis)

  const categorias: CategoriaCompleta[] = React.useMemo(() => {
    const fator = !isComparativo && talhaoAreaHa > 0 ? talhaoAreaHa : 1;
    const catMap: CatEntry = {};

    // Map de alternativas da proposta aceita (item_id -> { empresa_nome, alt, pctDose })
    const alternativasByItemId: Record<string, { empresa_nome: string; alt: { nome: string; dose?: string; valor_ha: number }; pctDose: number }> = {};
    if (propostaAceitaItens) {
      propostaAceitaItens.itens_json.forEach((item: any) => {
        if (item.disponivel === false && item.alternativa) {
          let alt = item.alternativa;
          if (typeof alt === 'string') {
            try { alt = JSON.parse(alt); } catch { return; }
          }
          const nome = String(alt?.nome ?? '').trim();
          const valorHa = parseFloat(alt?.valor_ha ?? alt?.valor_ha_alt ?? 0) || 0;
          if (!nome && valorHa <= 0) return;
          const origStr = String(item.dose_orig || item.dose || '');
          const origDose = parseFloat(origStr.replace(',', '.').split(/[\s/]/)[0]) || 0;
          const altDose = parseFloat(String(alt?.dose ?? '0').replace(',', '.')) || 0;
          const pctDose = origDose > 0 ? Math.round(((altDose - origDose) / origDose) * 100) : 0;
          alternativasByItemId[item.id] = {
            empresa_nome: propostaAceitaItens.empresa_nome,
            alt: { nome: nome || 'Produto alternativo', dose: alt?.dose, valor_ha: valorHa },
            pctDose,
          };
        }
      });
    }

    itens.forEach(it => {
      if (!it.produto_nome) return;
      const cat  = it.categoria ?? 'Insumo';
      const sk   = buildSubcatKey(it.principio_ativo, it.fonte);
      const prod = it.produto_nome;

      if (!catMap[cat])       catMap[cat] = {} as SubcatEntry;
      if (!catMap[cat][sk])   catMap[cat][sk] = {} as ProdMap;
      if (!catMap[cat][sk][prod]) {
        catMap[cat][sk][prod] = {
          opcoes:          [],
          pa:              it.principio_ativo ?? null,
          fonte:           it.fonte ?? null,
          estagio:         it.estagio ?? null,
          alvo:            it.alvo ?? null,
          tecnologia:      it.tecnologia ?? null,
          grupo_alvo:      it.grupo_alvo ?? null,
          campo_adicional: it.campo_adicional ?? null,
        };
      }
      const altInfo = alternativasByItemId[it.id];
      const temAlternativa = !!altInfo && (altInfo.alt.valor_ha || 0) > 0;
      const temOriginal = (it.valor_ha ?? 0) > 0 || (it.fornecedor ?? '').trim() !== '';

      if (temAlternativa) {
        // Proposta aceita disse "não disponível" + alternativa: linha "Não disponível" + linha "Alternativa"
        catMap[cat][sk][prod].opcoes.push({
          id:              it.id,
          revenda:         altInfo!.empresa_nome,
          valor_ha:        0,
          dose_ha:         it.dose_ha ?? null,
          unidade:         it.unidade ?? null,
          estagio:         it.estagio ?? null,
          n_aplicacoes:    it.n_aplicacoes ?? null,
          obs:             it.obs ?? null,
          alvo:            it.alvo ?? null,
          tecnologia:      it.tecnologia ?? null,
          grupo_alvo:      it.grupo_alvo ?? null,
          campo_adicional: it.campo_adicional ?? null,
          indisponivel:    true,
        });
        catMap[cat][sk][prod].opcoes.push({
          id:              it.id + '_alt',
          revenda:         altInfo!.empresa_nome,
          valor_ha:        altInfo!.alt.valor_ha * fator,
          dose_ha:         null,
          unidade:         null,
          estagio:         null,
          n_aplicacoes:    null,
          obs:             null,
          alvo:            null,
          tecnologia:      null,
          grupo_alvo:      null,
          campo_adicional: null,
          isAlternativa:   true,
          produtoAlternativo: altInfo!.alt.nome,
          pctDiferencaDose:   altInfo!.pctDose,
          doseAlternativa:   altInfo!.alt.dose,
        });
      } else if (temOriginal) {
        catMap[cat][sk][prod].opcoes.push({
          id:              it.id,
          revenda:         it.fornecedor || '',
          valor_ha:        (it.valor_ha ?? 0) * fator,
          dose_ha:         it.dose_ha ?? null,
          unidade:         it.unidade ?? null,
          estagio:         it.estagio ?? null,
          n_aplicacoes:    it.n_aplicacoes ?? null,
          obs:             it.obs ?? null,
          alvo:            it.alvo ?? null,
          tecnologia:      it.tecnologia ?? null,
          grupo_alvo:      it.grupo_alvo ?? null,
          campo_adicional: it.campo_adicional ?? null,
        });
      }
    });

    return Object.entries(catMap).map(([categoria, subcatMap]) => {
      const grupos: GrupoPAFonte[] = Object.entries(subcatMap).map(([sk, prodMap]: [string, ProdMap]) => {
        const firstEntry: ProdEntry | undefined = Object.values(prodMap)[0];

        const produtos: ProdutoAgrupado[] = Object.entries(prodMap)
          .map(([produto, entry]: [string, ProdEntry]) => ({
            produto,
            principio_ativo: entry.pa,
            fonte:           entry.fonte,
            estagio:         entry.estagio,
            alvo:            entry.alvo,
            tecnologia:      entry.tecnologia,
            grupo_alvo:      entry.grupo_alvo,
            campo_adicional: entry.campo_adicional,
            opcoes:          entry.opcoes.sort((a, b) => a.valor_ha - b.valor_ha),
          }))
          .sort((a, b) => a.produto.localeCompare(b.produto));

        const custoGrupo = produtos.reduce((s, p) => {
          const opValida = p.opcoes.find(o => !o.indisponivel && (o.valor_ha || 0) > 0);
          return s + (opValida?.valor_ha ?? p.opcoes[0]?.valor_ha ?? 0);
        }, 0);

        return {
          chave:           sk,
          principio_ativo: firstEntry?.pa ?? null,
          fonte:           firstEntry?.fonte ?? null,
          produtos,
          custoGrupo,
        };
      }).sort((a, b) => b.custoGrupo - a.custoGrupo);

      const custoCategoria = grupos.reduce((s, g) => s + g.custoGrupo, 0);
      const numProdutos    = grupos.reduce((s, g) => s + g.produtos.length, 0);

      return {
        categoria,
        color:         getCatColor(categoria),
        custoCategoria,
        numProdutos,
        grupos,
      };
    }).sort((a, b) => b.custoCategoria - a.custoCategoria);
  }, [talhaoAreaHa, isComparativo, itens, propostaAceitaItens]);

  const totalGeral        = categorias.reduce((s, cat) => s + cat.custoCategoria, 0);
  const maxCategoria      = Math.max(...categorias.map(cat => cat.custoCategoria), 1);
  const visibleCats       = showAllCats ? categorias : categorias.slice(0, 8);
  const cotacoesOrdenadas = [...comparativoCotacoes].sort((a, b) => a.totalGeral - b.totalGeral);
  const fatorArea         = !isComparativo && talhaoAreaHa > 0 ? talhaoAreaHa : 1;

  const toggleCat = (cat: string) => setExpandedCats(p => ({ ...p, [cat]: !p[cat] }));

  // ── Ações ──────────────────────────────────────────────────────────────────

  const handleShare = async () => {
    try {
      if (isComparativo) {
        // Ordem canônica das cotações (por totalGeral crescente, igual à tela)
        const cotOrdenadas = [...comparativoCotacoes].sort((a, b) => a.totalGeral - b.totalGeral);
        const cotacoesPayload = cotOrdenadas.map(r => ({ titulo: r.titulo, total: r.totalGeral }));
        const produtosPayload = comparativoProdutos.map(p => {
          const precosPorId = new Map(p.precos.map(pr => [pr.cotacaoId, pr]));
          return {
            nome:            p.produto,
            categoria:       p.categoria,
            principio_ativo: p.principio_ativo || null,
            fonte:           p.fonte           || null,
            precos: cotOrdenadas.map(r => {
              const pr = precosPorId.get(r.id);
              if (!pr) return null;
              return {
                valor: pr.valor,
                dose: pr.dose ?? null,
                produtoAlternativo: pr.produtoAlternativo ?? null,
                doseAlternativa: pr.doseAlternativa ?? null,
                pctDiferencaDose: pr.pctDiferencaDose ?? null,
              };
            }),
          };
        });
        const data = { cotacoes: cotacoesPayload, produtos: produtosPayload };
        const url = `https://agrocota64-ctrl.github.io/aceite-agrocota/comparativo-viewer.html?id=${cotacaoId}&data=${btoa(unescape(encodeURIComponent(JSON.stringify(data))))}`;
        await Share.share({ message: url, title: `Comparativo — ${titulo}` });
        return;
      }
      if (!shareUrl) { Alert.alert('Sem link', 'Esta cotação não possui token.'); return; }
      await Share.share({ message: shareUrl, url: shareUrl, title: titulo });
    } catch { Alert.alert('Erro', 'Não foi possível compartilhar.'); }
  };

  const handleExportPdf = async () => {
    // Carrega dados extras do talhão para o PDF (satélite em base64, altitude, coordenadas formatadas)
    let talhaoImagemBase64: string | undefined;
    let talhaoAltitude: number | null = null;
    let talhaoCoordenadasFormatadas = '';
    if (talhaoCoordenadas && (talhaoNome || talhaoAreaHa > 0)) {
      const talhaoImagemUrl = getSatelliteImageUrl(talhaoCoordenadas, 600, 200);
      talhaoCoordenadasFormatadas = formatCoordenadas(talhaoCoordenadas);
      try {
        const centroid = getCentroidFromCoordenadas(talhaoCoordenadas);
        if (centroid) talhaoAltitude = await fetchAltitude(centroid.lat, centroid.lng);
      } catch { /* ignora erro de altitude */ }
      // Converte imagem de satélite para base64 (necessário para expo-print carregar no PDF)
      if (talhaoImagemUrl) {
        try {
          const tmpPath = `${FileSystem.cacheDirectory}talhao_map_${Date.now()}.png`;
          await FileSystem.downloadAsync(talhaoImagemUrl, tmpPath);
          talhaoImagemBase64 = await FileSystem.readAsStringAsync(tmpPath, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await FileSystem.deleteAsync(tmpPath, { idempotent: true });
        } catch { /* fallback para SVG se falhar */ }
      }
    }
    await exportarCotacaoPdf({
      titulo: titulo || 'Relatório',
      totalGeralMin: totalGeral, totalGeralMax: totalGeral, economiaPotencial: 0,
      fazendaNome, produtorNome, fazendaLocalizacao, consultorEmpresa,
      categorias: categorias.map(cat => ({
        categoria: cat.categoria, color: cat.color,
        somaMin: cat.custoCategoria, somaMax: cat.custoCategoria,
        produtos: cat.grupos.flatMap(g =>
          g.produtos.map(p => ({
            produto: p.produto, principio_ativo: p.principio_ativo, fonte: p.fonte,
            opcoes: p.opcoes.map(op => ({
              fornecedor: op.revenda, valorHa: op.valor_ha, doseHa: op.dose_ha, unidade: op.unidade,
              indisponivel: op.indisponivel,
              isAlternativa: op.isAlternativa,
              produtoAlternativo: op.produtoAlternativo,
              doseAlternativa: op.doseAlternativa,
              pctDiferencaDose: op.pctDiferencaDose,
            })),
          }))
        ),
      })),
      comparativoCotacoes: comparativoCotacoes.map(r => ({ titulo: r.titulo, totalGeral: r.totalGeral })),
      comparativoProdutos: comparativoProdutos.map(r => ({
        categoria: r.categoria, produto: r.produto,
        principio_ativo: r.principio_ativo ?? undefined,
        fonte: r.fonte ?? undefined,
        precos: r.precos.map(p => ({
          titulo: p.titulo, valor: p.valor,
          isAlternativa: !!p.produtoAlternativo,
          produtoAlternativo: p.produtoAlternativo,
          doseOriginal: p.dose,
          doseAlternativa: p.doseAlternativa,
          pctDiferencaDose: p.pctDiferencaDose,
        })),
      })),
      excelItensJson, areaAplicadaHa: fatorArea,
      talhaoNome: talhaoAreaHa > 0 ? talhaoNome : '', talhaoCoordenadas,
      talhaoImagemBase64,
      talhaoAreaHa: talhaoAreaHa > 0 ? talhaoAreaHa : undefined,
      talhaoAltitude: talhaoAltitude ?? undefined,
      talhaoCoordenadasFormatadas: talhaoCoordenadasFormatadas || undefined,
    } as any);
  };

const handleGerarLinkRevenda = async () => {
  if (!cotacaoId) return;
  setGerandoLink(true);
  try {
    const novoToken = gerarToken();

    // Insere o token exclusivo para esta revenda E
    // atualiza o status da cotação para 'enviada' em paralelo
    const [tokenRes, statusRes] = await Promise.all([
      supabase
        .from('fornecedor_tokens')
        .insert({ cotacao_id: cotacaoId, token: novoToken, usado: false }),
      supabase
        .from('cotacoes')
        .update({ status: 'enviada' })
        .eq('id', cotacaoId),
    ]);

    if (tokenRes.error) throw tokenRes.error;
    if (statusRes.error) throw statusRes.error;

    const link = `${FORNECEDOR_HTML}?token=${novoToken}`;
    setLinkRevenda(link);

    await Share.share({
      title: `Cotacao ${titulo} — Agrocota`,
      message: `Prezado, segue link exclusivo para envio de proposta de precos:\n\n${link}`,
    });
  } catch (err: any) {
    Alert.alert('Erro', 'Nao foi possivel gerar o link: ' + (err?.message ?? 'tente novamente'));
  } finally {
    setGerandoLink(false);
  }
};

  const handleVerPropostas = () => {
    (navigation as any).navigate('PropostasFornecedor', { cotacaoId, titulo });
  };

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: c.bg }]}>
        <View style={[s.header, { paddingTop: insets.top + 12, backgroundColor: c.headerBg }]}>
          <View style={{ width: 70, height: 36, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.15)' }} />
          <View style={{ width: 180, height: 18, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' }} />
          <View style={{ width: 60 }} />
        </View>
        <View style={{ padding: 20, gap: 16 }}>
          {[1,2,3,4,5].map(i => (
            <View key={i} style={[s.card, { backgroundColor: c.surface, borderColor: c.border, minHeight: 100 }]} />
          ))}
        </View>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <StatusBar barStyle="light-content" backgroundColor={c.headerBg} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 12, backgroundColor: c.headerBg }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backText}>Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{titulo || 'Dashboard'}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Barra resumo */}
      <View style={[s.resumoBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <Text style={[s.resumoTxt, { color: c.body }]}>
          {isComparativo
            ? `${comparativoCotacoes.length} cotações comparadas`
            : `${itens.length} produto${itens.length !== 1 ? 's' : ''} · ${categorias.length} categoria${categorias.length !== 1 ? 's' : ''} · R$ ${fmtBRL(totalGeral)}`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Card ações */}
        <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={s.cardRow}>
            <View style={{ flex: 1 }}>
              <Text style={[s.cardTitle, { color: c.title }]}>{titulo}</Text>
              {propostaAceitaEmpresa
                ? <Text style={[s.cardSub, { color: c.accent }]}>Aceita: {propostaAceitaEmpresa}</Text>
                : <Text style={[s.cardSub, { color: c.body }]}>{shareUrl || 'Link de aprovação indisponível'}</Text>}
            </View>
            <View style={s.cardBtns}>
              <TouchableOpacity style={[s.btn, { backgroundColor: c.accent }]} onPress={handleShare} activeOpacity={0.8}>
                <Text style={s.btnWhite}>Enviar ao Produtor</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }]} onPress={handleExportPdf} activeOpacity={0.8}>
                <Text style={[s.btnOutline, { color: c.title }]}>PDF</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Card revendas */}
        {!isComparativo && (
          <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={s.revendaTop}>
              <View style={{ flex: 1 }}>
                <Text style={[s.cardTitle, { color: c.title }]}>Propostas de revendas</Text>
                {propostaAceitaEmpresa
                  ? <Text style={[s.cardSub, { color: c.accent }]}>Aceita: {propostaAceitaEmpresa}</Text>
                  : <Text style={[s.cardSub, { color: c.body }]}>Gere um link exclusivo por revenda</Text>}
              </View>
              {totalPropostas > 0 && (
                <View style={[s.badge, { backgroundColor: c.accentLight }]}>
                  <Text style={[s.badgeNum, { color: c.accent }]}>{totalPropostas}</Text>
                  <Text style={[s.badgeLbl, { color: c.accent }]}>proposta{totalPropostas > 1 ? 's' : ''}</Text>
                </View>
              )}
            </View>
            <View style={s.revendaBtns}>
              <TouchableOpacity
                style={[s.revendaBtn, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }]}
                onPress={() => {
                  navigation.navigate('Planilha', {
                    cotacaoId,
                    shareToken: shareToken ?? '',
                    titulo,
                    fazenda: fazendaNome || undefined,
                  });
                }} activeOpacity={0.8}>
                <Text style={[s.revendaBtnTxt, { color: c.title }]}>Editar planilha</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.revendaBtn, { backgroundColor: c.accent, opacity: gerandoLink ? 0.6 : 1 }]}
                onPress={handleGerarLinkRevenda} disabled={gerandoLink} activeOpacity={0.8}>
                {gerandoLink
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={[s.revendaBtnTxt, { color: '#fff' }]}>Gerar link para revenda</Text>}
              </TouchableOpacity>
              {totalPropostas > 0 && (
                <TouchableOpacity
                  style={[s.revendaBtn, { backgroundColor: c.accentLight, borderWidth: 1, borderColor: c.accent }]}
                  onPress={handleVerPropostas} activeOpacity={0.8}>
                  <Text style={[s.revendaBtnTxt, { color: c.accent }]}>
                    Ver {totalPropostas} proposta{totalPropostas > 1 ? 's' : ''}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Link gerado — persiste na tela para consulta */}
            {!!linkRevenda && (
              <View style={[s.linkCard, { backgroundColor: c.accentLight, borderColor: c.accent }]}>
                <Text style={[s.linkCardLabel, { color: c.accent }]}>Link gerado para revenda</Text>
                <Text style={[s.linkCardUrl, { color: c.title }]} numberOfLines={2} selectable>
                  {linkRevenda}
                </Text>
                <TouchableOpacity
                  style={[s.linkCardBtn, { backgroundColor: c.accent }]}
                  onPress={handleGerarLinkRevenda}
                  activeOpacity={0.8}>
                  <Text style={[s.revendaBtnTxt, { color: '#fff', fontSize: 12 }]}>Novo link</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Estado vazio */}
        {!isComparativo && categorias.length === 0 && (
          <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[s.cardTitle, { color: c.title }]}>Sem itens cadastrados</Text>
            <Text style={[s.cardSub, { color: c.body }]}>Monte a planilha para visualizar o dashboard.</Text>
          </View>
        )}

        {/* ══════════════════════════
            MODO COMPARATIVO
        ══════════════════════════ */}
        {isComparativo && cotacoesOrdenadas.length >= 2 && (
          <>
            <View style={[s.chartCard, { backgroundColor: c.surface, borderColor: c.border, padding: 24 }]}>
              <Text style={[s.chartCardTitle, { color: c.accent, marginBottom: 20 }]}>Comparativo de investimento</Text>
              <DonutChart
                values={cotacoesOrdenadas.map(r => r.totalGeral)}
                colors={cotacoesOrdenadas.map((_, i) => COT_COLORS[i % COT_COLORS.length])}
                labels={cotacoesOrdenadas.map(r => r.titulo)}
                size={220}
                isDark={isDark}
              />
            </View>
            {comparativoProdutos.length > 0 && (() => {
              // Agrupa produtos por categoria para exibição organizada
              const catGroups: Record<string, ProdutoComparativo[]> = {};
              comparativoProdutos.forEach(prod => {
                const cat = prod.categoria || 'Outros';
                if (!catGroups[cat]) catGroups[cat] = [];
                catGroups[cat].push(prod);
              });
              return (
                <View>
                  {Object.entries(catGroups).map(([catNome, prods]) => {
                    const catColor = getCatColor(catNome);
                    return (
                      <View key={catNome} style={[s.catBlock, { borderColor: catColor + '55', marginBottom: 10 }]}>
                        {/* Cabeçalho da categoria */}
                        <View style={[s.catHeader, { backgroundColor: catColor + '22', borderBottomWidth: 1, borderBottomColor: catColor + '33' }]}>
                          <View style={[s.catStripe, { backgroundColor: catColor }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={[s.catNome, { color: catColor }]}>{catNome}</Text>
                            <Text style={[s.catMeta, { color: c.muted }]}>{prods.length} produto{prods.length !== 1 ? 's' : ''}</Text>
                          </View>
                        </View>
                        {/* Produtos da categoria */}
                        <View style={[s.catBody, { backgroundColor: c.surface }]}>
                          {prods.map((prod, prodIdx) => {
                            const maxVal = Math.max(...prod.precos.map(p => p.valor), 1);
                            return (
                              <View key={prod.key} style={[
                                s.compProdGroup,
                                { borderBottomColor: c.borderLight },
                                prodIdx === prods.length - 1 && { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 4 },
                              ]}>
                                <Text style={[s.compProdNome, { color: c.title }]}>{prod.produto}</Text>
                                {/* P.A. e Fonte — chips coloridos sempre visíveis */}
                                {(!!prod.principio_ativo || !!prod.fonte) && (
                                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8, marginTop: 2 }}>
                                    {!!prod.principio_ativo && (
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.successBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.success + '40' }}>
                                        <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.success, textTransform: 'uppercase', letterSpacing: 0.4 }}>P.A.</Text>
                                        <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.success }}>{prod.principio_ativo}</Text>
                                      </View>
                                    )}
                                    {!!prod.fonte && (
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(120,113,108,0.12)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(120,113,108,0.35)' }}>
                                        <Text style={{ fontSize: 9, fontWeight: '700', color: '#78716c', textTransform: 'uppercase', letterSpacing: 0.4 }}>Fonte</Text>
                                        <Text style={{ fontSize: 11, fontWeight: '600', color: '#a8a29e' }}>{prod.fonte}</Text>
                                      </View>
                                    )}
                                  </View>
                                )}
                                <View style={{ marginTop: 4 }}>
                                  {prod.precos.map((p, idx) => {
                                    const ci = cotacoesOrdenadas.findIndex(r => r.id === p.cotacaoId);
                                    // precos já ordenados por valor asc → idx===0 é o menor
                                    const minVal2 = prod.precos[0]?.valor ?? 0;
                                    return (
                                      <CompBar key={p.cotacaoId} label={p.titulo} value={p.valor}
                                        maxValue={maxVal} minValue={minVal2}
                                        isMenorOverride={idx === 0 && prod.precos.length > 1}
                                        color={COT_COLORS[(ci >= 0 ? ci : idx) % COT_COLORS.length]} />
                                    );
                                  })}
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })()}
            <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[s.cardTitle, { color: c.title, marginBottom: 4 }]}>Ranking de cotações</Text>
              <Text style={[s.cardSub, { color: c.muted, marginBottom: 12 }]}>
                {comparativoProdutos.length} produto{comparativoProdutos.length !== 1 ? 's' : ''} comparados
              </Text>
              {cotacoesOrdenadas.map((row, idx) => {
                const isMenor = idx === 0;
                // Produtos desta cotação com seus preços, ordenados por categoria
                const prodsCotacao = comparativoProdutos
                  .map(p => ({ ...p, preco: p.precos.find(pr => pr.cotacaoId === row.id) }))
                  .filter(p => p.preco != null);
                return (
                  <View key={row.id} style={[
                    s.rankRow,
                    { borderBottomColor: c.border, flexDirection: 'column', alignItems: 'stretch', gap: 0 },
                    isMenor && { backgroundColor: c.accentLight },
                  ]}>
                    {/* Linha título + valor */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: prodsCotacao.length > 0 ? 10 : 0 }}>
                      <Text style={[s.rankNum, { color: isMenor ? c.accent : c.muted }]}>#{idx + 1}</Text>
                      <Text style={[s.rankTitulo, { color: c.title }]} numberOfLines={1}>{row.titulo}</Text>
                      {isMenor && <Text style={[s.rankTag, { color: c.accent }]}>Menor</Text>}
                      <Text style={[s.rankValor, { color: isMenor ? c.accent : c.title }]}>R$ {fmtBRL(row.totalGeral)}</Text>
                    </View>
                    {/* Produtos desta cotação com PA e Fonte */}
                    {prodsCotacao.length > 0 && (
                      <View style={{ gap: 6, paddingBottom: 4 }}>
                        {prodsCotacao.map(p => {
                          const minPreco = Math.min(...p.precos.map(x => x.valor));
                          const isThisMenor = (p.preco?.valor ?? 0) === minPreco && p.precos.length > 1;
                          return (
                            <View key={p.key} style={[
                              s.rankProdRow,
                              { borderColor: isThisMenor ? c.accent + '55' : c.borderLight,
                                backgroundColor: isThisMenor ? c.accentLight : (isDark ? '#0A120D' : '#F9FBF9') },
                            ]}>
                              <View style={{ flex: 1 }}>
                                <Text style={[s.rankProdNome, { color: c.title }]} numberOfLines={1}>
                                  {p.produto}
                                </Text>
                                {(!!p.principio_ativo || !!p.fonte) && (
                                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                                    {!!p.principio_ativo && (
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.successBg, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1, borderColor: Colors.success + '33' }}>
                                        <Text style={{ fontSize: 8, fontWeight: '700', color: Colors.success, textTransform: 'uppercase' }}>P.A.</Text>
                                        <Text style={{ fontSize: 10, fontWeight: '600', color: Colors.success }} numberOfLines={1}>{p.principio_ativo}</Text>
                                      </View>
                                    )}
                                    {!!p.fonte && (
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(120,113,108,0.12)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(120,113,108,0.3)' }}>
                                        <Text style={{ fontSize: 8, fontWeight: '700', color: '#78716c', textTransform: 'uppercase' }}>Fonte</Text>
                                        <Text style={{ fontSize: 10, fontWeight: '600', color: '#a8a29e' }} numberOfLines={1}>{p.fonte}</Text>
                                      </View>
                                    )}
                                  </View>
                                )}
                              </View>
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={[s.rankProdValor, { color: isThisMenor ? c.accent : c.title }]}>
                                  R$ {fmtBRL(p.preco?.valor ?? 0)}
                                </Text>
                                {isThisMenor && (
                                  <Text style={{ fontSize: 9, color: c.accent, fontWeight: '800', marginTop: 1 }}>menor preço</Text>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* ═══════════════════════════════════════════════════════
            MODO INDIVIDUAL
            ┌─────────────────────────────────────────────────┐
            │ ▼  FUNGICIDA          4 produtos  R$ 450,00/ha  │  ← toque expande
            ├─────────────────────────────────────────────────┤
            │  P.A.: Azoxistrobina + Tebuconazol              │  ← cabeçalho grupo
            │  Fonte: Estrobilurina + Triazol    R$ 220,00    │
            │                                                 │
            │  ┌─────────────────────────────────────────┐   │
            │  │ Nativo 750SC                             │   │  ← produto
            │  │ [Estádio: V4] [Dose: 0.5 L] [Aplic: 2x] │   │
            │  │ [Alvo: Ferrugem] [Tecn: …] [Grupo: …]   │   │
            │  │ ─────────────────────────────────────── │   │
            │  │ Revenda A  ████████████  R$ 120,00/ha   │   │  ← barras
            │  │ Revenda B  ████████      R$  98,00/ha   │   │
            │  └─────────────────────────────────────────┘   │
            │  ┌─────────────────────────────────────────┐   │
            │  │ Elatus Ace   …                          │   │
            │  └─────────────────────────────────────────┘   │
            │                                                 │
            │  P.A.: Trifloxistrobina  …  ← próximo grupo     │
            └─────────────────────────────────────────────────┘
        ═══════════════════════════════════════════════════════ */}
        {!isComparativo && categorias.length > 0 && (
          <>
            {/* KPIs */}
            <View style={s.kpiRow}>
              <View style={[s.kpiCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[s.kpiLabel, { color: c.muted }]}>Total geral</Text>
                <Text style={[s.kpiVal, { color: c.accent }]}>R$ {fmtBRL(totalGeral)}</Text>
              </View>
              <View style={[s.kpiCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[s.kpiLabel, { color: c.muted }]}>Produtos</Text>
                <Text style={[s.kpiVal, { color: c.title }]}>{itens.length}</Text>
              </View>
              <View style={[s.kpiCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[s.kpiLabel, { color: c.muted }]}>Categorias</Text>
                <Text style={[s.kpiVal, { color: c.title }]}>{categorias.length}</Text>
              </View>
            </View>

            {/* Barras de resumo por categoria */}
            <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[s.cardTitle, { color: c.title }]}>Custo por categoria</Text>
              {categorias.map(cat => {
                const pct = maxCategoria > 0 ? (cat.custoCategoria / maxCategoria) * 100 : 0;
                return (
                  <View key={cat.categoria} style={[s.catSumRow, { borderBottomColor: c.borderLight }]}>
                    <View style={[s.catColorBar, { backgroundColor: cat.color }]} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={[s.catSumNome, { color: c.title }]}>{cat.categoria}</Text>
                        <Text style={[s.catSumMeta, { color: c.muted }]}>{cat.numProdutos} prod.</Text>
                      </View>
                      <View style={[s.catTrack, { backgroundColor: c.track }]}>
                        <View style={[s.catFill, { width: `${Math.max(pct, 2)}%`, backgroundColor: cat.color }]} />
                      </View>
                    </View>
                    <Text style={[s.catSumVal, { color: cat.color }]}>R$ {fmtBRL(cat.custoCategoria)}</Text>
                  </View>
                );
              })}
            </View>

            {/* ── CATEGORIAS EXPANSÍVEIS ── */}
            {visibleCats.map(cat => {
              const catOpen = !!expandedCats[cat.categoria];
              return (
                <View key={cat.categoria} style={[s.catBlock, { borderColor: cat.color + '55' }]}>

                  {/* Cabeçalho Categoria — toque para expandir/colapsar */}
                  <TouchableOpacity
                    style={[s.catHeader, {
                      backgroundColor: cat.color + '18',
                      borderBottomWidth: catOpen ? 1 : 0,
                      borderBottomColor: cat.color + '33',
                    }]}
                    onPress={() => toggleCat(cat.categoria)}
                    activeOpacity={0.75}
                  >
                    <View style={[s.catStripe, { backgroundColor: cat.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.catNome, { color: cat.color }]}>{cat.categoria}</Text>
                      <Text style={[s.catMeta, { color: c.muted }]}>
                        {cat.numProdutos} produto{cat.numProdutos !== 1 ? 's' : ''}
                        {' · '}{cat.grupos.length} grupo{cat.grupos.length !== 1 ? 's' : ''} de P.A.
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[s.catVal, { color: cat.color }]}>R$ {fmtBRL(cat.custoCategoria)}</Text>
                      <Text style={[s.catToggle, { color: c.muted }]}>{catOpen ? 'Recolher' : 'Expandir'}</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Conteúdo expandido */}
                  {catOpen && (
                    <View style={[s.catBody, { backgroundColor: c.surface }]}>
                      {cat.grupos.map((grupo, gIdx) => (
                        <View key={grupo.chave}>

                          {/* ── Cabeçalho P.A. + Fonte (visual, sem expansão) ── */}
                          <View style={[
                            s.paRow,
                            gIdx > 0 && { borderTopWidth: 1, borderTopColor: c.borderLight },
                          ]}>
                            <View style={{ flex: 1 }}>
                              <Text style={[s.paNome, { color: c.paText }]} numberOfLines={2}>
                                {grupo.principio_ativo || 'Sem Princípio Ativo'}
                              </Text>
                              {!!grupo.fonte && (
                                <Text style={[s.paFonte, { color: c.muted }]}>
                                  Fonte: {grupo.fonte}
                                </Text>
                              )}
                            </View>
                            <Text style={[s.paCusto, { color: c.paText }]}>
                              R$ {fmtBRL(grupo.custoGrupo)}
                            </Text>
                          </View>

                          {/* ── Produtos do grupo ── */}
                          {grupo.produtos.map((prod) => {
                            const maxBar = Math.max(...prod.opcoes.map(o => o.valor_ha), 1);
                            const refOp  = prod.opcoes[0];

                            // Monta lista de chips com apenas os campos preenchidos
                            const chips: { label: string; value: string }[] = [];
                            if (prod.estagio)                        chips.push({ label: 'Estádio',    value: prod.estagio });
                            if (refOp?.dose_ha != null && refOp?.unidade) chips.push({ label: 'Dose',  value: `${refOp.dose_ha} ${refOp.unidade}` });
                            if (refOp?.n_aplicacoes)                 chips.push({ label: 'Aplicações', value: `${refOp.n_aplicacoes}x` });
                            if (prod.alvo)                           chips.push({ label: 'Alvo',        value: prod.alvo });
                            if (prod.tecnologia)                     chips.push({ label: 'Tecnologia',  value: prod.tecnologia });
                            if (prod.grupo_alvo)                     chips.push({ label: 'Grupo Alvo',  value: prod.grupo_alvo });
                            if (prod.campo_adicional)                chips.push({ label: 'Adicional',   value: prod.campo_adicional });
                            if (refOp?.obs)                          chips.push({ label: 'Obs',         value: refOp.obs! });

                            return (
                              <View
                                key={prod.produto}
                                style={[s.prodCard, {
                                  backgroundColor: isDark ? '#1C241E' : '#F9FBF9',
                                  borderColor: c.border,
                                  borderLeftColor: cat.color,
                                }]}
                              >
                                {/* Nome */}
                                <Text style={[s.prodNome, { color: c.title }]} numberOfLines={2}>
                                  {prod.produto}
                                </Text>

                                {/* Chips de informação */}
                                {chips.length > 0 && (
                                  <View style={s.chipsRow}>
                                    {chips.map(ch => (
                                      <InfoChip key={ch.label} label={ch.label} value={ch.value} color={cat.color} />
                                    ))}
                                  </View>
                                )}

                                {/* Divisor */}
                                <View style={[s.divider, { backgroundColor: c.borderLight }]} />

                                {/* Barras de revenda — sempre visíveis */}
                                {prod.opcoes.length === 0
                                  ? <Text style={[s.semPreco, { color: c.muted }]}>Aguardando preços</Text>
                                  : prod.opcoes.map(op => (
                                    <RevendaBar
                                      key={op.id}
                                      revenda={op.revenda}
                                      value={op.valor_ha}
                                      max={maxBar}
                                      color={cat.color}
                                      isAlternativa={op.isAlternativa}
                                      produtoAlternativo={op.produtoAlternativo}
                                      pctDiferencaDose={op.pctDiferencaDose}
                                    />
                                  ))
                                }
                              </View>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}

            {categorias.length > 8 && (
              <TouchableOpacity
                style={[s.moreCatsBtn, { borderColor: c.border, backgroundColor: c.surface }]}
                onPress={() => setShowAllCats(v => !v)}
                activeOpacity={0.75}
              >
                <Text style={[s.moreCatsTxt, { color: c.accent }]}>
                  {showAllCats ? 'Mostrar menos' : `Ver todas as categorias (${categorias.length})`}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 56, paddingHorizontal: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  backText: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '600', letterSpacing: 0.1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff', flex: 1, textAlign: 'center' },

  resumoBar: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  resumoTxt: { fontSize: 13, fontWeight: '500' },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 14, paddingBottom: 32 },

  card: { borderRadius: 12, padding: 16, borderWidth: 1 },
  cardRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardSub: { fontSize: 13, lineHeight: 19 },
  cardBtns: { gap: 10 },
  btn: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', minWidth: 120 },
  btnWhite: { fontSize: 14, fontWeight: '600', color: '#fff' },
  btnOutline: { fontSize: 14, fontWeight: '600' },

  revendaTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginBottom: 16 },
  badge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 52 },
  badgeNum: { fontSize: 18, fontWeight: '800', lineHeight: 22 },
  badgeLbl: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  revendaBtns: { gap: 10 },
  revendaBtn: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  revendaBtnTxt: { fontSize: 14, fontWeight: '600' },

  linkCard: { borderRadius: 10, borderWidth: 1, padding: 14, marginTop: 12, gap: 8 },
  linkCardLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  linkCardUrl: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
  linkCardBtn: { borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 6 },

  kpiRow: { flexDirection: 'row', gap: 12 },
  kpiCard: { flex: 1, borderRadius: 12, padding: 16, borderWidth: 1 },
  kpiLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  kpiVal: { fontSize: 18, fontWeight: '800' },

  catSumRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  catColorBar: { width: 4, height: 40, borderRadius: 4, flexShrink: 0 },
  catSumNome: { fontSize: 14, fontWeight: '600' },
  catSumMeta: { fontSize: 11 },
  catTrack: { height: 6, borderRadius: 6, overflow: 'hidden', marginTop: 6 },
  catFill: { height: '100%', borderRadius: 6 },
  catSumVal: { fontSize: 14, fontWeight: '700', minWidth: 90, textAlign: 'right' },

  catBlock: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },

  catHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  catStripe: { width: 4, height: 32, borderRadius: 2, flexShrink: 0 },
  catNome: { fontSize: 15, fontWeight: '700', letterSpacing: 0 },
  catMeta: { fontSize: 12, marginTop: 3 },
  catVal: { fontSize: 15, fontWeight: '700' },
  catToggle: { fontSize: 12, fontWeight: '600', marginTop: 4 },

  catBody: { paddingHorizontal: 16, paddingBottom: 16 },

  paRow: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 16, paddingBottom: 8, gap: 12 },
  paNome: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  paFonte: { fontSize: 12, marginTop: 4 },
  paCusto: { fontSize: 13, fontWeight: '700', paddingTop: 2, minWidth: 84, textAlign: 'right' },

  prodCard: { borderRadius: 10, borderWidth: 1, borderLeftWidth: 4, padding: 14, marginBottom: 10 },
  prodNome: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  divider: { height: 1, marginVertical: 10 },
  semPreco: { fontSize: 13, fontStyle: 'italic', paddingVertical: 6 },

  moreCatsBtn: { borderRadius: 10, borderWidth: 1, paddingVertical: 14, alignItems: 'center' },
  moreCatsTxt: { fontSize: 14, fontWeight: '600' },

  chartCard: { borderRadius: 12, padding: 24, borderWidth: 1 },
  chartCardTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 20 },
  compProdGroup: { marginBottom: 20, paddingBottom: 20, borderBottomWidth: 1 },
  compProdNome: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  compProdPA: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  compProdFonte: { fontSize: 12, fontWeight: '500', marginBottom: 6 },

  rankRow: { paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: 1, borderRadius: 10, marginBottom: 8 },
  rankNum: { fontSize: 13, fontWeight: '700', minWidth: 30 },
  rankTitulo: { flex: 1, fontSize: 15, fontWeight: '600' },
  rankTag: { fontSize: 12, fontWeight: '700' },
  rankValor: { fontSize: 15, fontWeight: '700' },
  rankProdRow: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rankProdNome: { fontSize: 13, fontWeight: '700' },
  rankProdPA: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  rankProdFonte: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  rankProdValor: { fontSize: 14, fontWeight: '800' },
});