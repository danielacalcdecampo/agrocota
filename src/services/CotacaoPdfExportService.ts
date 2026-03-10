import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert } from 'react-native';
import { Asset } from 'expo-asset';
import { Colors, getCatColor } from '../theme/colors';

export interface PdfOpcaoFornecedor {
  fornecedor: string;
  valorHa: number;
  doseHa?: number | null;
  unidade?: string | null;
  /** Produto não disponível na proposta — exibir badge "Não disponível" */
  indisponivel?: boolean;
  /** É alternativa sugerida pelo fornecedor — exibir badge "Alternativa" e nome do produto */
  isAlternativa?: boolean;
  produtoAlternativo?: string;
  doseAlternativa?: string;
  /** Dose original solicitada (para mostrar Orig vs Alt) */
  doseOriginal?: string;
  /** Diferença percentual entre dose original e dose alternativa */
  pctDiferencaDose?: number;
}

export interface PdfProdutoCategoria {
  produto: string;
  principio_ativo?: string | null;
  fonte?: string | null;
  estagio?: string | null;
  n_aplicacoes?: number | null;
  alvo?: string | null;
  obs?: string | null;
  opcoes: PdfOpcaoFornecedor[];
}

export interface PdfCategoriaCotacao {
  categoria: string;
  color: string;
  somaMin: number;
  somaMax: number;
  produtos: PdfProdutoCategoria[];
}

export interface ExportCotacaoPdfInput {
  titulo: string;
  dataGeracao?: Date;
  totalGeralMin: number;
  totalGeralMax: number;
  economiaPotencial: number;
  categorias: PdfCategoriaCotacao[];
  fazendaNome?: string;
  produtorNome?: string;
  fazendaLocalizacao?: string;
  consultorEmpresa?: {
    companyName?: string;
    consultorNome?: string;
    cnpj?: string;
    phone?: string;
    logoUrl?: string;
  };
  comparativoCotacoes?: {
    titulo: string;
    totalGeral: number;
  }[];
  comparativoProdutos?: {
    categoria: string;
    produto: string;
    principio_ativo?: string | null;
    fonte?: string | null;
    doseOriginal?: string;
    precos: {
      titulo: string;
      valor: number;
      isAlternativa?: boolean;
      produtoAlternativo?: string;
      doseOriginal?: string;
      doseAlternativa?: string;
      pctDiferencaDose?: number;
    }[];
  }[];
  aceiteProdutor?: {
    cotacaoEscolhida: string;
    totalEscolhido: number;
    aceitoEm?: string | null;
    produtorNome?: string | null;
  } | null;
  excelItensJson?: Array<Record<string, any>>;
  areaAplicadaHa?: number;
  talhaoNome?: string;
  talhaoCoordenadas?: any;
  talhaoImagemUrl?: string;
  talhaoImagemBase64?: string;
  talhaoAreaHa?: number;
  talhaoAltitude?: number | null;
  talhaoCoordenadasFormatadas?: string;
  /** Destaca que valores são R$/ha e o total será calculado pelo talhão ao aceitar */
  destacarValoresPorHa?: boolean;
}

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Cores distintas por cotação no comparativo (usa getCatColor do theme para consistência)
const COT_COLORS = ['#DC2626','#F57C00','#1565C0','#6A1B9A','#00838F','#16a34a','#eab308','#C62828'];

// ── SVG helpers ────────────────────────────────────────────────────────────────

function svgDonutCot(
  slices: { value: number; color: string }[],
  r: number,
  centerLabel?: string,
  centerSub?: string,
): string {
  const size = r * 2 + 4;
  const cx = size / 2, cy = size / 2;
  const ri = r * 0.6;
  const total = slices.reduce((s, v) => s + v.value, 0);
  if (total <= 0) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#e8f0ea"/><circle cx="${cx}" cy="${cy}" r="${ri}" fill="white"/></svg>`;
  }
  let angle = -90;
  const paths: string[] = [];
  slices.forEach(s => {
    const sweep = (s.value / total) * 360;
    if (sweep <= 0) return;
    const startRad = (angle * Math.PI) / 180;
    const endRad   = ((angle + sweep) * Math.PI) / 180;
    const x1 = cx + r  * Math.cos(startRad), y1 = cy + r  * Math.sin(startRad);
    const x2 = cx + r  * Math.cos(endRad),   y2 = cy + r  * Math.sin(endRad);
    const xi1= cx + ri * Math.cos(startRad), yi1= cy + ri * Math.sin(startRad);
    const xi2= cx + ri * Math.cos(endRad),   yi2= cy + ri * Math.sin(endRad);
    const lg = sweep > 180 ? 1 : 0;
    if (sweep >= 359.9) {
      paths.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}"/>`);
    } else {
      paths.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ri} ${ri} 0 ${lg} 0 ${xi1} ${yi1} Z" fill="${s.color}"/>`);
    }
    angle += sweep;
  });
  const fs = r > 60 ? 12 : 9;
  const fsub = r > 60 ? 9 : 7;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    ${paths.join('')}
    <circle cx="${cx}" cy="${cy}" r="${ri}" fill="white"/>
    ${centerLabel ? `<text x="${cx}" y="${cy - fsub}" text-anchor="middle" font-size="${fs}" fill="#111827" font-weight="900">${esc(centerLabel)}</text>` : ''}
    ${centerSub   ? `<text x="${cx}" y="${cy + fs}" text-anchor="middle" font-size="${fsub}" fill="#6b7280" font-weight="700">${esc(centerSub)}</text>` : ''}
  </svg>`;
}

function svgVertBars(
  bars: { label: string; value: number; color: string }[],
): string {
  const W = 520, H = 170;
  const padT = 32, padB = 44, padL = 12, padR = 12;
  const chartH = H - padT - padB;
  const chartW = W - padL - padR;
  const maxAbs = Math.max(...bars.map(b => Math.abs(b.value)), 1);
  const gW = chartW / bars.length;
  const bW = Math.floor(gW * 0.42);
  const baseY = padT + chartH;

  const fmtK = (n: number): string => {
    const s = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1_000_000) return `${s}R$${(a / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000)     return `${s}R$${Math.round(a / 1_000)}k`;
    return `${s}R$${Math.round(a)}`;
  };

  const gridLines = [0.25, 0.5, 0.75, 1.0].map(f => {
    const y = padT + chartH - f * chartH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e5e7eb" stroke-width="0.8" stroke-dasharray="3,3"/>`;
  }).join('');

  const rects = bars.map((bar, i) => {
    const x = padL + i * gW + (gW - bW) / 2;
    const bH = Math.max((Math.abs(bar.value) / maxAbs) * chartH, 4);
    const y = baseY - bH;
    const valueY = Math.max(y - 5, padT + 10);
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bW}" height="${bH.toFixed(1)}" rx="3" fill="${bar.color}" opacity="0.92"/>
      <text x="${(x + bW / 2).toFixed(1)}" y="${valueY.toFixed(1)}" text-anchor="middle" font-size="8" fill="${bar.color}" font-weight="800">${fmtK(bar.value)}</text>
      <text x="${(x + bW / 2).toFixed(1)}" y="${(baseY + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="#374151" font-weight="700">${esc(bar.label)}</text>`;
  }).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;">
    ${gridLines}
    <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#d1d5db" stroke-width="1"/>
    ${rects}
  </svg>`;
}

const esc = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function normalizeBrPhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  return `55${digits}`;
}

function formatBrPhone(raw: string): string {
  const normalized = normalizeBrPhone(raw);
  if (!normalized) return 'Não informado';

  const local = normalized.startsWith('55') ? normalized.slice(2) : normalized;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return `+${normalized}`;
}

function renderPolygonSvg(coordsRaw: any): string {
  try {
    let coords: any[] = [];
    if (typeof coordsRaw === 'string') {
      try { coords = JSON.parse(coordsRaw); } catch (e) { return ''; }
    } else if (Array.isArray(coordsRaw)) {
      coords = coordsRaw;
    } else if (coordsRaw && Array.isArray(coordsRaw.coordinates)) {
      coords = coordsRaw.coordinates[0];
    } else {
      return '';
    }

    if (!Array.isArray(coords) || coords.length < 3) return '';

    const pointsStr = coords.map(c => {
      let lat, lng;
      if (Array.isArray(c)) { lng = c[0]; lat = c[1]; }
      else {
        lat = c.latitude !== undefined ? c.latitude : c.lat;
        lng = c.longitude !== undefined ? c.longitude : (c.lng !== undefined ? c.lng : c.lon);
      }
      return { lat, lng };
    }).filter(c => c.lat !== undefined && c.lng !== undefined);

    if (pointsStr.length < 3) return '';

    const lats = pointsStr.map(c => Number(c.lat));
    const lngs = pointsStr.map(c => Number(c.lng));
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    const latDiff = maxLat - minLat || 0.0001;
    const lngDiff = maxLng - minLng || 0.0001;

    const pad = 10;
    const size = 180;

    const polyPoints = pointsStr.map(c => {
      const x = pad + ((Number(c.lng) - minLng) / lngDiff * size);
      const y = pad + (size - ((Number(c.lat) - minLat) / latDiff * size)); 
      return `${x},${y}`;
    }).join(' ');

    return `
      <svg viewBox="0 0 200 200" style="width: 100%; height: 90px; display: block; border-radius: 8px;">
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e5e7eb" stroke-width="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <polygon points="${polyPoints}" fill="rgba(34, 197, 94, 0.25)" stroke="${Colors.primary}" stroke-width="3" stroke-linejoin="round" />
      </svg>
    `;
  } catch(e) {
    return '';
  }
}

function buildHtml(input: ExportCotacaoPdfInput, appLogoBase64?: string): string {
  const data = (input.dataGeracao ?? new Date()).toLocaleString('pt-BR');
  const phoneRaw = String(input.consultorEmpresa?.phone || '').trim();
  const phoneBr = normalizeBrPhone(phoneRaw);
  const phoneFormatted = formatBrPhone(phoneRaw);
  const whatsappHref = phoneBr ? `https://wa.me/${phoneBr}` : '';

  const categoriasOrdenadas = [...input.categorias].sort((a, b) => b.somaMin - a.somaMin);

  const comparativoCotacoes = [...(input.comparativoCotacoes ?? [])].sort((a, b) => a.totalGeral - b.totalGeral);
  const hasComparativo = comparativoCotacoes.length > 1;
  
  const areaValue = Number(input.areaAplicadaHa || input.talhaoAreaHa || 0);
  const talhaoAreaReal = Number(input.talhaoAreaHa || input.areaAplicadaHa || 0);

  const areaInfoHtml = `<div><strong>Área:</strong> ${fmtBRL(areaValue > 0 ? areaValue : 1)} ha</div>`;

  // Seção "Dados do Talhão" — dados reais cadastrados pelo usuário
  const temTalhao = !!(input.talhaoNome || input.talhaoCoordenadas || talhaoAreaReal > 0);
  const talhaoDadosHtml = temTalhao ? `
    <div style="margin-top:12px;padding:12px;background:#f8faf8;border-radius:10px;border:1px solid #e4ede4;">
      <div style="font-size:9px;font-weight:800;color:#6b7280;letter-spacing:.6px;margin-bottom:8px;text-transform:uppercase">Dados do Talhão</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:11px;">
        ${input.talhaoNome ? `<div><strong>Nome:</strong> ${esc(input.talhaoNome)}</div>` : ''}
        ${talhaoAreaReal > 0 ? `<div><strong>Área:</strong> ${fmtBRL(talhaoAreaReal)} ha</div>` : ''}
        ${input.talhaoCoordenadasFormatadas ? `<div style="grid-column:1/-1"><strong>Coordenadas (centro):</strong> ${esc(input.talhaoCoordenadasFormatadas)}</div>` : ''}
        ${input.talhaoAltitude != null && input.talhaoAltitude !== undefined ? `<div><strong>Altitude:</strong> ${input.talhaoAltitude} m</div>` : ''}
      </div>
    </div>` : '';

  // Prioriza imagem de satélite (base64 embutida funciona no PDF; URL externa pode falhar)
  const mapImgSrc = input.talhaoImagemBase64
    ? `data:image/png;base64,${input.talhaoImagemBase64}`
    : input.talhaoImagemUrl || '';
  const svgMapHtml = mapImgSrc
    ? `<img src="${mapImgSrc}" style="width: 100%; height: 90px; object-fit: cover; display: block; border-radius: 8px; border: 2px solid ${Colors.primary};" alt="Mapa do Talhão (Satélite)" />`
    : (input.talhaoCoordenadas ? renderPolygonSvg(input.talhaoCoordenadas) : '');
  
  const menorCotacaoValor = comparativoCotacoes.length > 0
    ? Math.min(...comparativoCotacoes.map(row => Number(row.totalGeral || 0)))
    : Number(input.totalGeralMin || 0);
  const valorPrincipal = hasComparativo ? menorCotacaoValor : Number(input.totalGeralMin || 0);
  const labelPrincipal = hasComparativo ? 'Cotação de menor valor' : 'Investimento Total';
  const totalSomaCategorias = categoriasOrdenadas.reduce((acc, cat) => acc + cat.somaMin, 0);

  let currentPct = 0;
  const pieGradientStops = categoriasOrdenadas.map(cat => {
    const color = getCatColor(cat.categoria);
    const pct = totalSomaCategorias > 0 ? (cat.somaMin / totalSomaCategorias) * 100 : 0;
    const start = currentPct;
    currentPct += pct;
    return `${color} ${start}% ${currentPct}%`;
  }).join(', ');
  const pieStyle = totalSomaCategorias > 0 ? `background: conic-gradient(${pieGradientStops});` : 'background: #e5e7eb;';

  const categoriasResumoHtml = categoriasOrdenadas.map(cat => {
    const color = getCatColor(cat.categoria);
    const pct = totalSomaCategorias > 0 ? ((cat.somaMin / totalSomaCategorias) * 100).toFixed(1) : '0.0';
    return `<div class="legend-row">
        <div class="dot" style="background:${color};width:6px;height:6px;"></div>
        <div class="legend-name">${esc(cat.categoria)} <span class="legend-pct">(${pct}%)</span></div>
        <div class="legend-bar-wrap"><div class="legend-bar" style="width:${pct}%;background:${color}"></div></div>
        <div class="legend-val">R$ ${fmtBRL(cat.somaMin)}</div>
      </div>`;
  }).join('');

  // Nova Legenda da Pizza
  const pieLegendHtml = categoriasOrdenadas.map(cat => {
    const color = getCatColor(cat.categoria);
    return `
      <div class="pie-legend-item">
        <div class="dot" style="background: ${color}"></div>
        <span>${esc(cat.categoria)}</span>
      </div>
    `;
  }).join('');

  const tabelasCategorizadasHtml = categoriasOrdenadas.map(cat => {
    const catColor = getCatColor(cat.categoria);
    const produtosRows = cat.produtos.flatMap(prod => {
      // Chips de P.A. e Fonte (sempre estruturados)
      const paChip   = prod.principio_ativo ? `<span class="chip-pa">P.A.: ${esc(prod.principio_ativo)}</span>` : '';
      const fonteChip = prod.fonte ? `<span class="chip-fonte">Fonte: ${esc(prod.fonte)}</span>` : '';
      // Badges extras: estádio, aplicações, alvo, obs
      const extrasHtml = [
        prod.estagio      ? `<span class="badge">Estádio: ${esc(prod.estagio)}</span>` : '',
        prod.n_aplicacoes ? `<span class="badge">Aplic.: ${prod.n_aplicacoes}x</span>` : '',
        prod.alvo         ? `<span class="badge">Alvo: ${esc(prod.alvo)}</span>` : '',
        prod.obs          ? `<span class="badge">Obs: ${esc(prod.obs)}</span>` : '',
      ].filter(Boolean).join('');
      // Badges extras genéricos do excelItensJson (campos não cobertos acima)
      const itemJson = input.excelItensJson?.find(x => String(x.produto).trim() === String(prod.produto).trim());
      const excelBadges = itemJson
        ? Object.entries(itemJson)
            .filter(([k]) => !['produto','fornecedor','categoria','valor_ha','unidade','dose',
                               'id','cotacao_id','principio_ativo','fonte','estagio',
                               'n_aplicacoes','alvo','obs'].includes(k))
            .filter(([, v]) => Boolean(v))
            .map(([k, v]) => `<span class="badge">${esc(k)}: ${esc(String(v))}</span>`)
            .join('')
        : '';
      const allBadges = [extrasHtml, excelBadges].filter(Boolean).join('');
      // Header do produto — aparece apenas na primeira linha (rowspan)
      const nOps    = prod.opcoes.length;
      const opcoesComValor = prod.opcoes.filter(op => !op.indisponivel && Number(op.valorHa || 0) > 0);
      const minValor = opcoesComValor.length > 0 ? Math.min(...opcoesComValor.map(op => Number(op.valorHa || 0))) : 0;
      return prod.opcoes.map((op, opIdx) => {
        const isMenor = nOps > 1 && Number(op.valorHa || 0) === minValor && !op.indisponivel;
        const menorBadge = isMenor ? `<span style="background:${Colors.primary};color:#fff;font-size:8px;font-weight:900;padding:2px 6px;border-radius:4px;margin-left:6px;letter-spacing:.3px">MENOR</span>` : '';
        const indisponivelBadge = op.indisponivel
          ? `<span style="background:#fef3c7;border:1px solid #f59e0b;color:#b45309;font-size:8px;font-weight:900;padding:2px 6px;border-radius:4px;margin-left:6px;letter-spacing:.3px">Não disponível</span>`
          : '';
        const altBadge = op.isAlternativa
          ? `<span style="background:#dcfce7;border:1px solid ${Colors.primary};color:${Colors.success};font-size:8px;font-weight:900;padding:2px 6px;border-radius:4px;margin-right:6px;letter-spacing:.3px">Alternativa</span>`
          : '';
        const fornecedorCol = op.isAlternativa && op.produtoAlternativo
          ? `<span style="display:block;padding:6px 10px;margin:2px 0;background:#f0fdf4;border-left:4px solid ${Colors.primary};border-radius:0 6px 6px 0;">${altBadge} <strong>${esc(op.produtoAlternativo)}</strong><br/><span style="color:#6b7280;font-size:10px;">${esc(op.fornecedor || '-')}</span></span>`
          : `${indisponivelBadge}${esc(op.fornecedor === 'N/I' ? 'Fornecedor Direto' : (op.fornecedor || '-'))}${menorBadge}`;
        const pctDoseBadge = op.pctDiferencaDose !== undefined && op.pctDiferencaDose !== 0
          ? `<span style="display:inline-block;margin-top:3px;font-size:8px;font-weight:900;padding:1px 5px;border-radius:4px;background:${op.pctDiferencaDose > 0 ? '#fef3c7' : '#dcfce7'};color:${op.pctDiferencaDose > 0 ? '#b45309' : Colors.success};">${op.pctDiferencaDose > 0 ? '+' : ''}${op.pctDiferencaDose}% dose</span>`
          : '';
        const doseCol = op.isAlternativa
          ? (op.doseOriginal && op.doseAlternativa
              ? `<span style="font-size:10px;color:#6b7280;">Orig: ${esc(op.doseOriginal)}</span><br/><span style="font-size:10px;color:${Colors.primary};font-weight:700;">Alt: ${esc(op.doseAlternativa)}</span>${pctDoseBadge ? '<br/>' + pctDoseBadge : ''}`
              : (op.doseAlternativa ? `${esc(op.doseAlternativa)}${pctDoseBadge ? '<br/>' + pctDoseBadge : ''}` : (op.doseOriginal ? esc(op.doseOriginal) : '-')))
          : (op.doseHa != null && Number(op.doseHa) > 0 ? fmtBRL(Number(op.doseHa)) + (op.unidade ? ' ' + esc(op.unidade) : ' L/ha') : '-');
        const valorCol = op.indisponivel ? '—' : `R$ ${fmtBRL(Number(op.valorHa || 0))}`;
        const rowBg = op.indisponivel ? 'background:#fffbeb;' : (isMenor ? 'background:#f0fdf4;' : '');
        const altRowStyle = op.isAlternativa ? 'border-top:1px dashed #bbf7d0;' : '';
        return `
          <tr style="${rowBg}${altRowStyle}">
            ${opIdx === 0 ? `
            <td rowspan="${nOps}" style="vertical-align:top;border-right:1px solid #f3f4f6;">
              <div class="prod-name">${esc(prod.produto)}</div>
              ${(paChip || fonteChip) ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;">${paChip}${fonteChip}</div>` : ''}
              ${allBadges ? `<div class="badges" style="margin-top:5px;">${allBadges}</div>` : ''}
            </td>` : ''}
            <td style="width:25%;vertical-align:middle">
              ${fornecedorCol}
            </td>
            <td class="num" style="width:15%;vertical-align:middle">${doseCol}</td>
            <td class="num val-strong" style="width:20%;vertical-align:middle;color:${isMenor ? Colors.success : '#111827'}">${valorCol}</td>
          </tr>
        `;
      });
    }).join('');

    return `
      <div class="cat-detail-wrapper">
        <div class="cat-detail-header" style="background-color: ${catColor};">
          ${esc(cat.categoria)}
        </div>
        <table class="cat-detail-table">
          <thead>
            <tr>
              <th>Produto / P.A. / Detalhes</th>
              <th>Fornecedor / Alternativa</th>
              <th class="num">Dose</th>
              <th class="num">Valor/ha</th>
            </tr>
          </thead>
          <tbody>
            ${produtosRows}
          </tbody>
        </table>
      </div>
    `;
  }).join('');
// --- BLOCO DE COMPARATIVO — design igual ao comparativo-viewer.html ---
  let comparativoCotacoesHtml = '';
  if (hasComparativo) {
    // Cores distintas por cotação (igual ao app)

    const totalSomaComp  = comparativoCotacoes.reduce((s,c) => s + c.totalGeral, 0);
    const diff           = comparativoCotacoes[comparativoCotacoes.length-1].totalGeral - comparativoCotacoes[0].totalGeral;

    // ── Card 1: Comparativo de Investimento — barras verticais SVG ──
    const investBarsData = comparativoCotacoes.map((c, i) => ({
      label: c.titulo.length > 18 ? c.titulo.slice(0, 16) + '…' : c.titulo,
      value: c.totalGeral,
      color: COT_COLORS[i % COT_COLORS.length],
    }));
    const investBarRows = svgVertBars(investBarsData);

    const economiaBadge = diff > 0 ? `
      <div style="display:flex;align-items:center;justify-content:space-between;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:10px 14px;margin-top:10px">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#166534">Economia potencial</span>
        <span style="font-size:14px;font-weight:900;color:${Colors.primary};font-variant-numeric:tabular-nums">R$ ${fmtBRL(diff)}</span>
      </div>` : '';

    // ── Card 2: Comparativo por Produto — tabela compacta, contraste forte, doses completas ──
    const produtosPorCategoria: Record<string, typeof input.comparativoProdutos> = {};
    (input.comparativoProdutos || []).forEach(cp => {
      const cat = cp.categoria || 'Insumo';
      if (!produtosPorCategoria[cat]) produtosPorCategoria[cat] = [];
      produtosPorCategoria[cat]!.push(cp);
    });
    const catNomesComp = Object.keys(produtosPorCategoria).sort();

    const prodBarRows = catNomesComp.map((catNome, catIdx) => {
      const catProds = produtosPorCategoria[catNome] || [];
      const catColor = getCatColor(catNome);
      const catTopMargin = catIdx > 0 ? 'margin-top:12px;' : '';

      const produtosHtml = catProds.map((cp, pi) => {
        const minPreco = Math.min(...cp.precos.map(p => p.valor));
        const topBorder = pi > 0 ? 'border-top:1px solid #d1e7d4;margin-top:8px;padding-top:8px;' : '';
        const paChip    = cp.principio_ativo ? `<span style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;font-size:8px;font-weight:800;padding:2px 5px;border-radius:4px">P.A.: ${esc(cp.principio_ativo)}</span>` : '';
        const fonteChip = cp.fonte ? `<span style="background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:8px;font-weight:800;padding:2px 5px;border-radius:4px">Fonte: ${esc(cp.fonte)}</span>` : '';
        const doseSolic = cp.doseOriginal ? `<span style="font-size:9px;color:#6b7280">Dose solicitada: ${esc(cp.doseOriginal)}</span>` : '';

        const linhas = cp.precos.map((p, idx) => {
          const isMenor = cp.precos.length > 1 && p.valor === minPreco && idx === cp.precos.findIndex(x => x.valor === minPreco);
          const rowBg = isMenor ? 'background:#d1fae5;' : (idx % 2 === 1 ? 'background:#f9fafb;' : 'background:#ffffff;');
          const td1Style = `padding:8px 10px;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:10px${isMenor ? `;border-left:4px solid ${Colors.primary}` : ''}`;
          const revendaCell = p.isAlternativa && p.produtoAlternativo
            ? `<span style="font-weight:700;color:#111827">${esc(p.titulo)}</span><br/><span style="font-size:9px;background:#dcfce7;border:1px solid #bbf7d0;color:#166534;padding:2px 6px;border-radius:4px;display:inline-block;margin-top:3px">Alternativa</span><br/><span style="font-size:10px;font-weight:800;color:#166534">${esc(p.produtoAlternativo)}</span>`
            : `<span style="font-weight:700;color:#111827">${esc(p.titulo)}</span>`;
          const pctBadge = p.pctDiferencaDose !== undefined && p.pctDiferencaDose !== 0
            ? `<br/><span style="font-size:8px;font-weight:900;padding:1px 5px;border-radius:4px;background:${p.pctDiferencaDose > 0 ? '#fef3c7' : '#dcfce7'};color:${p.pctDiferencaDose > 0 ? '#b45309' : Colors.success}">${p.pctDiferencaDose > 0 ? '+' : ''}${p.pctDiferencaDose}% dose</span>`
            : '';
          const doseCell = p.isAlternativa
            ? (p.doseOriginal && p.doseAlternativa
                ? `<span style="font-size:9px;color:#6b7280">Orig: ${esc(p.doseOriginal)}</span><br/><span style="font-size:9px;font-weight:700;color:${Colors.primary}">Alt: ${esc(p.doseAlternativa)}</span>${pctBadge}`
                : (p.doseAlternativa
                    ? `${esc(p.doseAlternativa)}${pctBadge}`
                    : (p.doseOriginal ? `${esc(p.doseOriginal)}${pctBadge}` : '—')))
            : (p.doseOriginal || cp.doseOriginal || '—');
          const menorBadge = isMenor ? ` <span style="background:${Colors.primary};color:#fff;font-size:8px;font-weight:900;padding:2px 6px;border-radius:4px">MELHOR</span>` : '';
          return `
            <tr style="${rowBg}">
              <td style="${td1Style}">${revendaCell}${menorBadge}</td>
              <td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:9px;width:100px">${doseCell}</td>
              <td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:800;text-align:right;color:${isMenor ? Colors.success : '#111827'}">R$ ${fmtBRL(p.valor)}/ha</td>
            </tr>
          `;
        }).join('');
        return `
          <div style="${topBorder}">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
              <span style="font-size:11px;font-weight:800;color:#1a2e1a">${esc(cp.produto)}</span>
              ${paChip}${fonteChip}${doseSolic ? ' · ' + doseSolic : ''}
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
              <thead>
                <tr style="background:#f3f4f6">
                  <th style="padding:6px 10px;text-align:left;font-size:9px;font-weight:800;color:#6b7280;text-transform:uppercase">Revenda / Alternativa</th>
                  <th style="padding:6px 10px;text-align:left;font-size:9px;font-weight:800;color:#6b7280;text-transform:uppercase;width:90px">Dose</th>
                  <th style="padding:6px 10px;text-align:right;font-size:9px;font-weight:800;color:#6b7280;text-transform:uppercase">R$/ha</th>
                </tr>
              </thead>
              <tbody>${linhas}</tbody>
            </table>
          </div>
        `;
      }).join('');

      return `
        <div style="${catTopMargin}page-break-inside:avoid;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <div style="width:4px;height:16px;background:${catColor};border-radius:99px;flex-shrink:0"></div>
            <span style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.8px;color:${catColor}">${esc(catNome)}</span>
            <div style="flex:1;height:1px;background:#E4EDE4;margin-left:6px"></div>
          </div>
          ${produtosHtml}
        </div>
      `;
    }).join('');

    comparativoCotacoesHtml = `
      <h2 class="section-title">Comparativo de Investimento</h2>
      <div style="background:#fff;border:1px solid #E4EDE4;border-radius:16px;overflow:hidden;margin-bottom:24px;page-break-inside:avoid;break-inside:avoid;">
        ${investBarRows}
        ${economiaBadge ? `<div style="padding:0 20px 14px;">${economiaBadge}</div>` : ''}
      </div>

      ${prodBarRows ? `
      <h2 class="section-title">Comparativo por Produto</h2>
      <div style="background:#fff;border:1px solid #E4EDE4;border-radius:16px;padding:20px;margin-bottom:24px">
        ${prodBarRows}
      </div>` : ''}
    `;
  }

  return `
  <!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @page {
          size: A4;
          margin: 15mm 12mm;
        }
        @media print {
          body { padding: 0 !important; background: #fff !important; }
          .page-break { page-break-before: always; break-before: page; }
        }
        * { box-sizing: border-box; }
        body { 
          font-family: 'Inter', sans-serif; 
          color: #1f2937; 
          margin: 0; 
          padding: 0; 
          -webkit-print-color-adjust: exact; 
          print-color-adjust: exact;
        }
        
        /* CABEÇALHO COM MAPA */
        .header { 
          display: flex; 
          align-items: stretch; 
          gap: 16px; 
          border-bottom: 2px solid #f3f4f6; 
          padding-bottom: 14px; 
          margin-bottom: 14px; 
        }
        .logo-box { 
          width: 90px; 
          height: 90px; 
          border-radius: 12px; 
          background: transparent; 
          border: none; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          overflow: hidden; 
          flex-shrink: 0; 
        }
        .logo-box img { width: 100%; height: 100%; object-fit: contain; background: transparent; }
        .logo-fallback { font-size: 10px; color: #9ca3af; font-weight: 700; text-align: center; text-transform: uppercase; }
        
        .header-info { flex: 1; }
        .doc-title { font-size: 24px; font-weight: 900; color: #111827; margin: 0 0 14px 0; letter-spacing: -0.5px; }
        
        .meta-grid { 
          display: grid; 
          grid-template-columns: 1fr 1fr; 
          gap: 8px 20px; 
          font-size: 12px; 
          color: #4b5563; 
        }
        .meta-grid strong { color: #111827; font-weight: 700; }
        
        .map-box {
          width: 140px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 8px;
          background: #fff;
        }

        .whatsapp-btn {
          display: inline-flex;
          align-items: center;
          background-color: #25D366;
          color: white !important;
          text-decoration: none;
          padding: 8px 14px;
          border-radius: 8px;
          font-weight: 800;
          font-size: 11px;
          margin-top: 10px;
          letter-spacing: 0.3px;
        }
        
        /* CAIXA DE TOTAL */
        .total-box { 
          background: #f0fdf4; 
          border: 1px solid #bbf7d0; 
          border-radius: 10px; 
          padding: 12px 16px; 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          margin-bottom: 12px; 
        }
        .total-label { font-size: 13px; color: #166534; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
        .total-sub { font-size: 11px; color: #166534; opacity: 0.8; margin-top: 4px; display: block; font-weight: 500; }
        .total-val { font-size: 32px; color: ${Colors.success}; font-weight: 900; letter-spacing: -1px; }
        
        .section-title { 
          font-size: 13px; 
          font-weight: 800; 
          color: #111827; 
          text-transform: uppercase; 
          letter-spacing: 0.5px; 
          border-bottom: 2px solid #e5e7eb; 
          padding-bottom: 6px; 
          margin-bottom: 10px; 
          margin-top: 12px; 
        }

        /* GRÁFICO E LEGENDA — compacto, legenda e pizza lado a lado */
        .composition-wrapper {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: flex-start;
          gap: 16px 24px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 14px 16px;
          margin-bottom: 16px;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .donut-chart {
          width: 160px;
          height: 160px;
          flex-shrink: 0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .donut-hole {
          width: 110px;
          height: 110px;
          background: white;
          border-radius: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 6px;
        }
        .donut-lbl { 
          font-size: 9px; 
          color: #6b7280; 
          font-weight: 800; 
          text-transform: uppercase; 
          letter-spacing: 0.5px;
          margin-bottom: 2px;
        }
        .donut-val { 
          font-size: 12px; 
          color: #111827; 
          font-weight: 900; 
        }

        .legend-box { flex: 1; min-width: 180px; }
        .legend-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 11px; }
        .legend-row:last-child { margin-bottom: 0; }
        .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .legend-name { flex: 1; font-weight: 700; color: #374151; }
        .legend-pct { color: #9ca3af; font-weight: 600; font-size: 12px; margin-left: 4px; }
        .legend-bar-wrap { flex: 1; min-width: 50px; height: 4px; background: #f3f4f6; border-radius: 99px; overflow: hidden; }
        .legend-bar { height: 100%; border-radius: 99px; }
        .legend-val { font-weight: 800; color: #111827; min-width: 70px; text-align: right; font-variant-numeric: tabular-nums; font-size: 10px; }

        .pie-legend-wrapper {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
          margin-top: 8px;
        }
        .pie-legend-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 600;
          color: #4b5563;
        }

        /* TABELAS CATEGORIZADAS — compactas, sem quebra de bloco */
        .cat-detail-wrapper { margin-bottom: 6px; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb; page-break-inside: avoid; break-inside: avoid; }
        .cat-detail-header { padding: 6px 12px; color: #fff; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; }
        .cat-detail-table { width: 100%; border-collapse: collapse; margin: 0; }
        .cat-detail-table th { background: #f9fafb; font-size: 9px; color: #6b7280; padding: 5px 10px; text-transform: uppercase; border-bottom: 1px solid #e5e7eb; text-align: left; }
        .cat-detail-table td { padding: 5px 10px; border-bottom: 1px solid #f3f4f6; font-size: 10px; color: #374151; vertical-align: top; }
        .cat-detail-table tr:last-child td { border-bottom: none; }
        
        .prod-name { font-weight: 800; font-size: 11px; color: #111827; margin-bottom: 2px; }
        .badges { display: flex; flex-wrap: wrap; gap: 5px; }
        .badge { 
          background: #e5e7eb; 
          color: #374151; 
          padding: 3px 6px; 
          border-radius: 6px; 
          font-size: 9px; 
          font-weight: 800; 
          text-transform: uppercase; 
          letter-spacing: 0.3px;
        }
        .chip-pa {
          display: inline-flex;
          align-items: center;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #166534;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.3px;
        }
        .chip-fonte {
          display: inline-flex;
          align-items: center;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          color: #1d4ed8;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.3px;
        }
        
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .val-strong { font-weight: 800; color: ${Colors.success}; font-size: 13px; }
        
        .page-break { page-break-before: always; }
        
        /* RODAPÉ */
        .pdf-footer { 
          margin-top: 50px; 
          padding-top: 20px; 
          border-top: 1px solid #e5e7eb; 
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .pdf-footer { background: transparent; }
        .pdf-footer img { height: 60px; object-fit: contain; background: transparent !important; }
        .pdf-footer p { margin: 0; font-size: 11px; color: #9ca3af; font-weight: 500; }
        .pdf-footer strong { color: #111827; font-weight: 800; }
     /* Estilos de Dashboard Profissional para OAgroCota */
        .bar-chart-container {
          margin-bottom: 40px;
          padding: 10px 0;
        }
        .bar-group { 
          margin-bottom: 25px; 
          page-break-inside: avoid;
        }
        .bar-group-title {
          font-size: 11px;
          font-weight: 900;
          color: #4b5563;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
        }
        .bar-group-title::after {
          content: "";
          flex: 1;
          height: 1px;
          background: #e5e7eb;
          margin-left: 10px;
        }
        .bar-row { 
          display: flex; 
          align-items: center; 
          gap: 15px; 
          margin-bottom: 10px; 
        }
        .bar-label {
          width: 140px;
          font-size: 10px;
          font-weight: 600;
          color: #374151;
        }
        .bar-track { 
          flex: 1; 
          height: 8px; 
          background: #f1f5f9; 
          border-radius: 10px; 
          position: relative; 
          overflow: hidden;
        }
        .bar-fill { 
          height: 100%; 
          border-radius: 10px; 
          opacity: 0.9;
        }
        .bar-price { 
          width: 95px; 
          text-align: right; 
          font-size: 11px; 
          font-weight: 800; 
          color: #111827; 
          font-variant-numeric: tabular-nums;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo-box">
          ${input.consultorEmpresa?.logoUrl
            ? `<img src="${esc(input.consultorEmpresa.logoUrl)}" alt="Logo" />`
            : `<span class="logo-fallback">Sem<br/>Logo</span>`}
        </div>
        <div class="header-info">
          <h1 class="doc-title">${esc(input.titulo || 'Relatório Comercial da Cotação')}</h1>
          <div class="meta-grid">
            <div><strong>Fazenda:</strong> ${esc(input.fazendaNome || 'Não informada')}</div>
            <div><strong>Consultor:</strong> ${esc(input.consultorEmpresa?.consultorNome || 'Não informado')}</div>
            ${input.produtorNome ? `<div><strong>Produtor:</strong> ${esc(input.produtorNome)}</div>` : ''}
            <div><strong>Empresa:</strong> ${esc(input.consultorEmpresa?.companyName || 'Não informada')}</div>
            ${input.fazendaLocalizacao ? `<div><strong>Localização:</strong> ${esc(input.fazendaLocalizacao)}</div>` : ''}
            <div><strong>Data de Geração:</strong> ${data}</div>
            ${areaInfoHtml}
          </div>
          ${phoneBr ? `<a class="whatsapp-btn" href="${esc(whatsappHref)}">💬 Falar no WhatsApp: ${esc(phoneFormatted)}</a>` : ''}
        </div>
        ${(svgMapHtml || talhaoDadosHtml) ? `
        <div class="map-box">
          ${svgMapHtml ? `<div style="font-size: 9px; font-weight:800; color:#6b7280; margin-bottom: 6px; letter-spacing:0.5px;">MAPA DO TALHÃO (SATÉLITE)</div>${svgMapHtml}` : ''}
          ${talhaoDadosHtml}
        </div>
        ` : ''}
      </div>

      ${input.destacarValoresPorHa ? `
      <div style="background:#f0fdf4;border:2px solid ${Colors.primary};border-radius:12px;padding:14px 18px;margin-bottom:16px;">
        <div style="font-size:11px;font-weight:900;color:${Colors.primary};text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;">⚠ Valores por hectare (R$/ha)</div>
        <div style="font-size:12px;font-weight:600;color:#166534;line-height:1.5;">
          Todos os preços nesta cotação são por hectare. O investimento total será calculado automaticamente conforme a área do talhão selecionado ao aceitar a proposta.
        </div>
      </div>
      ` : ''}

      <div class="total-box">
        <div>
          <div class="total-label">${labelPrincipal} ${input.destacarValoresPorHa ? '(R$/ha)' : ''}</div>
          <div class="total-sub">${input.destacarValoresPorHa ? 'Valores por hectare · Total calculado pela área do talhão ao aceitar' : 'Resumo baseado nas opções de menor custo'}</div>
        </div>
        <div class="total-val">R$ ${fmtBRL(valorPrincipal)}${input.destacarValoresPorHa ? '/ha' : ''}</div>
      </div>

      ${comparativoCotacoesHtml}
      
      ${!hasComparativo ? `
      <h2 class="section-title">Composição de Custo</h2>
      <div class="composition-wrapper" style="page-break-inside:avoid;break-inside:avoid;">
        <div class="legend-box">${categoriasResumoHtml}</div>
        <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;line-height:0;">
          ${svgDonutCot(
            categoriasOrdenadas.map(cat => ({ value: cat.somaMin, color: getCatColor(cat.categoria) })),
            80,
            'R$ ' + fmtBRL(totalSomaCategorias),
            'Investimento'
          )}
        </div>
      </div>

      <h2 class="section-title">Detalhamento Completo dos Insumos</h2>
      ${tabelasCategorizadasHtml}
      ` : ''}

      ${input.aceiteProdutor ? `
      <div style="page-break-inside:avoid;margin-top:32px;border:2px solid ${Colors.primary};border-radius:14px;overflow:hidden;">
        <div style="background:${Colors.primary};padding:12px 20px;display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:13px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:.8px">Aceite do Produtor Registrado</span>
          ${input.aceiteProdutor.aceitoEm ? `<span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.85)">${new Date(input.aceiteProdutor.aceitoEm).toLocaleString('pt-BR')}</span>` : ''}
        </div>
        <div style="background:#f0fdf4;padding:18px 20px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;">
            <div>
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin-bottom:3px">Proposta Aceita</div>
              <div style="font-size:14px;font-weight:900;color:${Colors.success}">${esc(input.aceiteProdutor.cotacaoEscolhida)}</div>
            </div>
            <div>
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin-bottom:3px">Valor Total</div>
              <div style="font-size:14px;font-weight:900;color:${Colors.success}">R$ ${fmtBRL(input.aceiteProdutor.totalEscolhido)}</div>
            </div>
            ${input.aceiteProdutor.produtorNome ? `
            <div>
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin-bottom:3px">Produtor</div>
              <div style="font-size:13px;font-weight:700;color:#1a2e1a">${esc(input.aceiteProdutor.produtorNome)}</div>
            </div>` : ''}
            ${input.fazendaNome ? `
            <div>
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin-bottom:3px">Fazenda</div>
              <div style="font-size:13px;font-weight:700;color:#1a2e1a">${esc(input.fazendaNome)}</div>
            </div>` : ''}
          </div>
          <div style="margin-top:20px;border-top:1px dashed #bbf7d0;padding-top:16px;display:flex;gap:40px;">
            <div style="flex:1;text-align:center;">
              <div style="height:1px;background:#9ca3af;margin-bottom:6px;margin-top:40px"></div>
              <div style="font-size:10px;color:#6b7280;font-weight:600">Assinatura do Produtor</div>
            </div>
            <div style="flex:1;text-align:center;">
              <div style="height:1px;background:#9ca3af;margin-bottom:6px;margin-top:40px"></div>
              <div style="font-size:10px;color:#6b7280;font-weight:600">Assinatura do Consultor</div>
            </div>
          </div>
        </div>
      </div>
      ` : `
      <div style="page-break-inside:avoid;margin-top:32px;border:1px dashed #d1d5db;border-radius:14px;padding:20px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;margin-bottom:20px;text-align:center">Área de Assinatura — Aceite do Produtor</div>
        <div style="display:flex;gap:40px;margin-top:10px;">
          <div style="flex:1;text-align:center;">
            <div style="height:1px;background:#9ca3af;margin-bottom:6px;margin-top:40px"></div>
            <div style="font-size:10px;color:#6b7280;font-weight:600">Assinatura do Produtor</div>
            ${input.produtorNome ? `<div style="font-size:9px;color:#9ca3af;margin-top:2px">${esc(input.produtorNome)}</div>` : ''}
          </div>
          <div style="flex:1;text-align:center;">
            <div style="height:1px;background:#9ca3af;margin-bottom:6px;margin-top:40px"></div>
            <div style="font-size:10px;color:#6b7280;font-weight:600">Assinatura do Consultor</div>
            ${input.consultorEmpresa?.consultorNome ? `<div style="font-size:9px;color:#9ca3af;margin-top:2px">${esc(input.consultorEmpresa.consultorNome)}</div>` : ''}
          </div>
        </div>
      </div>
      `}

      <div class="pdf-footer">
        ${appLogoBase64 ? `<img src="data:image/png;base64,${appLogoBase64}" alt="OAgroCota Logo" style="background:transparent" />` : ''}
        <p>Documento gerado via aplicativo <strong>OAgroCota</strong>.</p>
      </div>

    </body>
  </html>
  `;
}

export async function exportarCotacaoPdf(input: ExportCotacaoPdfInput): Promise<void> {
  try {
    let appLogoBase64: string | undefined;
    try {
      const asset = Asset.fromModule(require('../../assets/logo-transparent.png'));
      await asset.downloadAsync();
      if (asset.localUri) {
        appLogoBase64 = await FileSystem.readAsStringAsync(asset.localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
    } catch (_) {
      // logo carregamento opcional — continua sem
    }
    const html = buildHtml(input, appLogoBase64);
    const { uri } = await Print.printToFileAsync({ html });

    const safeTitle = (input.titulo || 'cotacao')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);

    const fileName = `cotacao_${safeTitle || 'relatorio'}_${Date.now()}.pdf`;
    const destino = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.copyAsync({ from: uri, to: destino });

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert('PDF gerado', 'Arquivo criado, mas compartilhamento não está disponível neste dispositivo.');
      return;
    }

    await Sharing.shareAsync(destino, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Exportar relatório da cotação (PDF)',
    });
  } catch (err: any) {
    Alert.alert('Erro ao exportar PDF', err?.message ?? 'Não foi possível gerar o PDF.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export PDF: Comparativo de propostas recebidas (PropostasFornecedorScreen)
// ─────────────────────────────────────────────────────────────────────────────

export interface PropostasComparativoPdfInput {
  titulo: string;
  propostas: { id: string; empresa_nome: string; total_proposta: number }[];
  itensComparacao: {
    id: string; produto: string; categoria: string; principio_ativo: string; fonte: string;
    melhorValor: number;
    propostas: {
      propostaId: string; empresa: string; valor_ha: number; info?: string;
      isAlternativa?: boolean; produtoAlternativo?: string; doseAlternativa?: string; doseOriginal?: string;
    }[];
  }[];
  consultorEmpresa?: {
    companyName?: string;
    consultorNome?: string;
    cnpj?: string;
    phone?: string;
    logoUrl?: string;
  };
  fazendaNome?: string;
  produtorNome?: string;
  fazendaLocalizacao?: string;
}

export async function exportarPropostasComparativoPdf(input: PropostasComparativoPdfInput): Promise<void> {
  const { propostas, itensComparacao } = input;
  if (propostas.length === 0 || itensComparacao.length === 0) {
    Alert.alert('Sem dados', 'Não há propostas ou produtos para gerar o PDF.');
    return;
  }

  const totalMin = Math.min(...propostas.map(p => p.total_proposta));
  const totalMax = Math.max(...propostas.map(p => p.total_proposta));
  const economia = totalMax - totalMin;

  const comparativoCotacoes = propostas.map(p => ({
    titulo: p.empresa_nome,
    totalGeral: p.total_proposta,
  }));

  const comparativoProdutos = itensComparacao.map(item => ({
    categoria: item.categoria || 'Insumo',
    produto: item.produto,
    principio_ativo: item.principio_ativo || null,
    fonte: item.fonte || null,
    doseOriginal: item.dose || undefined,
    precos: item.propostas.map(prop => ({
      titulo: prop.empresa,
      valor: prop.valor_ha,
      isAlternativa: prop.isAlternativa,
      produtoAlternativo: prop.produtoAlternativo,
      doseOriginal: prop.doseOriginal,
      doseAlternativa: prop.doseAlternativa,
      pctDiferencaDose: prop.pctDiferencaDose,
    })),
  }));

  const catMap = new Map<string, PdfCategoriaCotacao>();
  itensComparacao.forEach(item => {
    const cat = item.categoria || 'Insumo';
    if (!catMap.has(cat)) {
      catMap.set(cat, {
        categoria: cat,
        color: getCatColor(cat),
        somaMin: 0,
        somaMax: 0,
        produtos: [],
      });
    }
    const entry = catMap.get(cat)!;
    const minVal = item.melhorValor;
    const maxVal = Math.max(...item.propostas.map(p => p.valor_ha), 0);
    entry.somaMin += minVal;
    entry.somaMax += maxVal;
    entry.produtos.push({
      produto: item.produto,
      principio_ativo: item.principio_ativo || null,
      fonte: item.fonte || null,
      opcoes: item.propostas.map(p => ({
        fornecedor: p.empresa,
        valorHa: p.valor_ha,
        doseHa: null,
        unidade: null,
        indisponivel: false,
        isAlternativa: p.isAlternativa ?? false,
        produtoAlternativo: p.produtoAlternativo ?? undefined,
        doseAlternativa: p.doseAlternativa ?? undefined,
        doseOriginal: p.doseOriginal ?? undefined,
        pctDiferencaDose: p.pctDiferencaDose ?? undefined,
      })),
    });
  });

  const categorias = Array.from(catMap.values());

  await exportarCotacaoPdf({
    titulo: `Comparativo — ${input.titulo}`,
    dataGeracao: new Date(),
    totalGeralMin: totalMin,
    totalGeralMax: totalMax,
    economiaPotencial: economia,
    categorias,
    fazendaNome: input.fazendaNome,
    produtorNome: input.produtorNome,
    fazendaLocalizacao: input.fazendaLocalizacao,
    consultorEmpresa: input.consultorEmpresa,
    comparativoCotacoes,
    comparativoProdutos,
    destacarValoresPorHa: true,
  });
}