import React, { useState, useCallback, useEffect } from 'react';
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
  Modal,
  FlatList,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
const SUMMARY_PREVIEW_LIMIT = 4;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'NovaCotacao'>;
};

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Categoria: usa EXATAMENTE o que vier na planilha (sem forcár em lista fechada)
// ---------------------------------------------------------------------------

/**
 * Normaliza a categoria: preserva o valor original da planilha em Title Case.
 * Se não houver categoria, retorna 'Insumo' (genérico, nunca descarta o item).
 */
function normalizarCategoria(raw: string): string {
  const v = (raw ?? '').trim();
  if (!v) return 'Insumo';
  // Title Case simples: "HERBICIDA" → "Herbicida", "tratamento de sementes" → "Tratamento De Sementes"
  return v.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ---------------------------------------------------------------------------
// Auto-detect column index from header names
// ---------------------------------------------------------------------------

/** Strip accents and lowercase */
function normH(h: string) {
  return h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function autoDetectCols(
  headers: string[],
  sampleRows?: any[][],
): {
  produto: number; fornecedor: number; categoria: number;
  valor_ha: number; dose: number; unidade: number;
} {
  const nh = headers.map(normH);

  const first = (test: (h: string) => boolean, exclude?: (h: string) => boolean): number =>
    nh.findIndex(h => test(h) && (!exclude || !exclude(h)));

  // ── produto ───────────────────────────────────────────────────────────────
  const produto = (() => {
    // 1. coluna nomeada
    const byName = first(
      h => h.includes('produto') || h.includes('product') || h.includes('insumo') ||
           h.includes('nome') || h.includes('item') || h.includes('descricao') ||
           h.includes('cultivo') || h.includes('cultura') || h.includes('marca'),
      h => h.includes('dose') || h.includes('kg/ha') || h.includes('total') ||
           h.includes('custo') || h.includes('preco') || h.includes('valor'),
    );
    if (byName >= 0) return byName;
    // 2. fallback: primeira coluna com texto (não numérica) nos dados
    if (sampleRows?.length) {
      for (let ci = 0; ci < headers.length; ci++) {
        const vals = sampleRows.slice(0, 5).map(r => String(r[ci] ?? ''));
        if (vals.some(v => v.trim() && isNaN(Number(v.replace(',', '.'))))) return ci;
      }
    }
    return 0;
  })();

  // ── fornecedor ────────────────────────────────────────────────────────────
  const fornecedor = first(
    h => h.includes('fornecedor') || h.includes('empresa') || h.includes('supplier') ||
         h.includes('fabricante') || h.includes('marca') || h.includes('brand'),
  );

  // ── categoria ─────────────────────────────────────────────────────────────
  const categoria = first(
    h => h.includes('categoria') || h.includes('category') || h.includes('tipo') ||
         h.includes('grupo') || h.includes('classe') || h.includes('class') ||
         h.includes('segmento') || h.includes('finalidade'),
  );

  // ── valor_ha ──────────────────────────────────────────────────────────────
  const valor_ha = (() => {
    // P1: explicit /ha label  (sem total)
    const p1 = first(
      h => (h.includes('r$/ha') || h.includes('preco/ha') || h.includes('valor/ha') ||
            h.includes('preco_ha') || h.includes('valor_ha') || h.includes('custo_ha') ||
            h.includes('/ha')) && !h.includes('total'),
    );
    if (p1 >= 0) return p1;
    // P2: (valor|preco|custo) + ha
    const p2 = first(
      h => (h.includes('valor') || h.includes('preco') || h.includes('custo')) &&
           h.includes('ha') && !h.includes('total'),
    );
    if (p2 >= 0) return p2;
    // P3: any price column
    const p3 = first(
      h => h.includes('preco') || h.includes('valor') || h.includes('custo') || h.includes('price'),
      h => h.includes('total'),
    );
    if (p3 >= 0) return p3;
    // P4: fallback — primeira coluna numérica diferente de produto
    if (sampleRows?.length) {
      for (let ci = 0; ci < headers.length; ci++) {
        if (ci === produto) continue;
        const vals = sampleRows.slice(0, 5).map(r =>
          parseFloat(String(r[ci] ?? '').replace(',', '.')));
        if (vals.filter(v => !isNaN(v) && v > 0).length >= 2) return ci;
      }
    }
    return 3;
  })();

  // ── dose / unidade ────────────────────────────────────────────────────────
  const dose = first(
    h => h.includes('dose') || h === 'kg/ha' || h === 'l/ha' ||
         (h.includes('produto') && (h.includes('kg') || h.includes('dose'))),
  );
  const unidade = first(
    h => h.includes('unid') || h.includes('unit') || h === 'un' || h === 'kg' || h === 'l',
  );

  return {
    produto: produto >= 0 ? produto : 0,
    fornecedor: fornecedor >= 0 ? fornecedor : -1,
    categoria: categoria >= 0 ? categoria : -1,
    valor_ha,
    dose,
    unidade,
  };
}

function parseMoneyLike(raw: any): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const txt = String(raw ?? '').trim();
  if (!txt) return NaN;

  const cleaned = txt
    .replace(/r\$|rs\$|usd|brl/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9,.-]/g, '');

  if (!cleaned) return NaN;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  if (cleaned.includes(',')) {
    const parsed = parseFloat(cleaned.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isLikelyNoiseProduct(name: string): boolean {
  const v = String(name ?? '').trim();
  if (!v) return true;
  const n = normH(v);

  if (v.length > 120) return true;
  if (/^[-_=/*\\.\s]+$/.test(v)) return true;
  if (/^\d+[\d\s.,-]*$/.test(v)) return true;
  if (/(observac|anotac|obs\b|coment|nota\b|resumo|legenda|informac|detalhe)/.test(n)) return true;
  if (/(total|subtotal|soma|resultado|conclusao|assinatura|aprovado)/.test(n)) return true;
  if (/(sacas?\/?ha|kg\/?ha|l\/?ha|ha\b|hectare)/.test(n) && v.split(' ').length <= 3) return true;

  return false;
}

function inferPriceUnit(headerName: string, row: any[], unitCol: number): string {
  const h = normH(headerName);
  if (h.includes('/ha') || h.includes('ha')) return 'R$/ha';
  if (h.includes('/l') || h.includes(' litro') || h.endsWith(' l')) return 'R$/L';
  if (h.includes('/kg') || h.endsWith(' kg')) return 'R$/kg';
  if (h.includes('/sc') || h.includes('saca')) return 'R$/saca';
  if (h.includes('/un') || h.includes('unit')) return 'R$/un';
  if (h.includes('total')) return 'R$ total';

  const fromCol = unitCol >= 0 ? String(row[unitCol] ?? '').trim() : '';
  if (fromCol) return fromCol;
  return 'R$/ha';
}

function findHeaderRowIndex(matrix: any[][]): number {
  const maxScan = Math.min(matrix.length, 25);
  let bestIndex = 0;
  let bestScore = -1;

  for (let ri = 0; ri < maxScan; ri++) {
    const row = matrix[ri] ?? [];
    const values = row.map(c => String(c ?? '').trim()).filter(Boolean);
    if (!values.length) continue;

    const normalized = values.map(normH);
    const headerHits = normalized.filter(h =>
      h.includes('produto') || h.includes('descricao') || h.includes('item') ||
      h.includes('fornecedor') || h.includes('categoria') || h.includes('valor') ||
      h.includes('preco') || h.includes('custo') || h.includes('dose') ||
      h.includes('unid') || h.includes('/ha')
    ).length;

    const textish = values.filter(v => isNaN(parseMoneyLike(v))).length;
    const score = headerHits * 5 + textish + Math.min(values.length, 12);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = ri;
    }
  }

  return bestIndex;
}

function parseSheetRows(
  sheetName: string,
  headers: string[],
  rows: any[][],
  detected: ReturnType<typeof autoDetectCols>,
): ItemRow[] {
  const { produto: cProd, fornecedor: cForn, categoria: cCat, valor_ha: cVha, dose: cDose, unidade: cUnid } = detected;

  const numericCandidates: number[] = [];
  const nh = headers.map(normH);
  const idxVolume = nh.findIndex(h => h.includes('volume') || h.includes('embal') || h.includes('tamanho') || h.includes('conteudo') || h.includes('litro') || h.includes('l ') || h.endsWith(' l') || h.includes('ml') || h.includes('kg') || h.includes('g '));
  const idxFinalidade = nh.findIndex(h => h.includes('finalidade') || h.includes('aplicacao') || h.includes('aplica') || h.includes('uso') || h.includes('serve') || h.includes('indicacao'));

  nh.forEach((h, i) => {
    const isMoney = h.includes('valor') || h.includes('preco') || h.includes('custo') || h.includes('r$') || h.includes('price');
    if (isMoney && i !== cProd && i !== cForn && i !== cCat) numericCandidates.push(i);
  });

  if (!numericCandidates.includes(cVha)) numericCandidates.unshift(cVha);

  for (let ci = 0; ci < headers.length; ci++) {
    if (ci === cProd || ci === cForn || ci === cCat) continue;
    if (numericCandidates.includes(ci)) continue;
    const hits = rows.slice(0, 12).filter(r => {
      const v = parseMoneyLike(r[ci]);
      return !isNaN(v) && v > 0;
    }).length;
    if (hits >= 2) numericCandidates.push(ci);
  }

  return rows
    .map((row): ItemRow | null => {
      const produtoBase = String(row[cProd] ?? '').trim();
      if (isLikelyNoiseProduct(produtoBase)) return null;

      const volumeTxt = idxVolume >= 0 ? String(row[idxVolume] ?? '').trim() : '';
      const finalidadeTxt = idxFinalidade >= 0 ? String(row[idxFinalidade] ?? '').trim() : '';

      const produtoRaw = [
        produtoBase,
        volumeTxt ? `[${volumeTxt}]` : '',
        finalidadeTxt ? `- ${finalidadeTxt}` : '',
      ].filter(Boolean).join(' ').trim();

      const catCell = cCat >= 0 ? String(row[cCat] ?? '').trim() : '';
      const categoria = normalizarCategoria(catCell || sheetName || 'Insumo');

      let valor = NaN;
      let usedCol = cVha;
      for (const ci of numericCandidates) {
        const parsed = parseMoneyLike(row[ci]);
        if (!isNaN(parsed) && parsed > 0) {
          valor = parsed;
          usedCol = ci;
          break;
        }
      }

      if (isNaN(valor) || valor <= 0) return null;

      const unidade = inferPriceUnit(headers[usedCol] ?? '', row, cUnid);

      return {
        produto: produtoRaw,
        fornecedor: cForn >= 0 ? String(row[cForn] ?? '').trim() : '',
        categoria,
        valor_ha: valor,
        dose: cDose >= 0 ? String(row[cDose] ?? '').trim() : '',
        unidade,
      };
    })
    .filter((it): it is ItemRow => !!it);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function NovaCotacaoScreen({ navigation }: Props) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);

  // Step 1 fields
  const [titulo, setTitulo] = useState('');
  const [obs, setObs] = useState('');
  const [fazendaIdCot, setFazendaIdCot] = useState('');
  const [fazendas, setFazendas] = useState<{ id: string; nome: string }[]>([]);
  const [modalFazenda, setModalFazenda] = useState(false);

  useEffect(() => {
    supabase.from('fazendas').select('id,nome').order('nome').then(({ data }) => {
      setFazendas((data ?? []) as { id: string; nome: string }[]);
    });
  }, []);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [parsedItems, setParsedItems] = useState<ItemRow[]>([]);
  const [sheetSummary, setSheetSummary] = useState<{ nome: string; itens: number }[]>([]);
  const [categorySummary, setCategorySummary] = useState<{ nome: string; itens: number }[]>([]);
  const [showAllSheets, setShowAllSheets] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);

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
      if (!workbook.SheetNames.length) {
        Alert.alert('Arquivo vazio', 'O arquivo selecionado nao contem dados.');
        return;
      }

      const allParsed: ItemRow[] = [];
      const perSheet: Record<string, number> = {};

      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) return;

        const matrix = XLSX.utils.sheet_to_json<any[]>(worksheet, {
          header: 1,
          defval: '',
          raw: true,
        }) as any[][];

        if (!matrix.length) return;

        const headerRowIndex = findHeaderRowIndex(matrix);
        const detectedHeaders = (matrix[headerRowIndex] ?? []).map((h: any) => String(h ?? '').trim());
        const dataRows = matrix
          .slice(headerRowIndex + 1)
          .filter((row: any[]) => row.some((cell: any) => String(cell ?? '').trim() !== '')) as any[][];

        if (!detectedHeaders.length || !dataRows.length) return;

        const detected = autoDetectCols(detectedHeaders, dataRows);
        const parsed = parseSheetRows(sheetName, detectedHeaders, dataRows, detected);
        allParsed.push(...parsed);
        perSheet[sheetName] = (perSheet[sheetName] ?? 0) + parsed.length;
      });

      if (!allParsed.length) {
        Alert.alert(
          'Sem itens validos',
          'Nao foi possivel identificar produtos com valor valido nas abas da planilha. Verifique cabecalhos e valores.'
        );
        return;
      }

      setShowAllSheets(false);
      setShowAllCategories(false);

      const previewHeaders = ['Produto', 'Fornecedor', 'Categoria', 'Valor', 'Dose', 'Unidade'];
      const previewRows = allParsed.map(it => [
        it.produto,
        it.fornecedor,
        it.categoria,
        it.valor_ha,
        it.dose,
        it.unidade,
      ]);

      setHeaders(previewHeaders);
      setRawRows(previewRows);
      setParsedItems(allParsed);

      const sheetItems = Object.entries(perSheet)
        .filter(([, itens]) => itens > 0)
        .map(([nome, itens]) => ({ nome, itens }))
        .sort((a, b) => b.itens - a.itens);

      const catMap: Record<string, number> = {};
      allParsed.forEach(it => {
        const cat = it.categoria || 'Insumo';
        catMap[cat] = (catMap[cat] ?? 0) + 1;
      });

      const catItems = Object.entries(catMap)
        .map(([nome, itens]) => ({ nome, itens }))
        .sort((a, b) => b.itens - a.itens);

      setSheetSummary(sheetItems);
      setCategorySummary(catItems);
      setFileName(asset.name ?? 'arquivo.xlsx');
    } catch (err: any) {
      Alert.alert('Erro ao importar', err?.message ?? 'Nao foi possivel ler o arquivo.');
    }
  };

  // ---------------------------------------------------------------------------
  // Process rows
  // ---------------------------------------------------------------------------

  const getProcessedItems = useCallback((): ItemRow[] => {
    return parsedItems;
  }, [parsedItems]);

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
          fazenda_id: fazendaIdCot || null,
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
  const visibleSheetSummary = showAllSheets ? sheetSummary : sheetSummary.slice(0, SUMMARY_PREVIEW_LIMIT);
  const visibleCategorySummary = showAllCategories ? categorySummary : categorySummary.slice(0, SUMMARY_PREVIEW_LIMIT);

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
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={s.backText}>‹  Voltar</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Nova Cotacao</Text>
        <View style={{ width: 88 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
              <Text style={s.fieldLabel}>Propriedade vinculada</Text>
              <TouchableOpacity
                style={s.selectorBtn}
                onPress={() => setModalFazenda(true)}
                activeOpacity={0.8}
              >
                <Text style={[s.selectorBtnTxt, !fazendaIdCot && { color: '#B8C8B8' }]}>
                  {fazendaIdCot
                    ? (fazendas.find(f => f.id === fazendaIdCot)?.nome ?? 'Propriedade')
                    : 'Selecionar propriedade...'}
                </Text>
                <Text style={s.selectorArrow}>›</Text>
              </TouchableOpacity>
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

              {(sheetSummary.length > 0 || categorySummary.length > 0) && (
                <View style={s.importSummaryWrap}>
                  {sheetSummary.length > 0 && (
                    <>
                      <View style={s.importSummaryHeaderRow}>
                        <Text style={s.importSummaryTitle}>Itens por aba</Text>
                        {sheetSummary.length > SUMMARY_PREVIEW_LIMIT && (
                          <TouchableOpacity
                            style={s.importSummaryToggleBtn}
                            onPress={() => setShowAllSheets(v => !v)}
                            activeOpacity={0.8}
                          >
                            <Text style={s.importSummaryToggleTxt}>
                              {showAllSheets ? 'Ver menos' : `Ver mais (${sheetSummary.length})`}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={s.importSummaryList}>
                        {visibleSheetSummary.map(sht => (
                          <View key={sht.nome} style={s.importSummaryChip}>
                            <Text style={s.importSummaryName} numberOfLines={1}>{sht.nome}</Text>
                            <Text style={s.importSummaryCount}>{sht.itens}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}

                  {categorySummary.length > 0 && (
                    <>
                      <View style={[s.importSummaryHeaderRow, { marginTop: 10 }]}>
                        <Text style={s.importSummaryTitle}>Itens por categoria</Text>
                        {categorySummary.length > SUMMARY_PREVIEW_LIMIT && (
                          <TouchableOpacity
                            style={s.importSummaryToggleBtn}
                            onPress={() => setShowAllCategories(v => !v)}
                            activeOpacity={0.8}
                          >
                            <Text style={s.importSummaryToggleTxt}>
                              {showAllCategories ? 'Ver menos' : `Ver mais (${categorySummary.length})`}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={s.importSummaryList}>
                        {visibleCategorySummary.map(cat => (
                          <View key={cat.nome} style={s.importSummaryChip}>
                            <Text style={s.importSummaryName} numberOfLines={1}>{cat.nome}</Text>
                            <Text style={s.importSummaryCount}>{cat.itens}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[s.nextBtn, (!titulo.trim() || !rawRows.length || saving) && s.nextBtnDisabled]}
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
        </>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Modal: selecionar propriedade ── */}
      <Modal
        visible={modalFazenda}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setModalFazenda(false)}
      >
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setModalFazenda(false)}>
          <View style={[s.modalCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Propriedade</Text>
              <TouchableOpacity onPress={() => setModalFazenda(false)}>
                <Text style={s.modalDone}>Feito</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={[{ id: '', nome: 'Sem propriedade (geral)' }, ...fazendas]}
              keyExtractor={f => f.id}
              renderItem={({ item, index }) => {
                const sel = fazendaIdCot === item.id;
                return (
                  <TouchableOpacity
                    style={[s.modalRow, index > 0 && s.modalRowBorder]}
                    onPress={() => { setFazendaIdCot(item.id); setModalFazenda(false); }}
                    activeOpacity={0.7}
                  >
                    <View style={[s.modalRadio, sel && s.modalRadioSel]}>
                      {sel && <View style={s.modalRadioDot} />}
                    </View>
                    <Text style={[s.modalRowTxt, sel && s.modalRowTxtSel]}>{item.nome}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
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
    paddingTop: 14,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    minWidth: 88, alignItems: 'center',
  },
  backText: { fontSize: 14, color: '#A5D6A7', fontWeight: '700' },
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
  importSummaryWrap: {
    backgroundColor: '#F7FAF7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E4EDE4',
    padding: 12,
    marginBottom: 14,
  },
  importSummaryTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B8A6B',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  importSummaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  importSummaryToggleBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C8DEC8',
    backgroundColor: '#FFFFFF',
    marginBottom: 6,
  },
  importSummaryToggleTxt: {
    fontSize: 10,
    color: '#2E7D32',
    fontWeight: '700',
  },
  importSummaryList: {
    gap: 8,
  },
  importSummaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4EDE4',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  importSummaryName: {
    flex: 1,
    fontSize: 12,
    color: '#3A5A3A',
    fontWeight: '600',
    marginRight: 8,
  },
  importSummaryCount: {
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '900',
  },
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

  selectorBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F7FAF7', borderWidth: 1, borderColor: '#E4EDE4', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12 },
  selectorBtnTxt: { fontSize: 14, color: '#1A2E1A', flex: 1 },
  selectorArrow: { fontSize: 20, color: '#B8C8B8', marginLeft: 4 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '72%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#F0F2F0' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1A2E1A' },
  modalDone: { fontSize: 15, color: '#2E7D32', fontWeight: '700' },
  modalRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 14 },
  modalRowBorder: { borderTopWidth: 1, borderTopColor: '#F5F5F5' },
  modalRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ccc', marginRight: 14, alignItems: 'center', justifyContent: 'center' },
  modalRadioSel: { borderColor: '#2E7D32' },
  modalRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E7D32' },
  modalRowTxt: { fontSize: 15, color: '#444' },
  modalRowTxtSel: { color: '#1F4E1F', fontWeight: '700' },
});
