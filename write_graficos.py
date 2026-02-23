import os
path = os.path.join(os.path.dirname(__file__), 'src', 'screens', 'CotacaoGraficosScreen.tsx')

content = r"""import React, { useEffect, useState, useCallback } from 'react';
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
import { BarChart } from 'react-native-chart-kit';
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
  dose_ha: number | null;
  unidade: string | null;
  escolhido_produtor: boolean;
}

interface GrupoProduto {
  produto: string;
  opcoes: { fornecedor: string; valor_ha: number; id: string }[];
}

interface GrupoCategoria {
  categoria: string;
  totalMin: number;
  totalMax: number;
  itens: ItemCotacao[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CotacaoGraficos'>;
  route: RouteProp<RootStackParamList, 'CotacaoGraficos'>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 64;

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

const getColor = (categoria: string) =>
  CATEGORIA_COLORS[categoria] ?? CATEGORIA_COLORS.Outros;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CotacaoGraficosScreen({ navigation, route }: Props) {
  const { cotacaoId, shareToken } = route.params;
  const [itens, setItens] = useState<ItemCotacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [titulo, setTitulo] = useState('');

  // Build share URL — replace with your actual Supabase project URL
  const shareUrl = `https://seu-projeto.supabase.co/functions/v1/cotacao-viewer?token=${shareToken}`;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cotRes, itensRes] = await Promise.all([
        supabase.from('cotacoes').select('titulo').eq('id', cotacaoId).single(),
        supabase
          .from('itens_cotacao')
          .select('id, produto_nome, fornecedor, categoria, valor_ha, dose_ha, unidade, escolhido_produtor')
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

  // ---------------------------------------------------------------------------
  // Data processing
  // ---------------------------------------------------------------------------

  // Group by categoria
  const porCategoria: GrupoCategoria[] = React.useMemo(() => {
    const map: Record<string, ItemCotacao[]> = {};
    itens.forEach(it => {
      const cat = it.categoria ?? 'Outros';
      if (!map[cat]) map[cat] = [];
      map[cat].push(it);
    });
    return Object.entries(map).map(([categoria, items]) => {
      const valores = items.map(i => i.valor_ha ?? 0).filter(v => v > 0);
      return {
        categoria,
        totalMin: valores.length ? Math.min(...valores) : 0,
        totalMax: valores.length ? Math.max(...valores) : 0,
        itens: items,
      };
    });
  }, [itens]);

  // Group by produto — for each product show all supplier prices
  const porProduto: GrupoProduto[] = React.useMemo(() => {
    const map: Record<string, { fornecedor: string; valor_ha: number; id: string }[]> = {};
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

  // Chart data: total by categoria (min values summed)
  const chartData = React.useMemo(() => {
    if (!porCategoria.length) return null;
    const sorted = [...porCategoria].sort((a, b) => b.totalMax - a.totalMax);
    return {
      labels: sorted.map(g => g.categoria.substring(0, 6)),
      datasets: [{ data: sorted.map(g => g.totalMax) }],
      categorias: sorted,
    };
  }, [porCategoria]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Acesse sua cotacao: ${shareUrl}`,
        url: shareUrl,
        title: titulo,
      });
    } catch {
      // fallback — copy to clipboard
      await Clipboard.setStringAsync(shareUrl);
      Alert.alert('Link copiado', 'O link foi copiado para a area de transferencia.');
    }
  };

  const handleCopyLink = async () => {
    await Clipboard.setStringAsync(shareUrl);
    Alert.alert('Link copiado', 'Cole o link no WhatsApp, e-mail ou onde preferir.');
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
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

        {/* CHART: Total por categoria */}
        {chartData && chartData.datasets[0].data.some(v => v > 0) && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Valor maximo por categoria (R$/ha)</Text>
            <BarChart
              data={chartData}
              width={CHART_W}
              height={200}
              yAxisLabel="R$"
              yAxisSuffix=""
              chartConfig={{
                backgroundColor: '#fff',
                backgroundGradientFrom: '#fff',
                backgroundGradientTo: '#fff',
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(46, 125, 50, ${opacity})`,
                labelColor: () => '#6B8A6B',
                barPercentage: 0.65,
                propsForLabels: { fontSize: 10, fontWeight: '600' },
              }}
              style={{ borderRadius: 10, marginLeft: -16 }}
              fromZero
              showValuesOnTopOfBars
            />
          </View>
        )}

        {/* COMPARATIVO POR PRODUTO */}
        <Text style={s.sectionTitle}>Comparativo por produto</Text>
        {porProduto.map(gp => {
          const min = gp.opcoes[0]?.valor_ha ?? 0;
          const max = gp.opcoes[gp.opcoes.length - 1]?.valor_ha ?? 0;
          const amplitude = max - min;

          return (
            <View key={gp.produto} style={s.produtoCard}>
              <Text style={s.produtoNome} numberOfLines={2}>{gp.produto}</Text>

              {gp.opcoes.map((op, idx) => {
                const isMin = op.valor_ha === min && idx === 0;
                const isMax = op.valor_ha === max && idx === gp.opcoes.length - 1 && gp.opcoes.length > 1;
                const barPct = amplitude > 0 ? (op.valor_ha - min) / amplitude : 1;

                return (
                  <View key={op.id} style={s.opcaoRow}>
                    <Text style={s.opcaoFornecedor} numberOfLines={1}>{op.fornecedor}</Text>
                    <View style={s.barWrap}>
                      <View
                        style={[
                          s.bar,
                          {
                            width: `${Math.max(barPct * 100, 8)}%`,
                            backgroundColor: isMin ? '#2E7D32' : isMax ? '#C62828' : '#78909C',
                          },
                        ]}
                      />
                    </View>
                    <View style={s.opcaoValorWrap}>
                      <Text style={[s.opcaoValor, isMin && { color: '#2E7D32' }, isMax && { color: '#C62828' }]}>
                        R$ {op.valor_ha.toFixed(2)}
                      </Text>
                      {isMin && <Text style={s.badge}>MENOR</Text>}
                      {isMax && gp.opcoes.length > 1 && <Text style={[s.badge, s.badgeMax]}>MAIOR</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}

        {/* CATEGORIAS DETALHADAS */}
        <Text style={[s.sectionTitle, { marginTop: 28 }]}>Itens por categoria</Text>
        {porCategoria.map(gc => (
          <View key={gc.categoria} style={s.catCard}>
            <View style={[s.catHeader, { borderLeftColor: getColor(gc.categoria) }]}>
              <Text style={s.catNome}>{gc.categoria}</Text>
              <Text style={s.catCount}>{gc.itens.length} itens</Text>
            </View>
            <View style={s.catRange}>
              <Text style={s.catRangeLabel}>Faixa de preco/ha</Text>
              <Text style={s.catRangeVal}>
                <Text style={{ color: '#2E7D32', fontWeight: '900' }}>R$ {gc.totalMin.toFixed(2)}</Text>
                <Text style={{ color: '#8FA08F' }}> — </Text>
                <Text style={{ color: '#C62828', fontWeight: '900' }}>R$ {gc.totalMax.toFixed(2)}</Text>
              </Text>
            </View>
          </View>
        ))}

        {/* INSTRUCOES */}
        <View style={s.infoBox}>
          <Text style={s.infoTitle}>Proximo passo</Text>
          <Text style={s.infoText}>
            Compartilhe o link acima com o produtor via WhatsApp ou e-mail.
            Ele vai acessar no navegador, analisar os graficos e dar o aceite
            por categoria. Voce recebera uma notificacao assim que ele confirmar.
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
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  },
  shareHeaderText: { fontSize: 13, fontWeight: '700', color: '#fff' },

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
  linkBoxTitle: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 },
  linkBoxUrl: { fontSize: 12, color: '#81C784', fontWeight: '500' },
  copyBtn: { backgroundColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  copyBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E4EDE4',
  },
  cardTitle: {
    fontSize: 11, fontWeight: '800', color: '#6B8A6B',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 16,
  },

  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: '#8FA08F',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12,
  },

  // Produto comparison
  produtoCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E4EDE4',
  },
  produtoNome: { fontSize: 14, fontWeight: '800', color: '#1A2E1A', marginBottom: 12 },
  opcaoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  opcaoFornecedor: { width: 80, fontSize: 11, color: '#6B8A6B', fontWeight: '500' },
  barWrap: { flex: 1, height: 20, backgroundColor: '#F0F6F0', borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  opcaoValorWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 90, justifyContent: 'flex-end' },
  opcaoValor: { fontSize: 12, fontWeight: '700', color: '#3A5A3A' },
  badge: {
    fontSize: 8, fontWeight: '900', color: '#2E7D32',
    backgroundColor: '#E8F5E9', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
    letterSpacing: 0.5,
  },
  badgeMax: { color: '#C62828', backgroundColor: '#FFEBEE' },

  // Categoria card
  catCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E4EDE4',
  },
  catHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderLeftWidth: 3,
    paddingLeft: 10,
    marginBottom: 8,
  },
  catNome: { fontSize: 14, fontWeight: '800', color: '#1A2E1A' },
  catCount: { fontSize: 12, color: '#8FA08F', fontWeight: '600' },
  catRange: {},
  catRangeLabel: { fontSize: 11, color: '#8FA08F', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  catRangeVal: { fontSize: 15 },

  // Info box
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

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('CotacaoGraficosScreen written OK')
