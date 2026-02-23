import os

graficos = r"""import React, { useEffect, useState, useCallback } from 'react';
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
  Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
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
  opcoes: OpcaoProduto[];
}

interface GrupoCategoria {
  categoria: string;
  totalMin: number;
  totalMax: number;
  count: number;
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

const SCREEN_W = Dimensions.get('window').width;

const CATEGORIA_COLORS: Record<string, string> = {
  Fungicida: '#1B5E20',
  Inseticida: '#F57C00',
  Herbicida: '#C62828',
  Nutricao: '#1565C0',
  Foliar: '#00838F',
  Fertilizante: '#6A1B9A',
  Adjuvante: '#4E342E',
  Outros: '#546E7A',
};

function getColor(cat: string): string {
  return CATEGORIA_COLORS[cat] ?? CATEGORIA_COLORS.Outros;
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
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  valueLabel: string;
  badge?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 100;
  return (
    <View style={hb.row}>
      <Text style={hb.label} numberOfLines={1}>{label}</Text>
      <View style={hb.track}>
        <View style={[hb.fill, { width: `${Math.max(pct, 4)}%`, backgroundColor: color }]} />
      </View>
      <View style={hb.right}>
        <Text style={[hb.val, { color }]}>{valueLabel}</Text>
        {badge ? (
          <View style={[hb.badge, { backgroundColor: color + '22' }]}>
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
  const [itens, setItens] = useState<ItemCotacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [titulo, setTitulo] = useState('');

  const shareUrl = `https://seu-projeto.supabase.co/functions/v1/cotacao-viewer?token=${shareToken}`;

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

  const porCategoria: GrupoCategoria[] = React.useMemo(() => {
    const map: Record<string, number[]> = {};
    itens.forEach(it => {
      const cat = it.categoria ?? 'Outros';
      if (!map[cat]) map[cat] = [];
      if (it.valor_ha) map[cat].push(it.valor_ha);
    });
    return Object.entries(map).map(([categoria, vals]) => ({
      categoria,
      totalMin: vals.length ? Math.min(...vals) : 0,
      totalMax: vals.length ? Math.max(...vals) : 0,
      count: vals.length,
    })).sort((a, b) => b.totalMax - a.totalMax);
  }, [itens]);

  const porProduto: GrupoProduto[] = React.useMemo(() => {
    const map: Record<string, OpcaoProduto[]> = {};
    itens.forEach(it => {
      if (!it.produto_nome) return;
      if (!map[it.produto_nome]) map[it.produto_nome] = [];
      map[it.produto_nome].push({
        fornecedor: it.fornecedor ?? 'N/I',
        valor_ha: it.valor_ha ?? 0,
        id: it.id,
      });
    });
    return Object.entries(map)
      .map(([produto, opcoes]) => ({
        produto,
        opcoes: opcoes.sort((a, b) => a.valor_ha - b.valor_ha),
      }))
      .sort((a, b) => a.produto.localeCompare(b.produto));
  }, [itens]);

  const globalMax = React.useMemo(
    () => Math.max(...porCategoria.map(g => g.totalMax), 1),
    [porCategoria],
  );

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
      Alert.alert('Link copiado', 'Cole no WhatsApp ou e-mail.');
    }
  };

  const handleCopyLink = async () => {
    await Clipboard.setStringAsync(shareUrl);
    Alert.alert('Link copiado', 'Cole o link no WhatsApp, e-mail ou onde preferir.');
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
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.navigate('ConsultorHome')} activeOpacity={0.8}>
          <Text style={s.backText}>Inicio</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{titulo}</Text>
          <Text style={s.headerSub}>{itens.length} itens importados</Text>
        </View>
        <TouchableOpacity style={s.shareHeaderBtn} onPress={handleShare} activeOpacity={0.85}>
          <Text style={s.shareHeaderText}>Compartilhar</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* LINK BOX */}
        <View style={s.linkBox}>
          <View style={{ flex: 1 }}>
            <Text style={s.linkBoxTitle}>Link para o produtor</Text>
            <Text style={s.linkBoxUrl} numberOfLines={1}>{shareUrl}</Text>
          </View>
          <TouchableOpacity style={s.copyBtn} onPress={handleCopyLink} activeOpacity={0.85}>
            <Text style={s.copyBtnText}>Copiar</Text>
          </TouchableOpacity>
        </View>

        {/* GRAFICO: valor maximo por categoria */}
        {porCategoria.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Preco maximo por categoria (R$/ha)</Text>
            {porCategoria.map(gc => (
              <HBar
                key={gc.categoria}
                value={gc.totalMax}
                max={globalMax}
                color={getColor(gc.categoria)}
                label={gc.categoria}
                valueLabel={`R$ ${fmtBRL(gc.totalMax)}`}
              />
            ))}
          </View>
        )}

        {/* COMPARATIVO POR PRODUTO */}
        {porProduto.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Comparativo por produto</Text>
            {porProduto.map(gp => {
              const minVal = gp.opcoes[0]?.valor_ha ?? 0;
              const maxVal = gp.opcoes[gp.opcoes.length - 1]?.valor_ha ?? 0;
              const maxBar = Math.max(maxVal, 1);

              return (
                <View key={gp.produto} style={s.produtoCard}>
                  <Text style={s.produtoNome} numberOfLines={2}>{gp.produto}</Text>
                  {gp.opcoes.map((op, idx) => {
                    const isMin = op.valor_ha === minVal && idx === 0;
                    const isMax =
                      op.valor_ha === maxVal &&
                      idx === gp.opcoes.length - 1 &&
                      gp.opcoes.length > 1;
                    const color = isMin ? '#2E7D32' : isMax ? '#C62828' : '#78909C';
                    return (
                      <HBar
                        key={op.id}
                        value={op.valor_ha}
                        max={maxBar}
                        color={color}
                        label={op.fornecedor}
                        valueLabel={`R$ ${fmtBRL(op.valor_ha)}`}
                        badge={isMin ? 'MENOR' : isMax ? 'MAIOR' : undefined}
                      />
                    );
                  })}
                </View>
              );
            })}
          </>
        )}

        {/* CATEGORIAS */}
        {porCategoria.length > 0 && (
          <>
            <Text style={[s.sectionTitle, { marginTop: 28 }]}>Faixa de preco por categoria</Text>
            {porCategoria.map(gc => (
              <View key={gc.categoria} style={s.catCard}>
                <View style={[s.catAccent, { borderLeftColor: getColor(gc.categoria) }]}>
                  <Text style={s.catNome}>{gc.categoria}</Text>
                  <Text style={s.catCount}>{gc.count} itens</Text>
                </View>
                <View style={s.catRange}>
                  <View style={s.catRangeCol}>
                    <Text style={s.catRangeLabel}>Menor</Text>
                    <Text style={[s.catRangeVal, { color: '#2E7D32' }]}>R$ {fmtBRL(gc.totalMin)}</Text>
                  </View>
                  <View style={s.catRangeDivider} />
                  <View style={s.catRangeCol}>
                    <Text style={s.catRangeLabel}>Maior</Text>
                    <Text style={[s.catRangeVal, { color: '#C62828' }]}>R$ {fmtBRL(gc.totalMax)}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}

        {/* CTA */}
        <View style={s.infoBox}>
          <Text style={s.infoTitle}>Proximo passo</Text>
          <Text style={s.infoText}>
            Compartilhe o link com o produtor via WhatsApp ou e-mail.
            Ele analisa os graficos no navegador e da o aceite por categoria.
            Voce recebe uma notificacao assim que ele confirmar.
          </Text>
          <TouchableOpacity style={s.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Text style={s.shareBtnText}>Enviar link agora</Text>
          </TouchableOpacity>
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
    paddingTop: 52,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: { paddingVertical: 4 },
  backText: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  shareHeaderBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  shareHeaderText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
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
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  linkBoxUrl: { fontSize: 12, color: '#81C784', fontWeight: '500' },
  copyBtn: { backgroundColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  copyBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E4EDE4',
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B8A6B',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8FA08F',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  produtoCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E4EDE4',
  },
  produtoNome: { fontSize: 14, fontWeight: '800', color: '#1A2E1A', marginBottom: 10 },
  catCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E4EDE4',
  },
  catAccent: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  catNome: { fontSize: 14, fontWeight: '800', color: '#1A2E1A' },
  catCount: { fontSize: 12, color: '#8FA08F', fontWeight: '600' },
  catRange: { flexDirection: 'row', alignItems: 'center' },
  catRangeCol: { flex: 1, alignItems: 'center' },
  catRangeDivider: { width: 1, height: 36, backgroundColor: '#E4EDE4', marginHorizontal: 8 },
  catRangeLabel: {
    fontSize: 10,
    color: '#8FA08F',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  catRangeVal: { fontSize: 16, fontWeight: '900' },
  infoBox: {
    backgroundColor: '#1F4E1F',
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  infoTitle: { fontSize: 13, fontWeight: '800', color: '#fff', marginBottom: 8 },
  infoText: { fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 20, marginBottom: 16 },
  shareBtn: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  shareBtnText: { fontSize: 14, fontWeight: '700', color: '#1F4E1F' },
});
"""

path = os.path.join(os.path.dirname(__file__), 'src', 'screens', 'CotacaoGraficosScreen.tsx')
with open(path, 'w', encoding='utf-8') as f:
    f.write(graficos)
print('CotacaoGraficosScreen (sem chart-kit) written OK')
