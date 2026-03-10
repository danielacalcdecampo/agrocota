import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as XLSX from 'xlsx';

export interface ImportedProduct {
  cat: string;
  subcat: string;
  nome: string;
  ia: string;
  fonte: string;
  dose: string;
  unid: string;
  aplic: string;
  estadio: string;
  tecnologia: string;
  alvo: string;
  obs: string;
  extras: string[];
  valor_ha: number;
}

// Normaliza string para comparação (remove acentos, lowercase)
function norm(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Encontra índice da primeira coluna que bata com um dos padrões (em ordem de prioridade)
function findCol(headers: string[], patterns: RegExp[]): number {
  const normed = headers.map(norm);
  for (const pattern of patterns) {
    const idx = normed.findIndex(h => pattern.test(h));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Mapeia colunas de cada aba dinamicamente
function mapColumns(headers: string[]) {
  return {
    talhao: findCol(headers, [/^talhao$/, /\btalhao\b/, /campo|field/]),
    // produto: prioridade para nome exato, depois parcial
    produto: findCol(headers, [
      /^produto$/, /^hibridos?$/, /^hibrido$/, /^cultivar$/, /^variedade$/,
      /\bproduto\b/, /\bhibrido\b/,
    ]),
    // dose: começa com "dose" mas não é "dose total"
    dose: findCol(headers, [
      /^dose\s+produto/, /^dose\s+l\s+ou/, /^dose\s+l\b/, /^dose\s+kg/,
      /^dose\b(?!\s+total)/,
    ]),
    unidade: findCol(headers, [/^und$/, /^unidade$/, /^u\.m\.?$/, /\bunid\b/]),
    // aplicações: número de aplicações
    aplic: findCol(headers, [
      /^n[o°u]\.?\s*aplic/, /^n[ou]mero\s+de\s+aplic/,
      /^n[°o]\s+aplic/, /^no\.?\s*aplic/,
    ]),
    // estadio/fase/programa
    estadio: findCol(headers, [
      /estadio|estagio/, /\bfase\b/, /\bprograma\b/,
      /aplicacao.*momento/, /momento.*aplic/,
    ]),
    // valor por ha — prioridade para "valor ha"
    valor_ha: findCol(headers, [
      /^valor\s+ha\b/, /^valor\s+ha\s*\(/, /valor\s*\/\s*ha/,
      /valor\s+ha\s+\(r\$\)/,
    ]),
    // valor por litro/kg (fallback se não houver valor_ha)
    valor_l: findCol(headers, [
      /^valor\s+[lk]\b/, /valor\s+fung/, /valor\s+[lk]\s+ou\s+kg/,
    ]),
    alvo: findCol(headers, [/^alvo$/, /\balvo\b/, /doenca|praga|pest|target/]),
    ia: findCol(headers, [
      /^i\.a\.$/, /^ativo$/, /principio\s+ativo/, /i\.a\b/, /ingrediente/,
    ]),
    tecnologia: findCol(headers, [/^tecnologia$/, /\btecnol\b/]),
    ciclo:      findCol(headers, [/^ciclo$/, /\bciclo\b/]),
    obs:        findCol(headers, [/^obs\.?$/, /^observa/, /^notas?$/]),
    escolha:    findCol(headers, [/^escolha$/, /^escolhido$/, /^selected$/]),
    // grupo/opção (ex: "Opções", "Opção") — usado como sub-agrupamento
    grupo:      findCol(headers, [/^op[cç][ao]es?$/, /^op[cç][ao]$/, /^grupo$/]),
    empresa:    findCol(headers, [/^empresa$/, /\bempresa\b/, /\bfonte\b/]),
    // coluna de categoria explícita (opcional)
    categoria:  findCol(headers, [/^categoria$/, /^cat\.?$/, /^tipo\s+produto/, /^tipo$/]),
  };
}

// Limpa valor de célula
function cell(row: string[], idx: number): string {
  if (idx === -1 || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}

// Converte valor de célula para número
function num(row: string[], idx: number): number {
  const v = cell(row, idx).replace(',', '.');
  return parseFloat(v) || 0;
}

// Nomes genéricos de aba que não dizem nada sobre a categoria
const GENERIC_SHEET_NAMES = new Set([
  'plan1', 'plan2', 'plan3', 'sheet1', 'sheet2', 'sheet3',
  'planilha1', 'planilha2', 'folha1', 'folha2', 'dados', 'data',
  'importacao', 'importação', 'cotacao', 'cotação', 'produtos',
]);

// Abas a ignorar (não são categorias de produto)
const IGNORE_SHEETS = new Set(['estoque', 'resumo', 'summary', 'dashboard', 'config', 'instrucoes', 'instrução', 'ajuda']);

/**
 * Tenta inferir a categoria a partir do nome do produto.
 * Usado quando a aba tem nome genérico e não há coluna "Categoria".
 */
function inferirCategoria(nome: string): string {
  const n = nome.toLowerCase();

  if (/fungicid|estrobilurin|triazol|carboxamid|piraclostrobin|azoxistrobin|tebuconazol|propiconazol/.test(n))
    return 'Fungicida';
  if (/herbicid|glifosato|roundup|paraquat|2,4-d|atrazina|imazetapir|dicamba|dessec|graminicid/.test(n))
    return 'Herbicida';
  if (/inseticid|imidacloprid|lambda|deltametrin|tiametoxam|clorantraniliprole|abamectin|diamida|piretroid/.test(n))
    return 'Inseticida';
  if (/hibrid|sement|cultivar|variedade|milho|soja|trigo|sorgo|feijao|pastagem/.test(n))
    return 'Sementes / Hibridos';
  if (/inoculant|brad|azo|biolog|bacillus|beauveria|trichoderma|bioinsetic|bionematic/.test(n))
    return 'Biologico';
  if (/ureia|map|dap|kcl|cloreto|sulfato|superfosfato|npk|adubo|fertiliz|octaborato|fosforo|potassio/.test(n))
    return 'Fertilizantes';
  if (/oleo|adjuv|espalhante|surfact|nimbus|aureo|dash|nobilis/.test(n))
    return 'Adjuvante';
  if (/nutri|foliar|boro|zinco|manganes|calcio|molibdenio|cobalto|ferro|cobre|multimic/.test(n))
    return 'Nutricao / Fertilizante Foliar';
  if (/nematic|nemato/.test(n))
    return 'Nematicida';
  if (/corretiv|calcario|gesso|calcit|dolomitico/.test(n))
    return 'Corretivo de Solo';

  return 'Geral';
}

// Processa uma aba do Excel e retorna produtos
function processSheet(sheetName: string, data: string[][]): ImportedProduct[] {
  // Encontra a linha de cabeçalho: primeira linha com >= 3 células preenchidas
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(6, data.length); i++) {
    if (data[i].filter(c => c !== '').length >= 3) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1 || headerRowIdx >= data.length - 1) return [];

  const headers = data[headerRowIdx];
  const cols = mapColumns(headers);

  // Se não encontrou coluna de produto, aba não tem estrutura de produtos
  if (cols.produto === -1) {
    console.log(`⚠️ Aba "${sheetName}": coluna de produto não encontrada. Headers:`, headers.slice(0, 8));
    return [];
  }

  // Verifica se o nome da aba é genérico (sem significado de categoria)
  const sheetNorm = norm(sheetName);
  const isGenericSheet = GENERIC_SHEET_NAMES.has(sheetNorm);

  // Inferir unidade padrão baseada no nome da aba (quando não há coluna explícita)
  const defaultUnid = (() => {
    if (/fertiliz|adubo/.test(sheetNorm)) return 'kg/ha';
    if (/hibrid|sement|cultivar/.test(sheetNorm)) return 'sc/ha';
    return 'L/ha';
  })();

  const products: ImportedProduct[] = [];

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every(c => c === '')) continue;

    let nome = cell(row, cols.produto);
    if (!nome) continue;

    // Pular linhas que são cabeçalhos repetidos ou inválidas
    const nomeNorm = norm(nome);
    if (nomeNorm === 'produto' || nomeNorm === 'hibridos' || nomeNorm === 'hibrido') continue;
    if (nome.length < 2) continue;
    if (/^[\d.,\s]+$/.test(nome)) continue; // só números

    // Categoria: coluna explícita > nome da aba (se não genérico) > inferir pelo produto
    let cat: string;
    if (cols.categoria !== -1 && cell(row, cols.categoria)) {
      cat = cell(row, cols.categoria);
    } else if (!isGenericSheet) {
      cat = sheetName;
    } else {
      cat = inferirCategoria(nome);
    }

    // Talhão como subcat; se vazio, usa o nome da aba
    const talhao = cell(row, cols.talhao);
    const subcat = talhao || sheetName;

    // Dose
    const dose = cell(row, cols.dose);

    // Unidade
    let unid = cell(row, cols.unidade);
    if (!unid) unid = defaultUnid;
    // Limpar unidade (ex: "l/ha " → "L/ha")
    unid = unid.replace(/\s+/g, '').toUpperCase();
    if (unid === 'L/HA') unid = 'L/ha';
    else if (unid === 'KG/HA') unid = 'kg/ha';

    // Estadio
    const estadio = cell(row, cols.estadio);

    // N° aplicações
    const aplicRaw = cell(row, cols.aplic);
    const aplic = aplicRaw || '1';

    // Valor ha — não importamos valores; vêm das propostas das revendas
    const valor_ha = 0;

    // i.a. / Ativo
    const ia = cell(row, cols.ia);

    // Empresa/Fonte
    const fonte = cell(row, cols.empresa);

    // Tecnologia
    const tecnologia = cell(row, cols.tecnologia);

    // Alvo
    const alvo = cell(row, cols.alvo);

    // Obs
    const obs = cell(row, cols.obs);

    // Escolha do consultor (marcado com X)
    const escolha = cell(row, cols.escolha);
    const escolhido = /^x$/i.test(escolha) || escolha === '1';

    // Ciclo (comum em híbridos)
    const ciclo = cell(row, cols.ciclo);

    // Grupo/Opção (agrupamento interno da aba)
    const grupo = cell(row, cols.grupo);

    const extras: string[] = [];
    if (grupo) extras.push(`Grupo/Opção: ${grupo}`);
    if (ciclo) extras.push(`Ciclo: ${ciclo}`);
    if (escolhido) extras.push('Escolha do consultor');

    products.push({
      cat,
      subcat,
      nome,
      ia,
      fonte,
      dose: dose || '0',
      unid,
      aplic,
      estadio,
      tecnologia,
      alvo,
      obs,
      extras,
      valor_ha,
    });
  }

  return products;
}

/**
 * Importa produtos de arquivo Excel (.xlsx/.xls) ou CSV.
 * Para Excel com múltiplas abas, cada aba vira uma categoria.
 */
export async function importExcelProducts(): Promise<ImportedProduct[]> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      copyToCacheDirectory: true,
    }) as any;

    if (result.canceled === true || !result.assets || result.assets.length === 0) {
      throw new Error('Importação cancelada');
    }

    const fileUri: string = result.assets[0].uri;
    const fileName: string = result.assets[0].name || '';

    console.log('📂 Arquivo selecionado:', fileName);
    console.log('📍 URI:', fileUri);

    const isExcel =
      fileName.toLowerCase().endsWith('.xlsx') ||
      fileName.toLowerCase().endsWith('.xls');
    const isCSV = fileName.toLowerCase().endsWith('.csv');

    console.log('📋 Tipo detectado - Excel:', isExcel, 'CSV:', isCSV);

    let allProducts: ImportedProduct[] = [];

    if (isExcel) {
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const workbook = XLSX.read(base64, { type: 'base64' });
      console.log('📑 Abas encontradas:', workbook.SheetNames);

      for (const sheetName of workbook.SheetNames) {
        if (IGNORE_SHEETS.has(norm(sheetName))) {
          console.log(`⏭ Aba ignorada: ${sheetName}`);
          continue;
        }

        const sheet = workbook.Sheets[sheetName];
        const data: string[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          raw: false,
        }) as string[][];

        console.log(`\n🔍 Processando aba: "${sheetName}" (${data.length} linhas)`);
        const sheetProducts = processSheet(sheetName, data);
        console.log(`   ➜ ${sheetProducts.length} produto(s) extraído(s)`);
        allProducts = [...allProducts, ...sheetProducts];
      }

    } else if (isCSV) {
      let fileContent = await FileSystem.readAsStringAsync(fileUri);
      fileContent = fileContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
      if (lines.length < 2) throw new Error('Arquivo CSV sem dados válidos');

      const rows = lines.map(line => parseCSVLine(line));
      allProducts = processSheet('Importado', rows);

    } else {
      throw new Error('Formato não suportado. Importe um arquivo .xlsx, .xls ou .csv');
    }

    if (allProducts.length === 0) {
      throw new Error(
        'Nenhum produto encontrado no arquivo.\n\n' +
        'Verifique se:\n' +
        '- O arquivo tem cabeçalho na primeira linha\n' +
        '- Existe uma coluna chamada "Produto" (ou "Híbridos")\n' +
        '- As linhas de dados estão abaixo do cabeçalho'
      );
    }

    const cats = new Set(allProducts.map(p => p.cat));
    console.log(`\n✅ Total: ${allProducts.length} produto(s) de ${cats.size} categoria(s): ${[...cats].join(', ')}`);
    return allProducts;

  } catch (error: any) {
    console.error('❌ Erro ao importar:', error);
    throw new Error(error?.message || 'Erro ao importar arquivo');
  }
}

/**
 * Parser de linha CSV com suporte a campos entre aspas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}
