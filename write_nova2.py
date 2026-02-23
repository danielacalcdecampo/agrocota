import os

content = r"""import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ItemRow {
  produto: string;
  fornecedor: string;
  categoria: string;
  valor_ha: number;
  dose: string;
  unidade: string;
}

type Step = 1 | 2;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'NovaCotacao'>;
};

// ---------------------------------------------------------------------------
// Valid categoria values (DB constraint)
// ---------------------------------------------------------------------------

// Smart category engine — sem lista fechada; aceita qualquer valor da planilha
// ---------------------------------------------------------------------------

const CATEGORY_ALIASES: Record<string, string> = {
  fungicida: 'Fungicida', fungicidas: 'Fungicida',
  inseticida: 'Inseticida', inseticidas: 'Inseticida',
  insecticida: 'Inseticida', insecticidas: 'Inseticida',
  herbicida: 'Herbicida', herbicidas: 'Herbicida', dessecante: 'Herbicida',
  acaricida: 'Acaricida', acaricidas: 'Acaricida',
  nematicida: 'Nematicida', nematicidas: 'Nematicida',
  semente: 'Semente', sementes: 'Semente', seed: 'Semente', seeds: 'Semente',
  'tratamento de sementes': 'Semente', 'trat. sementes': 'Semente',
  fertilizante: 'Fertilizante', fertilizantes: 'Fertilizante',
  adubo: 'Fertilizante', adubos: 'Fertilizante',
  corretivo: 'Fertilizante', corretivos: 'Fertilizante',
  calcario: 'Fertilizante', gesso: 'Fertilizante', micronutriente: 'Fertilizante',
  nutricao: 'Nutricao', 'nutricao foliar': 'Nutricao', foliar: 'Foliar', foliares: 'Foliar',
  adjuvante: 'Adjuvante', adjuvantes: 'Adjuvante',
  espalhante: 'Adjuvante', espalhantes: 'Adjuvante', 'oleo mineral': 'Adjuvante',
  regulador: 'Regulador', reguladores: 'Regulador',
  bioestimulante: 'Regulador', bioestimulantes: 'Regulador',
  outros: 'Outros', other: 'Outros', insumo: 'Outros',
};

const PRODUCT_HINTS: Array<[RegExp, string]> = [
  [/\b(soja|milho|trigo|sorgo|girassol|algodao|feijao|semente|hibrido|cultivar|var\.)\b/, 'Semente'],
  [/\b(ureia|npk|kcl|cloreto\s+de\s+potassio|superfosfato|fosfato|sulfato|calcario|gesso|micronutriente|boro|zinco|manganes|potassio|nitrogenio|fosforo|dap|map|ssp|tsp)\b/, 'Fertilizante'],
  [/\b(glifosato|atrazina|2,4-d|paraquate|diuron|metolacor|nicosulfuron|clethodim|haloxifope|tembotriona|clorimuron|dicamba|saflufenacil)\b/, 'Herbicida'],
  [/\b(tiametoxam|imidacloprido|clorpirifos|deltametrina|bifentrina|lambda|cihalotrina|espinosade|acetamiprid|fipronil|clorantraniliprole)\b/, 'Inseticida'],
  [/\b(trifloxistrobina|azoxistrobina|tebuconazol|propiconazol|carbendazim|mancozebe|tiofanato|difenoconazol|ciproconazol|picoxistrobina|fluxapiroxade|bixafen)\b/, 'Fungicida'],
  [/\b(abamectina|spiromesifen|clofentezina|bifenazate|dicofol)\b/, 'Acaricida'],
  [/\b(espalhante|adjuvante|nimbus|assist|aureo|agral|silwet)\b/, 'Adjuvante'],
  [/\b(stimulate|bioestimul|regulador|ethephon|trinexapac|prohexadion)\b/, 'Regulador'],
];

function stripAccents(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizarCategoria(raw: string, produtoNome?: string): string {
  const key = stripAccents((raw ?? '').toLowerCase().trim());
  if (key) {
    if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
    for (const [alias, cat] of Object.entries(CATEGORY_ALIASES)) {
      if (key.includes(stripAccents(alias))) return cat;
    }
    return (raw ?? '').trim().replace(/\S+/g, w =>
      w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    );
  }
  if (produtoNome) {
    const pn = stripAccents(produtoNome.toLowerCase());
    for (const [pattern, cat] of PRODUCT_HINTS) {
      if (pattern.test(pn)) return cat;
    }
  }
  return 'Outros';
}

// ---------------------------------------------------------------------------
// Auto-detect column index from header names
// ---------------------------------------------------------------------------

function autoDetectCols(
  headers: string[],
  sampleRows?: any[][],
): {
  produto: number; fornecedor: number; categoria: number;
  valor_ha: number; dose: number; unidade: number;
} {
  let produto = 0, fornecedor = -1, categoria = -1, valor_ha = 3, dose = -1, unidade = -1;
  headers.forEach((h, idx) => {
    const l = h.toLowerCase();
    if (l.includes('produto') || l.includes('product') || l.includes('insumo') ||
        l.includes('nome') || l.includes('item') || l.includes('descricao') ||
        l.includes('cultivo') || l.includes('marca')) produto = idx;
    else if (l.includes('fornecedor') || l.includes('empresa') || l.includes('supplier') ||
             l.includes('fabricante') || l.includes('brand')) fornecedor = idx;
    else if (l.includes('categoria') || l.includes('category') || l.includes('tipo') ||
             l.includes('grupo') || l.includes('classe') || l.includes('segmento')) categoria = idx;
    else if ((l.includes('valor') && l.includes('ha')) || l.includes('preco_ha') ||
             l.includes('r$/ha') || l.includes('preco/ha') || l.includes('/ha')) valor_ha = idx;
    else if (l.includes('preco') || l.includes('valor') || l.includes('custo')) {
      if (valor_ha === 3) valor_ha = idx; // fallback se ainda nao encontrou
    }
    else if (l.includes('dose') || l === 'kg/ha' || l === 'l/ha') dose = idx;
    else if (l.includes('unid') || l.includes('unit') || l === 'un' || l === 'kg') unidade = idx;
  });
  return { produto, fornecedor, categoria, valor_ha, dose, unidade };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function NovaCotacaoScreen({ navigation }: Props) {
  const { session } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);

  // Step 1 fields
  const [titulo, setTitulo] = useState('');
  const [obs, setObs] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [colDetect, setColDetect] = useState<ReturnType<typeof autoDetectCols>>({
    produto: 0, fornecedor: 1, categoria: 2, valor_ha: 3, dose: -1, unidade: -1,
  });

  // ---------------------------------------------------------------------------
  // Pick Excel
  // ---------------------------------------------------------------------------

  const handlePickExcel = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
          'application/csv',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: 'base64' as any,
      });

      const workbook = XLSX.read(base64, { type: 'base64' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, {
        header: 1,
        defval: '',
      });

      if (!jsonData.length) {
        Alert.alert('Arquivo vazio', 'O arquivo selecionado nao contem dados.');
        return;
      }

      const detectedHeaders = (jsonData[0] as any[]).map((h: any) => String(h ?? '').trim());
      const rows = jsonData
        .slice(1)
        .filter((row: any[]) => row.some((cell: any) => cell !== '' && cell != null)) as any[][];

      const detected = autoDetectCols(detectedHeaders);

      setHeaders(detectedHeaders);
      setRawRows(rows);
      setColDetect(detected);
      setFileName(asset.name ?? 'arquivo.xlsx');
    } catch (err: any) {
      Alert.alert('Erro ao importar', err?.message ?? 'Nao foi possivel ler o arquivo.');
    }
  };

  // ---------------------------------------------------------------------------
  // Process rows
  // ---------------------------------------------------------------------------

  const getProcessedItems = useCallback((): ItemRow[] => {
    const { produto, fornecedor, categoria, valor_ha, dose, unidade } = colDetect;
    return rawRows
      .map(row => {
        const nomeProduto = String(row[produto] ?? '').trim();
        const catRaw = categoria >= 0 ? String(row[categoria] ?? '') : '';
        return {
          produto: nomeProduto,
          fornecedor: fornecedor >= 0 ? String(row[fornecedor] ?? '').trim() : '',
          categoria: normalizarCategoria(catRaw, nomeProduto),
          valor_ha: parseFloat(String(row[valor_ha] ?? '0').replace(',', '.')) || 0,
          dose: dose >= 0 ? String(row[dose] ?? '').trim() : '',
          unidade: unidade >= 0 ? String(row[unidade] ?? '').trim() : '',
        };
      })
      .filter(it => it.produto && it.valor_ha > 0);
  }, [rawRows, colDetect]);

  // ---------------------------------------------------------------------------
  // Save to Supabase
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!titulo.trim()) {
      Alert.alert('Campo obrigatorio', 'Informe um titulo para a cotacao.');
      return;
    }
    if (!session?.user?.id) return;

    const items = getProcessedItems();
    if (!items.length) {
      Alert.alert('Sem dados', 'Nenhum item valido encontrado na planilha.');
      return;
    }

    setSaving(true);
    try {
      const token =
        Math.random().toString(36).substring(2) +
        Date.now().toString(36) +
        Math.random().toString(36).substring(2);

      const { data: cotacao, error: cotErr } = await supabase
        .from('cotacoes')
        .insert({
          consultor_id: session.user.id,
          titulo: titulo.trim(),
          observacoes: obs.trim() || null,
          status: 'rascunho',
          approval_token: token,
        })
        .select('id')
        .single();

      if (cotErr) throw cotErr;

      const itens = items.map(it => ({
        cotacao_id: cotacao.id,
        produto_nome: it.produto,
        fornecedor: it.fornecedor,
        categoria: it.categoria,
        valor_ha: it.valor_ha,
        dose_ha: it.dose ? parseFloat(it.dose.replace(',', '.')) || null : null,
        unidade: it.unidade || null,
        quantidade: 1,
        preco_unitario: it.valor_ha,
      }));

      const { error: itensErr } = await supabase.from('itens_cotacao').insert(itens);
      if (itensErr) throw itensErr;

      navigation.replace('CotacaoGraficos', { cotacaoId: cotacao.id, shareToken: token });
    } catch (err: any) {
      Alert.alert('Erro ao salvar', err?.message ?? 'Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Computed stats
  // ---------------------------------------------------------------------------

  const items = getProcessedItems();
  const uniqueProdutos = new Set(items.map(it => it.produto)).size;
  const uniqueFornecedores = new Set(items.map(it => it.fornecedor)).size;
  const uniqueCategorias = new Set(items.map(it => it.categoria)).size;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor="#1A3C1A" />

      {/* HEADER */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={s.backText}>Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Nova Cotacao</Text>
        <View style={{ width: 56 }} />
      </View>

      {/* STEP INDICATOR */}
      <View style={s.stepBar}>
        {([1, 2] as Step[]).map(n => (
          <React.Fragment key={n}>
            <View style={[s.stepDot, step >= n && s.stepDotActive]}>
              <Text style={[s.stepNum, step >= n && s.stepNumActive]}>{n}</Text>
            </View>
            {n < 2 && (
              <View style={[s.stepLine, step > n && s.stepLineActive]} />
            )}
          </React.Fragment>
        ))}
      </View>
      <View style={s.stepLabelRow}>
        <Text style={[s.stepLabel, step === 1 && s.stepLabelActive]}>Importar</Text>
        <Text style={[s.stepLabel, step === 2 && s.stepLabelActive]}>Confirmar</Text>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── STEP 1 ─────────────────────────────────────── */}
        {step === 1 && (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>Identificacao</Text>
              <Text style={s.fieldLabel}>Titulo da cotacao</Text>
              <TextInput
                style={s.input}
                value={titulo}
                onChangeText={setTitulo}
                placeholder="Ex: Cotacao Soja 24/25"
                placeholderTextColor="#B8C8B8"
              />
              <Text style={s.fieldLabel}>Observacoes</Text>
              <TextInput
                style={[s.input, s.inputMulti]}
                value={obs}
                onChangeText={setObs}
                placeholder="Notas gerais..."
                placeholderTextColor="#B8C8B8"
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Importar planilha</Text>
              <Text style={s.helpText}>
                Importe um arquivo Excel (.xlsx) ou CSV com as cotacoes.
                O sistema detecta as colunas automaticamente.
              </Text>

              <TouchableOpacity style={s.importBtn} onPress={handlePickExcel} activeOpacity={0.85}>
                <Text style={s.importBtnTitle}>
                  {fileName ? 'Trocar arquivo' : 'Selecionar arquivo'}
                </Text>
                <Text style={s.importBtnSub}>
                  {fileName ? `Selecionado: ${fileName}` : '.xlsx, .xls ou .csv'}
                </Text>
              </TouchableOpacity>

              {rawRows.length > 0 && (
                <View style={s.fileInfo}>
                  <View style={s.fileInfoRow}>
                    <Text style={s.fileInfoNum}>{rawRows.length}</Text>
                    <Text style={s.fileInfoLabel}>linhas</Text>
                  </View>
                  <View style={s.fileInfoSep} />
                  <View style={s.fileInfoRow}>
                    <Text style={s.fileInfoNum}>{headers.length}</Text>
                    <Text style={s.fileInfoLabel}>colunas</Text>
                  </View>
                  <View style={s.fileInfoSep} />
                  <View style={s.fileInfoRow}>
                    <Text style={[s.fileInfoNum, { color: '#2E7D32' }]}>{items.length}</Text>
                    <Text style={s.fileInfoLabel}>itens validos</Text>
                  </View>
                </View>
              )}

              {headers.length > 0 && (
                <View style={s.previewWrap}>
                  <Text style={s.previewTitle}>Pre-visualizacao (3 primeiras linhas)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={[s.previewRow, s.previewHeaderRow]}>
                        {headers.slice(0, 6).map((h, i) => (
                          <Text key={i} style={s.previewHeaderCell} numberOfLines={1}>
                            {h || `Col${i + 1}`}
                          </Text>
                        ))}
                      </View>
                      {rawRows.slice(0, 3).map((row, ri) => (
                        <View key={ri} style={s.previewRow}>
                          {(row as any[]).slice(0, 6).map((cell, ci) => (
                            <Text key={ci} style={s.previewCell} numberOfLines={1}>
                              {String(cell ?? '-')}
                            </Text>
                          ))}
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[s.nextBtn, (!titulo.trim() || !rawRows.length) && s.nextBtnDisabled]}
              onPress={() => {
                if (!titulo.trim()) {
                  Alert.alert('Titulo obrigatorio', 'Preencha o titulo antes de continuar.');
                  return;
                }
                if (!rawRows.length) {
                  Alert.alert('Arquivo necessario', 'Selecione a planilha antes de continuar.');
                  return;
                }
                if (!items.length) {
                  Alert.alert('Sem itens', 'Nenhum item foi reconhecido na planilha. Verifique se o arquivo possui colunas de produto e valor.');
                  return;
                }
                setStep(2);
              }}
              activeOpacity={0.85}
            >
              <Text style={s.nextBtnText}>Continuar</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── STEP 2 ─────────────────────────────────────── */}
        {step === 2 && (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>Resumo da importacao</Text>
              <Text style={s.summaryTitulo}>{titulo}</Text>

              <View style={s.statsGrid}>
                <View style={s.statBox}>
                  <Text style={s.statBig}>{items.length}</Text>
                  <Text style={s.statSub}>Itens importados</Text>
                </View>
                <View style={s.statBox}>
                  <Text style={s.statBig}>{uniqueProdutos}</Text>
                  <Text style={s.statSub}>Produtos unicos</Text>
                </View>
                <View style={s.statBox}>
                  <Text style={s.statBig}>{uniqueFornecedores}</Text>
                  <Text style={s.statSub}>Fornecedores</Text>
                </View>
                <View style={s.statBox}>
                  <Text style={s.statBig}>{uniqueCategorias}</Text>
                  <Text style={s.statSub}>Categorias</Text>
                </View>
              </View>
            </View>

            {/* Mini preview of processed items */}
            {items.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Itens reconhecidos</Text>
                <View style={[s.previewRow, s.previewHeaderRow]}>
                  <Text style={[s.previewHeaderCell, { flex: 2 }]}>Produto</Text>
                  <Text style={[s.previewHeaderCell, { flex: 1.5 }]}>Fornecedor</Text>
                  <Text style={[s.previewHeaderCell, { flex: 1 }]}>Categoria</Text>
                  <Text style={[s.previewHeaderCell, { flex: 1 }]}>R$/ha</Text>
                </View>
                {items.slice(0, 6).map((it, i) => (
                  <View key={i} style={s.previewRow}>
                    <Text style={[s.previewCell, { flex: 2 }]} numberOfLines={1}>{it.produto}</Text>
                    <Text style={[s.previewCell, { flex: 1.5 }]} numberOfLines={1}>{it.fornecedor}</Text>
                    <Text style={[s.previewCell, { flex: 1 }]} numberOfLines={1}>{it.categoria}</Text>
                    <Text style={[s.previewCell, { flex: 1 }]}>{it.valor_ha.toFixed(2)}</Text>
                  </View>
                ))}
                {items.length > 6 && (
                  <Text style={s.moreText}>+ {items.length - 6} itens</Text>
                )}
              </View>
            )}

            <View style={s.card}>
              <Text style={s.cardTitle}>O que vai acontecer</Text>
              <StepInfo n="1" text="Os dados sao salvos no sistema" />
              <StepInfo n="2" text="Graficos de comparacao sao gerados automaticamente" />
              <StepInfo n="3" text="Um link unico e criado para compartilhar com o produtor" />
              <StepInfo n="4" text="O produtor abre no navegador, analisa e da o aceite por categoria" />
              <StepInfo n="5" text="Voce recebe uma notificacao quando o produtor aceitar" />
            </View>

            <View style={s.btnRow}>
              <TouchableOpacity style={s.backStepBtn} onPress={() => setStep(1)} activeOpacity={0.8}>
                <Text style={s.backStepText}>Voltar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.nextBtn, { flex: 1 }, saving && s.nextBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={s.nextBtnText}>Salvar e ver graficos</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// StepInfo
// ---------------------------------------------------------------------------

function StepInfo({ n, text }: { n: string; text: string }) {
  return (
    <View style={si.row}>
      <View style={si.badge}>
        <Text style={si.badgeText}>{n}</Text>
      </View>
      <Text style={si.text}>{text}</Text>
    </View>
  );
}

const si = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  badge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#E8F5E9', alignItems: 'center',
    justifyContent: 'center', marginRight: 12, marginTop: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '800', color: '#2E7D32' },
  text: { flex: 1, fontSize: 13, color: '#3A5A3A', lineHeight: 20 },
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6F4' },
  header: {
    backgroundColor: '#1F4E1F',
    paddingTop: 52,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: { width: 56, paddingVertical: 4 },
  backText: { fontSize: 14, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  stepBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F4E1F',
    paddingBottom: 20,
    paddingHorizontal: 80,
  },
  stepDot: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: '#fff' },
  stepNum: { fontSize: 13, fontWeight: '800', color: 'rgba(255,255,255,0.4)' },
  stepNumActive: { color: '#2E7D32' },
  stepLine: { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 6 },
  stepLineActive: { backgroundColor: '#fff' },
  stepLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#1F4E1F',
    paddingBottom: 16,
    paddingHorizontal: 8,
  },
  stepLabel: { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '600', textAlign: 'center', flex: 1 },
  stepLabelActive: { color: '#fff' },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
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
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: '#6B8A6B',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5,
  },
  input: {
    backgroundColor: '#F7FAF7',
    borderWidth: 1,
    borderColor: '#E4EDE4',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#1A2E1A',
    marginBottom: 12,
  },
  inputMulti: { height: 72, textAlignVertical: 'top' },
  helpText: { fontSize: 13, color: '#6B8A6B', lineHeight: 20, marginBottom: 16 },
  importBtn: {
    borderWidth: 1.5,
    borderColor: '#2E7D32',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  importBtnTitle: { fontSize: 15, fontWeight: '700', color: '#2E7D32', marginBottom: 3 },
  importBtnSub: { fontSize: 12, color: '#8FA08F' },
  fileInfo: {
    flexDirection: 'row',
    backgroundColor: '#F2FAF2',
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 16,
  },
  fileInfoRow: { flex: 1, alignItems: 'center' },
  fileInfoNum: { fontSize: 20, fontWeight: '900', color: '#1A2E1A' },
  fileInfoLabel: { fontSize: 10, color: '#6B8A6B', marginTop: 2, fontWeight: '600', textTransform: 'uppercase' },
  fileInfoSep: { width: 1, backgroundColor: '#C8DEC8', marginVertical: 4 },
  previewWrap: {
    backgroundColor: '#F7FAF7', borderRadius: 10,
    overflow: 'hidden', borderWidth: 1, borderColor: '#E4EDE4',
  },
  previewTitle: {
    fontSize: 11, fontWeight: '700', color: '#6B8A6B',
    textTransform: 'uppercase', letterSpacing: 0.8,
    padding: 10, borderBottomWidth: 1, borderBottomColor: '#E4EDE4',
  },
  previewHeaderRow: { backgroundColor: '#EBF3EB' },
  previewRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F6F0' },
  previewHeaderCell: { width: 100, paddingHorizontal: 8, paddingVertical: 7, fontSize: 11, fontWeight: '700', color: '#3A5A3A' },
  previewCell: { width: 100, paddingHorizontal: 8, paddingVertical: 7, fontSize: 12, color: '#4A6A4A' },
  moreText: { fontSize: 11, color: '#8FA08F', textAlign: 'center', paddingVertical: 8, fontStyle: 'italic' },
  summaryTitulo: { fontSize: 17, fontWeight: '800', color: '#1A2E1A', marginBottom: 18 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statBox: {
    flex: 1, minWidth: '45%',
    backgroundColor: '#F2FAF2', borderRadius: 12, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#D8EAD8',
  },
  statBig: { fontSize: 28, fontWeight: '900', color: '#2E7D32' },
  statSub: { fontSize: 11, color: '#6B8A6B', marginTop: 3, textAlign: 'center', fontWeight: '600' },
  nextBtn: {
    backgroundColor: '#2E7D32',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 14,
  },
  nextBtnDisabled: { backgroundColor: '#B8C8B8' },
  nextBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  btnRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  backStepBtn: {
    borderWidth: 1.5, borderColor: '#C8D8C8',
    borderRadius: 12, paddingVertical: 15, paddingHorizontal: 20, alignItems: 'center',
  },
  backStepText: { fontSize: 15, fontWeight: '700', color: '#6B8A6B' },
});
"""

path = os.path.join(os.path.dirname(__file__), 'src', 'screens', 'NovaCotacaoScreen.tsx')
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('NovaCotacaoScreen (2 steps, auto-detect) written OK')
