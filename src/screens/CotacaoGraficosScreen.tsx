import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ItemCotacao {
  id: string;
  produto_nome: string;
  fornecedor: string | null;
  categoria: string | null;
  valor_ha: number | null;
}

interface OpcaoProduto {
  fornecedor: string;
  valor_ha: number;
  id: string;
}

interface GrupoProduto {
  produto: string;
  opcoes: OpcaoProduto[]; // sorted cheapest first
}

interface CategoriaCompleta {
  categoria: string;
  color: string;
  somaMin: number;   // sum of cheapest per product = best-case budget
  somaMax: number;   // sum of most expensive per product
  numProdutos: number;
  numCotacoes: number;
  grupos: GrupoProduto[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CotacaoGraficos'>;
  route: RouteProp<RootStackParamList, 'CotacaoGraficos'>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Paleta dinamica — suporta qualquer categoria que vier da planilha
const COLOR_PALETTE = [
  '#1B5E20', '#F57C00', '#C62828', '#1565C0', '#00838F',
  '#6A1B9A', '#4E342E', '#0277BD', '#EF6C00', '#558B2F',
  '#00695C', '#880E4F', '#1A237E', '#BF360C', '#006064',
  '#F9A825', '#4A148C', '#37474F', '#E65100', '#283593',
  '#33691E', '#FF6F00', '#4527A0', '#AD1457',
];

// Seeds pre-definidas mais comuns
const _colorMap: Record<string, string> = {
  Fungicida:    '#1B5E20',
  Inseticida:   '#F57C00',
  Herbicida:    '#C62828',
  Nutricao:     '#1565C0',
  Foliar:       '#00838F',
  Fertilizante: '#6A1B9A',
  Adjuvante:    '#4E342E',
  Semente:      '#0277BD',
  Acaricida:    '#EF6C00',
  Nematicida:   '#558B2F',
  Regulador:    '#00695C',
  Outros:       '#546E7A',
};
let _colorIdx = Object.keys(_colorMap).length;

function getColor(cat: string): string {
  if (!_colorMap[cat]) {
    _colorMap[cat] = COLOR_PALETTE[_colorIdx % COLOR_PALETTE.length];
    _colorIdx++;
  }
  return _colorMap[cat];
}

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Horizontal bar showing proportional value */
function HBar({
  value,
  max,
  color,
  label,
  valueLabel,
  badge,
  dim,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  valueLabel: string;
  badge?: string;
  dim?: boolean;
}) {
  const pct = max > 0 ? (value / max) * 100 : 100;
  return (
    <View style={[hb.row, dim && { opacity: 0.55 }]}>
      <Text style={hb.label} numberOfLines={1}>{label}</Text>
      <View style={hb.track}>
        <View style={[hb.fill, { width: `${Math.max(pct, 3)}%`, backgroundColor: color }]} />
      </View>
      <View style={hb.right}>
        <Text style={[hb.val, { color }]}>{valueLabel}</Text>
        {badge ? (
          <View style={[hb.badge, { backgroundColor: color + '28' }]}>
            <Text style={[hb.badgeText, { color }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const hb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  label: { width: 82, fontSize: 11, color: '#6B8A6B', fontWeight: '600' },
  track: {
    flex: 1,
    height: 18,
    backgroundColor: '#F0F6F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 96, justifyContent: 'flex-end' },
  val: { fontSize: 12, fontWeight: '700' },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CotacaoGraficosScreen({ navigation, route }: Props) {
  const { cotacaoId, shareToken } = route.params;
  const insets = useSafeAreaInsets();
  const [itens, setItens] = useState<ItemCotacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [titulo, setTitulo] = useState('');
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});

  const shareUrl = `https://eloquent-belekoy-0f88af.netlify.app?t=${shareToken}`;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cotRes, itensRes] = await Promise.all([
        supabase.from('cotacoes').select('titulo').eq('id', cotacaoId).single(),
        supabase
          .from('itens_cotacao')
          .select('id, produto_nome, fornecedor, categoria, valor_ha')
          .eq('cotacao_id', cotacaoId)
          .order('categoria')
          .order('produto_nome'),
      ]);
      if (cotRes.data) setTitulo(cotRes.data.titulo);
      if (itensRes.data) setItens(itensRes.data as ItemCotacao[]);
    } finally {
      setLoading(false);
    }
  }, [cotacaoId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Data ──────────────────────────────────────────────────────────────────

  // Build: categoria → { grupos de produto com todas as opções de fornecedor }
  const categorias: CategoriaCompleta[] = React.useMemo(() => {
    // Step 1: group by category → product → options
    const catMap: Record<string, Record<string, OpcaoProduto[]>> = {};
    itens.forEach(it => {
      if (!it.produto_nome) return;
      const cat  = it.categoria ?? 'Insumo';
      const prod = it.produto_nome;
      if (!catMap[cat]) catMap[cat] = {};
      if (!catMap[cat][prod]) catMap[cat][prod] = [];
      catMap[cat][prod].push({
        fornecedor: it.fornecedor ?? 'N/I',
        valor_ha:   it.valor_ha   ?? 0,
        id:         it.id,
      });
    });

    // Step 2: build CategoriaCompleta, sort products and options
    return Object.entries(catMap)
      .map(([categoria, prodMap]) => {
        const grupos: GrupoProduto[] = Object.entries(prodMap)
          .map(([produto, opcoes]) => ({
            produto,
            opcoes: opcoes.sort((a, b) => a.valor_ha - b.valor_ha),
          }))
          .sort((a, b) => a.produto.localeCompare(b.produto));

        const somaMin = grupos.reduce((s, g) => s + (g.opcoes[0]?.valor_ha ?? 0), 0);
        const somaMax = grupos.reduce((s, g) => s + (g.opcoes[g.opcoes.length - 1]?.valor_ha ?? 0), 0);
        const numCotacoes = grupos.reduce((s, g) => s + g.opcoes.length, 0);

        return {
          categoria,
          color: getColor(categoria),
          somaMin,
          somaMax,
          numProdutos: grupos.length,
          numCotacoes,
          grupos,
        };
      })
      .sort((a, b) => b.somaMax - a.somaMax);
  }, [itens]);

  const globalSomaMax = Math.max(...categorias.map(c => c.somaMax), 1);

  const totalGeralMin = categorias.reduce((s, c) => s + c.somaMin, 0);
  const totalGeralMax = categorias.reduce((s, c) => s + c.somaMax, 0);
  const economiaPotencial = Math.max(totalGeralMax - totalGeralMin, 0);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Acesse sua cotacao: ${shareUrl}`,
        url: shareUrl,
        title: titulo,
      });
    } catch {
      await Clipboard.setStringAsync(shareUrl);
      Alert.alert('Link copiado', 'O link foi copiado para a area de transferencia.');
    }
  };

  const toggleCategoria = (categoria: string) => {
    setExpandedCats(prev => ({
      ...prev,
      [categoria]: !prev[categoria],
    }));
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.loadingRoot}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={s.loadingText}>Gerando graficos...</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />

      {/* HEADER */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.navigate('ConsultorHome')} activeOpacity={0.8}>
          <Text style={s.backText}>‹  Inicio</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{titulo}</Text>
          <Text style={s.headerSub}>{itens.length} itens · {categorias.length} categorias</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* LINK BOX */}
        <View style={s.linkBox}>
          <View style={{ flex: 1 }}>
            <Text style={s.linkBoxTitle}>Link para o produtor</Text>
            <Text style={s.linkBoxUrl} numberOfLines={1}>{shareUrl}</Text>
          </View>
          <TouchableOpacity style={s.copyBtn} onPress={handleShare} activeOpacity={0.85}>
            <Text style={s.copyBtnText}>Compartilhar</Text>
          </TouchableOpacity>
        </View>

        {/* ── VISÃO GERAL: todas as categorias ── */}
        {categorias.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Investimento por categoria (R$/ha)</Text>
            {/* Total geral */}
            <View style={s.totalRow}>
              <View style={s.totalCol}>
                <Text style={s.totalLabel}>Menor cenário</Text>
                <Text style={[s.totalVal, { color: '#2E7D32' }]}>R$ {fmtBRL(totalGeralMin)}</Text>
              </View>
              <View style={s.totalDivider} />
              <View style={s.totalCol}>
                <Text style={s.totalLabel}>Maior cenário</Text>
                <Text style={[s.totalVal, { color: '#C62828' }]}>R$ {fmtBRL(totalGeralMax)}</Text>
              </View>
            </View>
            <View style={s.economiaBox}>
              <Text style={s.economiaLabel}>Economia potencial</Text>
              <Text style={s.economiaVal}>R$ {fmtBRL(economiaPotencial)} /ha</Text>
            </View>
            <View style={s.divider} />
            {/* Bar per category */}
            {categorias.map(cat => (
              <HBar
                key={cat.categoria}
                value={cat.somaMax}
                max={globalSomaMax}
                color={cat.color}
                label={cat.categoria}
                valueLabel={`R$ ${fmtBRL(cat.somaMin)}–${fmtBRL(cat.somaMax)}`}
                badge={`${cat.numProdutos}p · ${Math.round((cat.somaMax / Math.max(totalGeralMax, 1)) * 100)}%`}
              />
            ))}
          </View>
        )}

        {/* ── SEÇÕES POR CATEGORIA ── */}
        {categorias.map(cat => (
          <View key={cat.categoria} style={s.catSection}>
            {(() => {
              const isExpanded = !!expandedCats[cat.categoria];
              return (
                <>
                  {/* Category header */}
                  <TouchableOpacity
                    style={[s.catHeader, { borderLeftColor: cat.color }]}
                    activeOpacity={0.85}
                    onPress={() => toggleCategoria(cat.categoria)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.catHeaderNome}>{cat.categoria}</Text>
                      <Text style={s.catHeaderSub}>
                        {cat.numProdutos} produto{cat.numProdutos !== 1 ? 's' : ''} · {cat.numCotacoes} cotaç{cat.numCotacoes !== 1 ? 'ões' : 'ão'}
                      </Text>
                    </View>
                    <View style={s.catHeaderRight}>
                      <Text style={[s.catHeaderMin, { color: cat.color }]}>R$ {fmtBRL(cat.somaMin)}</Text>
                      <Text style={s.catHeaderMinLabel}>mín/ha</Text>
                    </View>
                    <Text style={s.catToggle}>{isExpanded ? '−' : '+'}</Text>
                  </TouchableOpacity>

                  {!isExpanded ? (
                    <Text style={s.catCollapsedHint}>Toque para expandir os produtos desta categoria</Text>
                  ) : (
                    <>
                      {/* Products in this category */}
                      {cat.grupos.map(gp => {
                        const maxBar = Math.max(...gp.opcoes.map(o => o.valor_ha), 1);
                        const minVal = gp.opcoes[0]?.valor_ha ?? 0;
                        const maxVal = gp.opcoes[gp.opcoes.length - 1]?.valor_ha ?? 0;

                        return (
                          <View key={gp.produto} style={s.produtoCard}>
                            {/* Product name + range */}
                            <View style={s.produtoHeader}>
                              <Text style={s.produtoNome} numberOfLines={2}>{gp.produto}</Text>
                              <View style={s.produtoRange}>
                                <Text style={[s.produtoRangeVal, { color: '#2E7D32' }]}>R$ {fmtBRL(minVal)}</Text>
                                {gp.opcoes.length > 1 && (
                                  <Text style={s.produtoRangeSep}> – R$ {fmtBRL(maxVal)}</Text>
                                )}
                              </View>
                            </View>

                            {/* ALL suppliers as bars */}
                            {gp.opcoes.map((op, idx) => {
                              const isCheapest = idx === 0;
                              const isMost     = idx === gp.opcoes.length - 1 && gp.opcoes.length > 1;
                              const barColor   = isCheapest ? '#2E7D32' : isMost ? '#C62828' : '#78909C';
                              return (
                                <HBar
                                  key={op.id}
                                  value={op.valor_ha}
                                  max={maxBar}
                                  color={barColor}
                                  label={op.fornecedor}
                                  valueLabel={`R$ ${fmtBRL(op.valor_ha)}`}
                                  badge={isCheapest ? 'MENOR' : isMost ? 'MAIOR' : undefined}
                                  dim={!isCheapest && !isMost}
                                />
                              );
                            })}
                          </View>
                        );
                      })}
                    </>
                  )}
                </>
              );
            })()}
          </View>
        ))}

        {/* CTA */}
        <View style={s.infoBox}>
          <Text style={s.infoTitle}>Proximo passo</Text>
          <Text style={s.infoText}>
            Envie o link para o produtor. Ele vê todos os fornecedores organizados por
            categoria (Sementes, Fertilizantes…), escolhe o preferido em cada produto
            e dá o aceite digital.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6F4' },
  loadingRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F6F4' },
  loadingText: { marginTop: 16, fontSize: 14, color: '#6B8A6B', fontWeight: '600' },
  header: {
    backgroundColor: '#1F4E1F',
    paddingTop: 14,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    minWidth: 88, alignItems: 'center',
  },
  backText: { fontSize: 14, color: '#A5D6A7', fontWeight: '700' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  // Link box
  linkBox: {
    backgroundColor: '#1A2E1A',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  linkBoxTitle: {
    fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3,
  },
  linkBoxUrl: { fontSize: 12, color: '#81C784', fontWeight: '500' },
  copyBtn: {
    backgroundColor: '#2E7D32',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  copyBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  // Overview card
  card: {
    backgroundColor: '#fff',
    borderRadius: 16, padding: 18, marginBottom: 20,
    borderWidth: 1, borderColor: '#E4EDE4',
  },
  cardTitle: {
    fontSize: 11, fontWeight: '800', color: '#6B8A6B',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  totalCol: { flex: 1, alignItems: 'center' },
  totalDivider: { width: 1, height: 40, backgroundColor: '#E4EDE4', marginHorizontal: 8 },
  totalLabel: { fontSize: 10, color: '#8FA08F', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  totalVal: { fontSize: 18, fontWeight: '900' },
  economiaBox: {
    marginBottom: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D8EAD8',
    backgroundColor: '#F2FAF2',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  economiaLabel: { fontSize: 11, color: '#6B8A6B', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  economiaVal: { fontSize: 14, color: '#2E7D32', fontWeight: '900' },
  divider: { height: 1, backgroundColor: '#E4EDE4', marginBottom: 14 },

  // Category section
  catSection: { marginBottom: 24 },
  catHeader: {
    borderLeftWidth: 4, paddingLeft: 12,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 12,
    padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#E4EDE4',
  },
  catHeaderNome: { fontSize: 15, fontWeight: '900', color: '#1A2E1A' },
  catHeaderSub: { fontSize: 11, color: '#8FA08F', marginTop: 2, fontWeight: '600' },
  catHeaderRight: { alignItems: 'flex-end' },
  catHeaderMin: { fontSize: 16, fontWeight: '900' },
  catHeaderMinLabel: { fontSize: 10, color: '#8FA08F', textTransform: 'uppercase', letterSpacing: 0.5 },
  catToggle: {
    fontSize: 24,
    color: '#6B8A6B',
    fontWeight: '700',
    lineHeight: 24,
    marginLeft: 10,
    width: 18,
    textAlign: 'center',
  },
  catCollapsedHint: {
    fontSize: 11,
    color: '#8FA08F',
    fontWeight: '600',
    marginTop: 2,
    marginLeft: 10,
    marginBottom: 4,
  },

  // Product card
  produtoCard: {
    backgroundColor: '#fff', borderRadius: 12,
    padding: 14, marginBottom: 8, marginLeft: 8,
    borderWidth: 1, borderColor: '#E4EDE4',
  },
  produtoHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: 10, gap: 8,
  },
  produtoNome: { flex: 1, fontSize: 13, fontWeight: '800', color: '#1A2E1A' },
  produtoRange: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  produtoRangeVal: { fontSize: 12, fontWeight: '700' },
  produtoRangeSep: { fontSize: 12, color: '#C62828', fontWeight: '700' },

  // Info / CTA box
  infoBox: {
    backgroundColor: '#1F4E1F', borderRadius: 16,
    padding: 20, marginTop: 8, marginBottom: 8,
  },
  infoTitle: { fontSize: 13, fontWeight: '800', color: '#fff', marginBottom: 8 },
  infoText: { fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 20, marginBottom: 16 },
});
