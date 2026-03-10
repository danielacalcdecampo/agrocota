import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert } from 'react-native';
import { Asset } from 'expo-asset';
import { Colors, getCatColor } from '../theme/colors';

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface GestaoInsumoItem {
  nome: string;
  categoria: string;
  valorHa: number;
  areaHa: number;
  total: number;
  comprado: boolean;
  cotacaoTitulo?: string;
  fornecedor?: string;
  dose_ha?: number;
  isAlternativa?: boolean;
  produtoOriginal?: string;
  doseOriginal?: number;
}

export interface GestaoCustoOperacional {
  descricao: string;
  valorHa: number;
  areaHa: number;
  total: number;
  unidade: 'reais' | 'sacas';
  valorOriginal?: number;
  precoSojaRef?: number;
}

export interface GestaoCenario {
  label: string;
  talhaoNome: string;
  safraAnome: string;
  areaHa: number;
  insumos: GestaoInsumoItem[];
  custosOp: GestaoCustoOperacional[];
  produtividade_ha: number;
  preco_soja: number;
  totalInsumos: number;
  totalOperacional: number;
  totalCusto: number;
  receita: number;
  lucro: number;
  custoHa: number;
  lucroHa: number;
  pontoNivelamento: number;
  margemSeguranca: number;
}

export interface ConsultorEmpresaInfo {
  companyName?: string;
  consultorNome?: string;
  cnpj?: string;
  phone?: string;
  logoUrl?: string;
}

export interface GestaoComparacaoPdfInput {
  consultorEmpresa?: ConsultorEmpresaInfo;
  fazendaNome?: string;
  produtorNome?: string;
  cenarioA: GestaoCenario;
  cenarioB: GestaoCenario;
  dataGeracao?: Date;
}

export interface GestaoAnalisePdfInput {
  consultorEmpresa?: ConsultorEmpresaInfo;
  fazendaNome?: string;
  produtorNome?: string;
  talhaoNome?: string;
  safraNome?: string;
  areaHa: number;
  insumos: GestaoInsumoItem[];
  custosOp: GestaoCustoOperacional[];
  totalInsumos: number;
  totalOperacional: number;
  totalGeral: number;
  totalInsumosComprados: number;
  totalInsumosPendentes: number;
  produtividade_ha?: number;
  preco_soja?: number;
  receita?: number;
  lucro?: number;
  custoHa?: number;
  lucroHa?: number;
  pontoNivelamento?: number;
  margemSeguranca?: number;
  dataGeracao?: Date;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

const fmtBRL = (n: number) =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmt2 = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (v: string) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── SHARED CSS ────────────────────────────────────────────────────────────────

function sharedCss(): string {
  const G = Colors.primary;        // #1a5c25
  const GD = Colors.primaryDark;   // #0f4b1e
  return `
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
      color: #0f1f13;
      margin: 0;
      padding: 0;
      background: #f5faf6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      display: flex; align-items: stretch; gap: 20px;
      background: ${GD}; color: #fff;
      border-radius: 16px; padding: 16px 20px;
      margin-bottom: 12px;
    }
    .logo-box {
      width: 80px; height: 80px; border-radius: 12px;
      background: rgba(255,255,255,0.12); border: 1.5px solid rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; flex-shrink: 0;
    }
    .logo-box img { width: 100%; height: 100%; object-fit: contain; }
    .logo-fallback { font-size: 9px; color: rgba(255,255,255,0.6); font-weight: 700; text-align: center; text-transform: uppercase; }
    .header-info { flex: 1; }
    .doc-title { font-size: 22px; font-weight: 900; color: #fff; margin: 0 0 8px 0; letter-spacing: -0.5px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 18px; font-size: 11px; color: rgba(255,255,255,0.7); }
    .meta-grid strong { color: #fff; font-weight: 700; }
    .section-title {
      font-size: 11px; font-weight: 800; color: ${G};
      text-transform: uppercase; letter-spacing: 1px;
      border-left: 3px solid ${G}; padding-left: 8px;
      margin: 12px 0 6px 0;
    }
    .card {
      background: #fff; border: 1px solid #d6e8da;
      border-radius: 14px; padding: 10px; margin-bottom: 6px;
    }
    .page-break { page-break-before: always; }
    .avoid-break { page-break-inside: avoid; }
    table { border-collapse: collapse; width: 100%; }
    .pdf-footer {
      margin-top: 14px; padding-top: 10px; border-top: 1px solid #d6e8da;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      background: transparent;
    }
    .pdf-footer p { font-size: 11px; color: #4a6b53; font-weight: 500; }
    .pdf-footer strong { color: ${G}; font-weight: 800; }
    .pdf-footer img { height: 60px; object-fit: contain; background: transparent !important; }
    .total-box {
      background: #edf7ef; border: 1.5px solid #a8d5b5; border-radius: 14px;
      padding: 14px 16px; display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 8px;
    }
    .total-label { font-size: 12px; color: ${G}; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
    .total-sub { font-size: 11px; color: #4a6b53; margin-top: 4px; display: block; font-weight: 500; }
    .total-val { font-size: 30px; color: ${Colors.success}; font-weight: 900; letter-spacing: -1px; }
    .composition-wrapper {
      display: flex; flex-direction: column; align-items: stretch; gap: 8px;
      background: #ffffff; border: 1px solid #d6e8da; border-radius: 14px;
      padding: 12px; margin-bottom: 8px;
      page-break-inside: avoid; break-inside: avoid;
    }
    .donut-chart {
      width: 180px; height: 180px; margin: 0 auto; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .donut-hole {
      width: 120px; height: 120px; background: white; border-radius: 50%;
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; text-align: center; padding: 8px;
    }
    .donut-lbl { font-size: 10px; color: #4a6b53; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .donut-val { font-size: 13px; color: #0f1f13; font-weight: 900; }
    .legend-box { flex: 1; width: 100%; }
    .legend-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 12px; }
    .legend-row:last-child { margin-bottom: 0; }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .legend-name { flex: 1; font-weight: 700; color: #0f1f13; }
    .legend-pct { color: #4a6b53; font-weight: 600; font-size: 11px; margin-left: 4px; }
    .legend-bar-wrap { flex: 1.5; height: 7px; background: #e8f0ea; border-radius: 99px; overflow: hidden; }
    .legend-bar { height: 100%; border-radius: 99px; }
    .legend-val { font-weight: 800; color: #0f1f13; min-width: 90px; text-align: right; font-variant-numeric: tabular-nums; }
    .pie-legend-wrapper { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; margin-top: 18px; }
    .pie-legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #4a6b53; }
    .cat-detail-wrapper { margin-bottom: 4px; border-radius: 10px; overflow: hidden; border: 1px solid #d6e8da; }
    .cat-detail-header { padding: 6px 12px; color: #fff; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; display: flex; justify-content: space-between; }
    .cat-detail-table { width: 100%; border-collapse: collapse; margin: 0; }
    .cat-detail-table th { background: #f0f7f2; font-size: 9px; color: #4a6b53; padding: 4px 10px; text-transform: uppercase; border-bottom: 1px solid #d6e8da; text-align: left; font-weight: 700; }
    .cat-detail-table td { padding: 4px 10px; border-bottom: 1px solid #edf5ef; font-size: 10px; color: #0f1f13; vertical-align: top; }
    .cat-detail-table tr:last-child td { border-bottom: none; }
    .kpi-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 10px; }
    .kpi-card { background: #fff; border: 1px solid #d6e8da; border-radius: 12px; padding: 10px; border-top: 3px solid; }
    .kpi-lbl { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; }
    .kpi-val { font-size: 15px; font-weight: 900; color: #0f1f13; }
    .kpi-sub { font-size: 9px; color: #4a6b53; margin-top: 2px; }
    /* SVG bar chart */
    .bar-chart-wrap { background:#fff; border:1px solid #d6e8da; border-radius:14px; padding:12px 14px; margin-bottom:8px; }
    .bar-row { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
    .bar-row:last-child { margin-bottom:0; }
    .bar-label { width:120px; font-size:10px; font-weight:700; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .bar-track { flex:1; height:13px; background:#e8f0ea; border-radius:99px; overflow:hidden; }
    .bar-fill { height:100%; border-radius:99px; }
    .bar-value { width:100px; text-align:right; font-size:10px; font-weight:800; font-variant-numeric:tabular-nums; flex-shrink:0; }
  `;
}

function headerHtml(
  logoBase64: string | undefined,
  title: string,
  meta: { label: string; value: string }[],
  data: string
): string {
  return `
  <div class="header">
    <div class="logo-box">
      ${logoBase64
        ? `<img src="data:image/png;base64,${logoBase64}" alt="Logo" />`
        : `<span class="logo-fallback">Sem<br/>Logo</span>`}
    </div>
    <div class="header-info">
      <h1 class="doc-title">${esc(title)}</h1>
      <div class="meta-grid">
        ${meta.map(m => `<div><strong>${esc(m.label)}:</strong> ${esc(m.value)}</div>`).join('')}
        <div><strong>Data de Geração:</strong> ${data}</div>
      </div>
    </div>
  </div>`;
}

function footerHtml(appLogoBase64?: string): string {
  return `
  <div class="pdf-footer">
    ${appLogoBase64 ? `<img src="data:image/png;base64,${appLogoBase64}" alt="OAgroCota Logo" style="background:transparent"/>` : ''}
    <p>Documento gerado via aplicativo <strong>OAgroCota</strong>.</p>
  </div>`;
}

// ── SVG VERTICAL GROUPED BAR CHART ────────────────────────────────────────────

function svgGroupedBars(
  groups: { label: string; aVal: number; bVal: number; isCost: boolean }[],
  aLabel: string,
  bLabel: string,
  colorA: string,
  colorB: string,
  colorNeg: string,
): string {
  const W = 520, H = 195;
  const padT = 34, padB = 52, padL = 8, padR = 8;
  const chartH = H - padT - padB;
  const chartW = W - padL - padR;
  const maxAbs = Math.max(...groups.flatMap(m => [Math.abs(m.aVal), Math.abs(m.bVal)]), 1);
  const gW = chartW / groups.length;
  const bW = Math.floor(gW * 0.27);
  const bGap = Math.floor(gW * 0.05);
  const baseY = padT + chartH;

  const fmtK = (n: number): string => {
    const s = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1_000_000) return `${s}R$${(a / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000)     return `${s}R$${Math.round(a / 1_000)}k`;
    return `${s}R$${Math.round(a)}`;
  };

  const bars = groups.map((g, gi) => {
    const cx = padL + gi * gW + gW / 2;
    const aX = cx - bW - bGap / 2;
    const bX = cx + bGap / 2;
    const aH = Math.max((Math.abs(g.aVal) / maxAbs) * chartH, 3);
    const bH = Math.max((Math.abs(g.bVal) / maxAbs) * chartH, 3);
    const cA = g.aVal < 0 ? colorNeg : colorA;
    const cB = g.bVal < 0 ? colorNeg : colorB;
    const aWins = g.isCost ? g.aVal < g.bVal : g.aVal > g.bVal;
    const bWins = g.isCost ? g.bVal < g.aVal : g.bVal > g.aVal;
    const aY = baseY - aH;
    const bY = baseY - bH;
    return `
      <rect x="${aX}" y="${aY}" width="${bW}" height="${aH}" fill="${cA}" rx="3" opacity="0.92"/>
      <rect x="${bX}" y="${bY}" width="${bW}" height="${bH}" fill="${cB}" rx="3" opacity="0.92"/>
      ${aWins ? `<text x="${aX + bW/2}" y="${aY - 3}" text-anchor="middle" font-size="9" fill="${cA}" font-weight="900">▲</text>` : ''}
      ${bWins ? `<text x="${bX + bW/2}" y="${bY - 3}" text-anchor="middle" font-size="9" fill="${cB}" font-weight="900">▲</text>` : ''}
      <text x="${aX + bW/2}" y="${Math.max(aY - (aWins ? 14 : 3), padT + 8)}" text-anchor="middle" font-size="7" fill="${cA}" font-weight="700">${fmtK(g.aVal)}</text>
      <text x="${bX + bW/2}" y="${Math.max(bY - (bWins ? 14 : 3), padT + 8)}" text-anchor="middle" font-size="7" fill="${cB}" font-weight="700">${fmtK(g.bVal)}</text>
      <text x="${cx}" y="${baseY + 13}" text-anchor="middle" font-size="8" fill="#374151" font-weight="700">${esc(g.label)}</text>`;
  }).join('');

  // Horizontal reference lines
  const gridLines = [0.25, 0.5, 0.75, 1.0].map(f => {
    const y = padT + chartH - f * chartH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e5e7eb" stroke-width="0.8" stroke-dasharray="3,3"/>`;
  }).join('');

  const legY = H - 14;
  const mid = W / 2;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;">
    ${gridLines}
    <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#d1d5db" stroke-width="1"/>
    ${bars}
    <rect x="${mid - 120}" y="${legY - 6}" width="8" height="8" fill="${colorA}" rx="2"/>
    <text x="${mid - 108}" y="${legY + 1}" font-size="8" fill="${colorA}" font-weight="700">${esc(aLabel)}</text>
    <rect x="${mid}" y="${legY - 6}" width="8" height="8" fill="${colorB}" rx="2"/>
    <text x="${mid + 12}" y="${legY + 1}" font-size="8" fill="${colorB}" font-weight="700">${esc(bLabel)}</text>
  </svg>`;
}

// ── SVG SINGLE VERTICAL BAR CHART ─────────────────────────────────────────────

function svgSingleBars(
  bars: { label: string; value: number; color: string }[],
): string {
  const W = 520, H = 170;
  const padT = 32, padB = 44, padL = 12, padR = 12;
  const chartH = H - padT - padB;
  const chartW = W - padL - padR;
  const maxAbs = Math.max(...bars.map(b => Math.abs(b.value)), 1);
  const gW = chartW / bars.length;
  const bW = Math.floor(gW * 0.42);

  const fmtK = (n: number): string => {
    const s = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1_000_000) return `${s}R$${(a / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000)     return `${s}R$${Math.round(a / 1_000)}k`;
    return `${s}R$${Math.round(a)}`;
  };

  const baseY = padT + chartH;
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
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bW}" height="${bH.toFixed(1)}" rx="3" fill="${bar.color}" opacity="0.93"/>
      <text x="${(x + bW / 2).toFixed(1)}" y="${valueY.toFixed(1)}" text-anchor="middle" font-size="8" fill="${bar.color}" font-weight="800">${fmtK(bar.value)}</text>
      <text x="${(x + bW / 2).toFixed(1)}" y="${(baseY + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="#374151" font-weight="700">${esc(bar.label)}</text>`;
  }).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;">
    ${gridLines}
    <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#d1d5db" stroke-width="1"/>
    ${rects}
  </svg>`;
}

// ── SVG DONUT ─────────────────────────────────────────────────────────────────

function svgDonut(
  slices: { value: number; color: string }[],
  r = 80,
  centerLabel = '',
  centerSub = '',
): string {
  const size = r * 2 + 4;
  const cx = size / 2, cy = size / 2;
  const ri = r * 0.6;
  const total = slices.reduce((s, v) => s + v.value, 0);
  if (total <= 0) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#e8f0ea"/>
      <circle cx="${cx}" cy="${cy}" r="${ri}" fill="white"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#4a6b53" font-weight="700">Sem dados</text>
    </svg>`;
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
      // Círculo completo: usa elementos circle (mais confiável que arcos SVG)
      paths.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}"/>`);
    } else {
      paths.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ri} ${ri} 0 ${lg} 0 ${xi1} ${yi1} Z" fill="${s.color}"/>`);
    }
    angle += sweep;
  });
  const fs = r > 60 ? 12 : 9;
  const fsub = r > 60 ? 9 : 7;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${paths.join('')}
    <circle cx="${cx}" cy="${cy}" r="${ri}" fill="white"/>
    ${centerLabel ? `<text x="${cx}" y="${cy - fsub}" text-anchor="middle" font-size="${fs}" fill="#0f1f13" font-weight="900">${esc(centerLabel)}</text>` : ''}
    ${centerSub   ? `<text x="${cx}" y="${cy + fs}" text-anchor="middle" font-size="${fsub}" fill="#4a6b53" font-weight="700" text-transform="uppercase">${esc(centerSub)}</text>` : ''}
  </svg>`;
}

// ── ANALISE HTML ──────────────────────────────────────────────────────────────

function buildAnaliseHtml(input: GestaoAnalisePdfInput, appLogoBase64?: string): string {
  const GREEN = Colors.primary;
  const BLUE  = '#1565C0';
  const AMBER = '#F57C00';
  const data  = (input.dataGeracao ?? new Date()).toLocaleString('pt-BR');

  const meta: { label: string; value: string }[] = [
    { label: 'Fazenda', value: input.fazendaNome || 'Não informada' },
    { label: 'Produtor', value: input.produtorNome || 'Não informado' },
    { label: 'Consultor', value: input.consultorEmpresa?.consultorNome || 'Não informado' },
    { label: 'Empresa', value: input.consultorEmpresa?.companyName || 'Não informada' },
    { label: 'Talhão', value: input.talhaoNome || 'Não informado' },
    { label: 'Safra', value: input.safraNome || 'Não informada' },
    { label: 'Área', value: `${fmt2(input.areaHa)} ha` },
  ];

  // Donut chart - custos
  const totalDonut = input.totalInsumos + input.totalOperacional;
  const pctIns = totalDonut > 0 ? (input.totalInsumos / totalDonut) * 100 : 50;
  const pctOp  = 100 - pctIns;
  const pieStyle = totalDonut > 0
    ? `background: conic-gradient(${GREEN} 0% ${pctIns}%, ${BLUE} ${pctIns}% 100%);`
    : 'background: #e5e7eb;';

  // Donut chart - comprados vs pendentes
  const totalComp = input.totalInsumosComprados + input.totalInsumosPendentes;
  const pctComp = totalComp > 0 ? (input.totalInsumosComprados / totalComp) * 100 : 0;
  const pctPend = 100 - pctComp;
  const pieCompStyle = totalComp > 0
    ? `background: conic-gradient(${Colors.success} 0% ${pctComp}%, ${AMBER} ${pctComp}% 100%);`
    : 'background: #e5e7eb;';

  // Bar chart para comparar insumos vs operacional
  const maxBar = Math.max(input.totalInsumos, input.totalOperacional, 1);
  const pctInsBar = (input.totalInsumos / maxBar * 100).toFixed(1);
  const pctOpBar  = (input.totalOperacional / maxBar * 100).toFixed(1);

  // Insumos agrupados por categoria
  const porCat: Record<string, GestaoInsumoItem[]> = {};
  input.insumos.forEach(i => {
    if (!porCat[i.categoria]) porCat[i.categoria] = [];
    porCat[i.categoria].push(i);
  });
  const catNames = Object.keys(porCat).sort();
  const catColors: Record<string, string> = {};
  catNames.forEach(cat => { catColors[cat] = getCatColor(cat); });

  // Categoria legend for donut (por categoria de insumos)
  const totalCatSum = input.insumos.reduce((s, i) => s + i.total, 0);
  const catTotals = catNames.map(cat => ({ cat, total: porCat[cat].reduce((s, i) => s + i.total, 0) }))
    .sort((a, b) => b.total - a.total);

  let currentPct = 0;
  const catPieStops = catTotals.map(({ cat, total }) => {
    const color = catColors[cat];
    const pct = totalCatSum > 0 ? (total / totalCatSum) * 100 : 0;
    const start = currentPct;
    currentPct += pct;
    return `${color} ${start}% ${currentPct}%`;
  }).join(', ');
  const catPieStyle = totalCatSum > 0 ? `background: conic-gradient(${catPieStops});` : 'background: #e5e7eb;';

  const catLegendHtml = catTotals.map(({ cat, total }) => {
    const color = catColors[cat];
    const pct = totalCatSum > 0 ? ((total / totalCatSum) * 100).toFixed(1) : '0.0';
    return `
      <div class="legend-row">
        <div class="dot" style="background: ${color}"></div>
        <div class="legend-name">${esc(cat)} <span class="legend-pct">(${pct}%)</span></div>
        <div class="legend-bar-wrap"><div class="legend-bar" style="width: ${pct}%; background: ${color}"></div></div>
        <div class="legend-val">${fmtBRL(total)}</div>
      </div>`;
  }).join('');

  const catPieLegend = catTotals.map(({ cat }) => `
    <div class="pie-legend-item">
      <div class="dot" style="background: ${catColors[cat]}"></div>
      <span>${esc(cat)}</span>
    </div>`).join('');

  // Insumos detail tables
  const insumosDetailHtml = catNames.map(cat => {
    const itens = porCat[cat];
    const color = catColors[cat];
    const totalCat = itens.reduce((s, i) => s + i.total, 0);
    const rows = itens.map(item => `
      <tr>
        <td style="padding:5px 10px;font-size:10px;color:#374151;border-bottom:1px solid #f3f4f6;">
          ${item.isAlternativa ? `<span style="background:#fef3c7;color:#92400e;font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;margin-right:4px">ALT</span>` : ''}
          <strong>${esc(item.nome)}</strong>
          ${item.comprado
            ? `<span style="background:${Colors.successBg};color:${Colors.success};font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;margin-left:4px">COMPRADO</span>`
            : '<span style="background:#fef3c7;color:#b45309;font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;margin-left:4px">PENDENTE</span>'}
          ${item.isAlternativa && item.produtoOriginal ? `<div style="font-size:8px;color:#9ca3af;margin-top:2px;">Orig: <span style="text-decoration:line-through">${esc(item.produtoOriginal)}</span></div>` : ''}
          ${item.fornecedor ? `<div style="font-size:8px;color:#4a6b53;margin-top:1px;">Revenda: <strong>${esc(item.fornecedor)}</strong></div>` : ''}
          ${item.cotacaoTitulo ? `<span style="background:#f3f4f6;color:#6b7280;font-size:7px;font-weight:700;padding:1px 4px;border-radius:3px;margin-top:2px;display:inline-block">${esc(item.cotacaoTitulo)}</span>` : ''}
        </td>
        <td style="padding:5px 10px;font-size:10px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;white-space:nowrap;">
          ${fmtBRL(item.valorHa)}/ha
          ${item.isAlternativa && item.doseOriginal != null
              ? `<div style="font-size:8px;color:#6b7280;margin-top:1px;">
                   Orig: <span style="text-decoration:line-through;color:#9ca3af">${fmt2(item.doseOriginal)} L/ha</span>
                   ${item.dose_ha != null ? ` → <span style="color:#b45309;font-weight:700">Alt: ${fmt2(item.dose_ha)} L/ha</span>` : ''}
                 </div>`
              : (item.dose_ha != null ? `<div style="font-size:8px;color:#6b7280;margin-top:1px;">Dose: ${fmt2(item.dose_ha)} L/ha</div>` : '')}
        </td>
        <td style="padding:5px 10px;font-size:10px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${fmt2(item.areaHa)} ha</td>
        <td style="padding:5px 10px;font-size:10px;font-weight:800;text-align:right;color:#111827;border-bottom:1px solid #f3f4f6;">${fmtBRL(item.total)}</td>
      </tr>`).join('');
    return `
      <div class="cat-detail-wrapper">
        <div class="cat-detail-header" style="background:${color};display:flex;justify-content:space-between;">
          <span>${esc(cat)}</span>
          <span>${fmtBRL(totalCat)}</span>
        </div>
        <table class="cat-detail-table">
          <thead>
            <tr>
              <th>Produto / Revenda</th>
              <th style="text-align:right">R$/ha · Dose</th>
              <th style="text-align:right">Área</th>
              <th style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  // Custos operacionais table
  const custosRows = input.custosOp.map((c, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'}">
      <td style="padding:5px 10px;font-size:10px;color:#374151;border-bottom:1px solid #f3f4f6;">
        ${esc(c.descricao)}
        <span style="background:${c.unidade === 'sacas' ? Colors.successBg : '#eff6ff'};color:${c.unidade === 'sacas' ? Colors.success : '#1d4ed8'};font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;margin-left:4px">${c.unidade === 'sacas' ? 'SACAS' : 'R$'}</span>
        ${c.unidade === 'sacas' && c.valorOriginal != null ? `<span style="font-size:8px;color:#9ca3af;margin-left:4px">${fmt2(c.valorOriginal)} sc × ${fmtBRL(c.precoSojaRef ?? 0)}</span>` : ''}
      </td>
      <td style="padding:5px 10px;font-size:10px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${fmtBRL(c.valorHa)}/ha</td>
      <td style="padding:5px 10px;font-size:10px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;">${fmt2(c.areaHa)} ha</td>
      <td style="padding:5px 10px;font-size:10px;font-weight:800;text-align:right;color:#111827;border-bottom:1px solid #f3f4f6;">${fmtBRL(c.total)}</td>
    </tr>`).join('');

  // Resultado financeiro (se tiver dados)
  const temResultado = input.produtividade_ha && input.preco_soja && input.receita != null;
  const resultadoHtml = temResultado ? `
    <h2 class="section-title" style="margin-top:12px;">Resultado Financeiro</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      ${[
        { label: 'Custo Total',          value: fmtBRL(input.totalGeral),          sub: `${fmtBRL(input.custoHa ?? 0)}/ha`,                                                                          color: '#F57C00', bg: '#fff7ed', border: '#fed7aa' },
        { label: 'Ponto de Nivelamento', value: `${fmt2(input.pontoNivelamento ?? 0)} sc/ha`, sub: `Produção mín.: ${fmt2(input.pontoNivelamento ?? 0)} sc/ha · Esperada: ${fmt2(input.produtividade_ha ?? 0)} sc/ha`, color: '#9333ea', bg: '#faf5ff', border: '#e9d5ff' },
        { label: 'Receita Bruta',        value: fmtBRL(input.receita ?? 0),        sub: `${fmt2(input.produtividade_ha ?? 0)} sc/ha × ${fmtBRL(input.preco_soja ?? 0)}`,                             color: GREEN, bg: '#f0fdf4', border: '#bbf7d0' },
        { label: 'Lucro Líquido',        value: fmtBRL(input.lucro ?? 0),          sub: `${fmtBRL(input.lucroHa ?? 0)}/ha`,                                                                         color: (input.lucro ?? 0) >= 0 ? GREEN : '#dc2626', bg: (input.lucro ?? 0) >= 0 ? '#f0fdf4' : '#fef2f2', border: (input.lucro ?? 0) >= 0 ? '#bbf7d0' : '#fecaca' },
      ].map(r => `
        <div style="background:${r.bg};border:1px solid ${r.border};border-radius:12px;padding:12px;">
          <div style="font-size:9px;font-weight:800;color:${r.color};text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${esc(r.label)}</div>
          <div style="font-size:20px;font-weight:900;color:${r.color}">${esc(r.value)}</div>
          <div style="font-size:10px;color:${r.color};opacity:.7;margin-top:2px">${esc(r.sub)}</div>
        </div>`).join('')}
    </div>
    ${(() => {
      const ms = input.margemSeguranca ?? 0;
      const msColor  = ms >= 30 ? '#15803d' : ms >= 10 ? '#b45309' : '#dc2626';
      const msBg     = ms >= 30 ? '#f0fdf4' : ms >= 10 ? '#fffbeb' : '#fef2f2';
      const msBorder = ms >= 30 ? '#bbf7d0' : ms >= 10 ? '#fde68a' : '#fecaca';
      const msIcon   = ms >= 30 ? '✅' : ms >= 10 ? '⚠️' : '🔴';
      const msStatus = ms >= 30 ? 'Operação segura' : ms >= 10 ? 'Atenção — margem apertada' : 'Risco alto — abaixo do nível seguro';
      const barW     = Math.min(Math.max(ms, 0), 100).toFixed(1);
      return `
      <div style="background:${msBg};border:1px solid ${msBorder};border-radius:12px;padding:12px 16px;margin-bottom:10px;page-break-inside:avoid;break-inside:avoid;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div>
            <div style="font-size:9px;font-weight:800;color:${msColor};text-transform:uppercase;letter-spacing:.6px;margin-bottom:2px">Margem de Segurança</div>
            <div style="font-size:10px;color:${msColor};opacity:.8">${msIcon} ${esc(msStatus)}</div>
          </div>
          <div style="font-size:28px;font-weight:900;color:${msColor};font-variant-numeric:tabular-nums">${ms.toFixed(1)}%</div>
        </div>
        <div style="height:8px;background:#e5e7eb;border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${barW}%;background:${msColor};border-radius:99px;"></div>
        </div>
        <div style="font-size:9px;color:${msColor};opacity:.7;margin-top:5px;">
          Quanto a receita pode cair antes de atingir o ponto de equilíbrio · (Receita − Custo) ÷ Receita × 100
        </div>
      </div>`;
    })()}

    <h2 class="section-title">Custo vs Receita vs Lucro</h2>
    <div style="margin-bottom:12px;page-break-inside:avoid;break-inside:avoid;border:1px solid #d6e8da;border-radius:14px;overflow:hidden;">
      ${svgSingleBars([
        { label: 'Custo Total',   value: input.totalGeral,   color: Colors.secondary },
        { label: 'Receita Bruta', value: input.receita ?? 0, color: Colors.primary   },
        { label: 'Lucro Líquido', value: input.lucro ?? 0,   color: (input.lucro ?? 0) >= 0 ? Colors.success : Colors.error },
      ])}
    </div>` : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>${sharedCss()}</style>
</head>
<body>

  ${headerHtml(appLogoBase64, 'Análise Financeira da Safra', meta, data)}

  <!-- RESUMO GERAL -->
  <div class="total-box">
    <div>
      <div class="total-label">Custo Total da Safra</div>
      <div class="total-sub">${esc(input.talhaoNome ?? '')} · ${esc(input.safraNome ?? '')} · ${fmt2(input.areaHa)} ha</div>
    </div>
    <div class="total-val">${fmtBRL(input.totalGeral)}</div>
  </div>

  <!-- KPIs -->
  <div class="kpi-grid">
    ${[
      { label: 'Total Insumos',    value: fmtBRL(input.totalInsumos),    sub: `${fmtBRL(input.areaHa > 0 ? input.totalInsumos    / input.areaHa : 0)}/ha`, color: Colors.primary },
      { label: 'Total Operac.',    value: fmtBRL(input.totalOperacional), sub: `${fmtBRL(input.areaHa > 0 ? input.totalOperacional / input.areaHa : 0)}/ha`, color: Colors.secondary },
      { label: 'Custo Total',      value: fmtBRL(input.totalGeral),       sub: `${fmtBRL(input.areaHa > 0 ? input.totalGeral       / input.areaHa : 0)}/ha`, color: Colors.success },
    ].map(k => `
      <div class="kpi-card" style="border-top-color:${k.color}">
        <div class="kpi-lbl" style="color:${k.color}">${esc(k.label)}</div>
        <div class="kpi-val">${esc(k.value)}</div>
        <div class="kpi-sub">${esc(k.sub)}</div>
      </div>`).join('')}
  </div>

  <!-- COMPOSIÇÃO DOS CUSTOS (SVG donut + barras) -->
  <h2 class="section-title">Composição dos Custos</h2>
  <div class="composition-wrapper" style="flex-direction:row;align-items:center;gap:16px;page-break-inside:avoid;break-inside:avoid;">
    <div style="flex-shrink:0;line-height:0;">
      ${svgDonut([
          { value: input.totalInsumos,    color: Colors.primary   },
          { value: input.totalOperacional, color: Colors.secondary },
        ], 90, fmtBRL(totalDonut), 'Total')}
    </div>
    <div class="legend-box">
      <div class="legend-row">
        <div class="dot" style="background:${Colors.primary}"></div>
        <div class="legend-name">Insumos <span class="legend-pct">(${totalDonut > 0 ? (input.totalInsumos / totalDonut * 100).toFixed(1) : '0.0'}%)</span></div>
        <div class="legend-bar-wrap"><div class="legend-bar" style="width:${totalDonut > 0 ? (input.totalInsumos / totalDonut * 100).toFixed(1) : 0}%;background:${Colors.primary}"></div></div>
        <div class="legend-val">${fmtBRL(input.totalInsumos)}</div>
      </div>
      <div class="legend-row">
        <div class="dot" style="background:${Colors.secondary}"></div>
        <div class="legend-name">Operacional <span class="legend-pct">(${totalDonut > 0 ? (input.totalOperacional / totalDonut * 100).toFixed(1) : '0.0'}%)</span></div>
        <div class="legend-bar-wrap"><div class="legend-bar" style="width:${totalDonut > 0 ? (input.totalOperacional / totalDonut * 100).toFixed(1) : 0}%;background:${Colors.secondary}"></div></div>
        <div class="legend-val">${fmtBRL(input.totalOperacional)}</div>
      </div>
    </div>
  </div>

  <!-- COMPOSIÇÃO DOS INSUMOS POR CATEGORIA -->
  ${catTotals.length > 0 ? `
  <h2 class="section-title">Insumos por Categoria</h2>
  <div class="bar-chart-wrap">
    ${catTotals.map(({ cat, total }) => {
      const color = catColors[cat];
      const pct = totalCatSum > 0 ? (total / totalCatSum) * 100 : 0;
      return `
        <div class="bar-row">
          <div class="bar-label" style="color:${color}">${esc(cat)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(pct, 2)}%;background:${color}"></div></div>
          <div class="bar-value" style="color:${color}">${fmtBRL(total)}</div>
        </div>`;
    }).join('')}
  </div>` : ''}

  <!-- STATUS DE COMPRAS -->
  <h2 class="section-title">Status de Compras</h2>
  <div style="display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #d6e8da;border-radius:14px;padding:12px;margin-bottom:8px;page-break-inside:avoid;break-inside:avoid;overflow:visible;">
    <div style="flex-shrink:0;line-height:0;">
      ${svgDonut([
          { value: input.totalInsumosComprados,  color: Colors.success  },
          { value: input.totalInsumosPendentes,  color: Colors.secondary },
        ], 70, totalComp > 0 ? (input.totalInsumosComprados / totalComp * 100).toFixed(0) + '%' : '0%', 'Comprado')}
    </div>
    <div class="legend-box">
      <div class="legend-row">
        <div class="dot" style="background:${Colors.success}"></div>
        <div class="legend-name">Comprados</div>
        <div class="legend-bar-wrap"><div class="legend-bar" style="width:${totalComp > 0 ? (input.totalInsumosComprados / totalComp * 100).toFixed(1) : 0}%;background:${Colors.success}"></div></div>
        <div class="legend-val">${fmtBRL(input.totalInsumosComprados)}</div>
      </div>
      <div class="legend-row">
        <div class="dot" style="background:${Colors.secondary}"></div>
        <div class="legend-name">Pendentes</div>
        <div class="legend-bar-wrap"><div class="legend-bar" style="width:${totalComp > 0 ? (input.totalInsumosPendentes / totalComp * 100).toFixed(1) : 0}%;background:${Colors.secondary}"></div></div>
        <div class="legend-val">${fmtBRL(input.totalInsumosPendentes)}</div>
      </div>
    </div>
  </div>

  ${resultadoHtml}

  <!-- INSUMOS DETALHADOS -->
  <h2 class="section-title" style="margin-top:12px;">Detalhamento de Insumos</h2>
  ${input.insumos.length === 0
    ? `<div style="text-align:center;padding:20px;color:#9ca3af;font-size:11px;">Nenhum insumo registrado</div>`
    : insumosDetailHtml}

  <!-- CUSTOS OPERACIONAIS -->
  <h2 class="section-title">Custos Operacionais</h2>
  ${input.custosOp.length === 0
    ? `<div style="text-align:center;padding:20px;color:#9ca3af;font-size:11px;">Nenhum custo operacional registrado</div>`
    : `<div style="page-break-inside:avoid;"><table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#1565C0">
            <th style="padding:8px 14px;font-size:9px;color:#fff;text-align:left;text-transform:uppercase;letter-spacing:.5px;">Descrição</th>
            <th style="padding:8px 14px;font-size:9px;color:#fff;text-align:right;text-transform:uppercase;letter-spacing:.5px;">R$/ha</th>
            <th style="padding:8px 14px;font-size:9px;color:#fff;text-align:right;text-transform:uppercase;letter-spacing:.5px;">Área</th>
            <th style="padding:8px 14px;font-size:9px;color:#fff;text-align:right;text-transform:uppercase;letter-spacing:.5px;">Total</th>
          </tr>
        </thead>
        <tbody>${custosRows}</tbody>
      </table></div>`}

  ${footerHtml(appLogoBase64)}

</body>
</html>`;
}

// ── COMPARACAO HTML ───────────────────────────────────────────────────────────

function buildComparacaoHtml(input: GestaoComparacaoPdfInput, appLogoBase64?: string): string {
  const { cenarioA: A, cenarioB: B } = input;
  const GREEN = Colors.primary;
  const BLUE  = '#1565C0';
  const RED   = '#dc2626';
  const data  = (input.dataGeracao ?? new Date()).toLocaleString('pt-BR');

  const meta: { label: string; value: string }[] = [
    { label: 'Fazenda', value: input.fazendaNome || 'Não informada' },
    { label: 'Produtor', value: input.produtorNome || 'Não informado' },
    { label: 'Consultor', value: input.consultorEmpresa?.consultorNome || 'Não informado' },
    { label: 'Empresa', value: input.consultorEmpresa?.companyName || 'Não informada' },
  ];

  // SVG vertical grouped bar chart — Custo Total / Receita Bruta / Lucro Líquido
  const barChartHtml = `
    <div style="background:#fff;border:1px solid #d6e8da;border-radius:14px;padding:10px 12px;page-break-inside:avoid;break-inside:avoid;line-height:0;">
      ${svgGroupedBars(
        [
          { label: 'Custo Total',   aVal: A.totalCusto, bVal: B.totalCusto, isCost: true  },
          { label: 'Receita Bruta', aVal: A.receita,    bVal: B.receita,    isCost: false },
          { label: 'Lucro Líquido', aVal: A.lucro,      bVal: B.lucro,      isCost: false },
        ],
        `${A.label} — ${A.talhaoNome}`,
        `${B.label} — ${B.talhaoNome}`,
        GREEN, BLUE, RED
      )}
    </div>`;

  // Métricas table
  const metrics = [
    { label: 'Total Insumos',     a: A.totalInsumos,     b: B.totalInsumos,     fmt: fmtBRL, isCosto: false, highlight: false },
    { label: 'Total Operacional', a: A.totalOperacional, b: B.totalOperacional, fmt: fmtBRL, isCosto: false, highlight: false },
    { label: 'Custo Total',       a: A.totalCusto,       b: B.totalCusto,       fmt: fmtBRL, isCosto: true,  highlight: true  },
    { label: 'Custo/ha',          a: A.custoHa,          b: B.custoHa,          fmt: fmtBRL, isCosto: true,  highlight: false },
    { label: 'Produtividade',     a: A.produtividade_ha, b: B.produtividade_ha, fmt: (v: number) => `${fmt2(v)} sc/ha`, isCosto: false, highlight: false },
    { label: 'Preço da Soja',     a: A.preco_soja,       b: B.preco_soja,       fmt: fmtBRL, isCosto: false, highlight: false },
    { label: 'Pt. Nivelamento',   a: A.pontoNivelamento, b: B.pontoNivelamento, fmt: (v: number) => `${fmt2(v)} sc/ha`, isCosto: true, highlight: false },
    { label: 'Receita Bruta',     a: A.receita,          b: B.receita,          fmt: fmtBRL, isCosto: false, highlight: false },
    { label: 'Lucro Líquido',     a: A.lucro,            b: B.lucro,            fmt: fmtBRL, isCosto: false, highlight: true  },
    { label: 'Lucro/ha',          a: A.lucroHa,          b: B.lucroHa,          fmt: fmtBRL, isCosto: false, highlight: false },
    { label: 'Margem de Segurança', a: A.margemSeguranca, b: B.margemSeguranca, fmt: (v: number) => `${v.toFixed(1)}%`, isCosto: false, highlight: true },
  ];

  const metricsRows = metrics.map((m, i) => {
    const aWins = m.isCosto ? m.a < m.b : m.a > m.b;
    const bWins = m.isCosto ? m.b < m.a : m.b > m.a;
    const bg = i % 2 === 0 ? '#f9fafb' : '#ffffff';
    return `
      <tr style="background:${bg}">
        <td style="padding:8px 14px;font-size:11px;font-weight:${m.highlight ? '800' : '600'};color:#374151">${esc(m.label)}</td>
        <td style="padding:8px 14px;font-size:11px;font-weight:800;color:${aWins ? GREEN : m.a < 0 ? RED : '#111827'};text-align:right">
          ${m.fmt(m.a)}${aWins ? ' <span style="background:' + Colors.successBg + ';color:' + Colors.success + ';font-size:8px;font-weight:900;padding:1px 5px;border-radius:4px;margin-left:4px">MELHOR</span>' : ''}
        </td>
        <td style="padding:8px 14px;font-size:11px;font-weight:800;color:${bWins ? BLUE : m.b < 0 ? RED : '#111827'};text-align:right">
          ${m.fmt(m.b)}${bWins ? ' <span style="background:#dbeafe;color:#1d4ed8;font-size:8px;font-weight:900;padding:1px 5px;border-radius:4px;margin-left:4px">MELHOR</span>' : ''}
        </td>
        <td style="padding:8px 14px;font-size:10px;color:#9ca3af;text-align:right">
          ${m.a !== m.b ? `Δ ${m.fmt(Math.abs(m.a - m.b))}` : '—'}
        </td>
      </tr>`;
  }).join('');

  // Comparativo produto a produto (insumos) — cores agrícolas por categoria
  function buildComparativoProdutos(): string {
    const allCats = new Set([...A.insumos.map(i => i.categoria), ...B.insumos.map(i => i.categoria)]);
    return Array.from(allCats).sort().map(cat => {
      const catColor = getCatColor(cat);
      const aItens = A.insumos.filter(i => i.categoria === cat);
      const bItens = B.insumos.filter(i => i.categoria === cat);
      const allNomes = new Set([...aItens.map(i => i.nome), ...bItens.map(i => i.nome)]);
      const prodRows = Array.from(allNomes).sort().map(nome => {
        const aItem = aItens.find(i => i.nome === nome);
        const bItem = bItens.find(i => i.nome === nome);
        const aVal = aItem?.total ?? 0;
        const bVal = bItem?.total ?? 0;
        const max = Math.max(aVal, bVal, 1);
        const diff = Math.abs(aVal - bVal);
        const pctA = (aVal / max * 100).toFixed(0);
        const pctB = (bVal / max * 100).toFixed(0);
        return `
          <tr>
            <td style="padding:7px 12px;font-size:10px;color:#374151;border-bottom:1px solid #f3f4f6">
              ${esc(nome)}
              ${aItem?.isAlternativa || bItem?.isAlternativa ? `<span style="background:#fef3c7;color:#92400e;font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;margin-left:3px">ALT</span>` : ''}
              ${aItem?.isAlternativa && aItem.produtoOriginal ? `<div style="font-size:8px;color:#9ca3af">Orig: <span style="text-decoration:line-through">${esc(aItem.produtoOriginal)}</span></div>` : ''}
            </td>
            <td style="padding:7px 12px;border-bottom:1px solid #f3f4f6">
              ${aVal > 0 ? `
                <div style="font-size:10px;font-weight:800;color:${GREEN};text-align:right;margin-bottom:3px">${fmtBRL(aVal)}</div>
                <div style="height:6px;border-radius:99px;background:#e5e7eb;overflow:hidden;margin-bottom:3px;"><div style="height:100%;border-radius:99px;background:${GREEN};width:${Math.max(Number(pctA), 2)}%"></div></div>
                ${aItem?.fornecedor ? `<div style="font-size:8px;color:#4a6b53;text-align:right">${esc(aItem.fornecedor)}</div>` : ''}
                ${aItem?.dose_ha != null ? `<div style="font-size:8px;color:#6b7280;text-align:right">${fmt2(aItem.dose_ha)} L/ha</div>` : ''}
              ` : '<div style="text-align:center;color:#d1d5db;font-size:10px">—</div>'}
            </td>
            <td style="padding:7px 12px;border-bottom:1px solid #f3f4f6">
              ${bVal > 0 ? `
                <div style="font-size:10px;font-weight:800;color:${BLUE};text-align:right;margin-bottom:3px">${fmtBRL(bVal)}</div>
                <div style="height:6px;border-radius:99px;background:#e5e7eb;overflow:hidden;margin-bottom:3px;"><div style="height:100%;border-radius:99px;background:${BLUE};width:${Math.max(Number(pctB), 2)}%"></div></div>
                ${bItem?.fornecedor ? `<div style="font-size:8px;color:#4a6b53;text-align:right">${esc(bItem.fornecedor)}</div>` : ''}
                ${bItem?.dose_ha != null ? `<div style="font-size:8px;color:#6b7280;text-align:right">${fmt2(bItem.dose_ha)} L/ha</div>` : ''}
              ` : '<div style="text-align:center;color:#d1d5db;font-size:10px">—</div>'}
            </td>
            <td style="padding:7px 12px;font-size:9px;text-align:right;color:#9ca3af;border-bottom:1px solid #f3f4f6">${diff > 0 ? `Δ ${fmtBRL(diff)}` : '='}</td>
          </tr>`;
      }).join('');
      return `
        <tr>
          <td colspan="4" style="padding:10px 12px 4px;background:${catColor}22;border-left:4px solid ${catColor};border-bottom:1px solid #e5e7eb;">
            <span style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:${catColor}">${esc(cat)}</span>
          </td>
        </tr>
        ${prodRows}`;
    }).join('');
  }

  function buildInsumosTable(cenario: GestaoCenario, _scenarioColor: string): string {
    if (cenario.insumos.length === 0) {
      return `<div style="text-align:center;padding:20px;color:#9ca3af;font-size:11px">Nenhum insumo registrado</div>`;
    }
    const porCat: Record<string, GestaoInsumoItem[]> = {};
    cenario.insumos.forEach(i => {
      if (!porCat[i.categoria]) porCat[i.categoria] = [];
      porCat[i.categoria].push(i);
    });
    return Object.entries(porCat).map(([cat, itens]) => {
      const catColor = getCatColor(cat);
      const totalCat = itens.reduce((s, i) => s + i.total, 0);
      const rows = itens.map(item => `
        <tr>
          <td style="padding:5px 8px;font-size:10px;color:#374151;border-bottom:1px solid #f3f4f6">
            ${item.isAlternativa ? `<span style="background:#fef3c7;color:#92400e;font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;margin-right:3px">ALT</span>` : ''}
            <strong>${esc(item.nome)}</strong>
            ${item.comprado ? '<span style="background:' + Colors.successBg + ';color:' + Colors.success + ';font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;margin-left:4px">COMPRADO</span>' : '<span style="background:#fef3c7;color:#b45309;font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;margin-left:4px">PENDENTE</span>'}
            ${item.isAlternativa && item.produtoOriginal ? `<div style="font-size:8px;color:#9ca3af;margin-top:2px;">Orig: <span style="text-decoration:line-through">${esc(item.produtoOriginal)}</span></div>` : ''}
            ${item.fornecedor ? `<div style="font-size:8px;color:#4a6b53;margin-top:1px;">Revenda: <strong>${esc(item.fornecedor)}</strong></div>` : ''}
          </td>
          <td style="padding:5px 8px;font-size:10px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6;white-space:nowrap;">
            ${fmtBRL(item.valorHa)}/ha
            ${item.isAlternativa && item.doseOriginal != null
                ? `<div style="font-size:8px;color:#6b7280;">Orig: <span style="text-decoration:line-through;color:#9ca3af">${fmt2(item.doseOriginal)} L/ha</span>${item.dose_ha != null ? ` → <span style="color:#b45309;font-weight:700">${fmt2(item.dose_ha)} L/ha</span>` : ''}</div>`
                : (item.dose_ha != null ? `<div style="font-size:8px;color:#6b7280;">${fmt2(item.dose_ha)} L/ha</div>` : '')}
          </td>
          <td style="padding:5px 8px;font-size:10px;font-weight:800;text-align:right;color:#111827;border-bottom:1px solid #f3f4f6">${fmtBRL(item.total)}</td>
        </tr>`).join('');
      return `
        <div style="margin-bottom:4px;">
          <div style="background:${catColor};padding:4px 8px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;">
            <span style="font-size:9px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:.8px">${esc(cat)}</span>
            <span style="font-size:9px;font-weight:900;color:rgba(255,255,255,.8)">${fmtBRL(totalCat)}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px;overflow:hidden">
            <thead><tr style="background:#f0f7f2">
              <th style="padding:3px 8px;font-size:8px;color:#4a6b53;text-align:left;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Produto / Revenda</th>
              <th style="padding:3px 8px;font-size:8px;color:#4a6b53;text-align:right;font-weight:700;text-transform:uppercase;letter-spacing:.3px">R$/ha · Dose</th>
              <th style="padding:3px 8px;font-size:8px;color:#4a6b53;text-align:right;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Total</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join('');
  }

  function buildCustosTable(cenario: GestaoCenario, color: string): string {
    if (cenario.custosOp.length === 0) {
      return `<div style="text-align:center;padding:20px;color:#9ca3af;font-size:11px">Nenhum custo operacional registrado</div>`;
    }
    const rows = cenario.custosOp.map((c, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'}">
        <td style="padding:4px 8px;font-size:10px;color:#374151;border-bottom:1px solid #f3f4f6">
          ${esc(c.descricao)}
          <span style="background:${c.unidade === 'sacas' ? Colors.successBg : '#eff6ff'};color:${c.unidade === 'sacas' ? Colors.success : '#1d4ed8'};font-size:7px;font-weight:900;padding:1px 4px;border-radius:3px;margin-left:4px">${c.unidade === 'sacas' ? 'SACAS' : 'R$'}</span>
        </td>
        <td style="padding:4px 8px;font-size:10px;text-align:right;color:#374151;border-bottom:1px solid #f3f4f6">${fmtBRL(c.valorHa)}/ha</td>
        <td style="padding:4px 8px;font-size:10px;font-weight:800;text-align:right;color:#111827;border-bottom:1px solid #f3f4f6">${fmtBRL(c.total)}</td>
      </tr>`).join('');
    return `
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:${color}">
            <th style="padding:5px 8px;font-size:9px;color:#fff;text-align:left;text-transform:uppercase;letter-spacing:.5px">Descrição</th>
            <th style="padding:5px 8px;font-size:9px;color:#fff;text-align:right;text-transform:uppercase;letter-spacing:.5px">R$/ha</th>
            <th style="padding:5px 8px;font-size:9px;color:#fff;text-align:right;text-transform:uppercase;letter-spacing:.5px">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>${sharedCss()}</style>
</head>
<body>

  ${headerHtml(appLogoBase64, 'Relatório Comparativo — Gestão Financeira', meta, data)}

  <!-- CENÁRIOS LADO A LADO -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
    ${[{ c: A, color: GREEN, bg: '#f0fdf4', border: '#bbf7d0' }, { c: B, color: BLUE, bg: '#eff6ff', border: '#bfdbfe' }].map(({ c, color, bg, border }) => `
    <div style="background:${bg};border:2px solid ${border};border-radius:14px;padding:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${color}"></div>
        <span style="font-size:13px;font-weight:900;color:${color}">${esc(c.label)}</span>
        <span style="font-size:10px;color:#9ca3af;font-weight:600;margin-left:auto">${esc(c.talhaoNome)} · ${esc(c.safraAnome)}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        ${[
          { l: 'Área', v: `${fmt2(c.areaHa)} ha` },
          { l: 'Produtividade', v: `${fmt2(c.produtividade_ha)} sc/ha` },
          { l: 'Preço Soja', v: fmtBRL(c.preco_soja) },
          { l: 'Custo Total', v: fmtBRL(c.totalCusto) },
        ].map(p => `
          <div style="background:rgba(255,255,255,.6);border-radius:8px;padding:6px 8px;">
            <div style="font-size:8px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">${esc(p.l)}</div>
            <div style="font-size:12px;font-weight:900;color:#111827">${esc(p.v)}</div>
          </div>`).join('')}
      </div>
      <div style="margin-top:8px;background:${c.lucro >= 0 ? (color === GREEN ? Colors.successBg : '#dbeafe') : '#fee2e2'};border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:9px;font-weight:800;color:${c.lucro >= 0 ? color : RED};text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Lucro Líquido</div>
        <div style="font-size:20px;font-weight:900;color:${c.lucro >= 0 ? color : RED}">${fmtBRL(c.lucro)}</div>
        <div style="font-size:10px;color:${c.lucro >= 0 ? color : RED};margin-top:2px">${fmtBRL(c.lucroHa)}/ha</div>
      </div>
    </div>`).join('')}
  </div>

  <!-- MARGEM DE SEGURANÇA -->
  ${(() => {
    const renderMs = (c: GestaoCenario, color: string) => {
      const ms = c.margemSeguranca;
      const msColor  = ms >= 30 ? '#15803d' : ms >= 10 ? '#b45309' : '#dc2626';
      const msBg     = ms >= 30 ? '#f0fdf4' : ms >= 10 ? '#fffbeb' : '#fef2f2';
      const msBorder = ms >= 30 ? '#bbf7d0' : ms >= 10 ? '#fde68a' : '#fecaca';
      const msIcon   = ms >= 30 ? '✅' : ms >= 10 ? '⚠️' : '🔴';
      const msStatus = ms >= 30 ? 'Seguro' : ms >= 10 ? 'Atenção' : 'Risco alto';
      const barW     = Math.min(Math.max(ms, 0), 100).toFixed(1);
      return `
        <div style="background:${msBg};border:1px solid ${msBorder};border-top:3px solid ${color};border-radius:12px;padding:12px 14px;">
          <div style="font-size:9px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${esc(c.label)} — Margem de Segurança</div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="font-size:26px;font-weight:900;color:${msColor};font-variant-numeric:tabular-nums">${ms.toFixed(1)}%</div>
            <div>
              <div style="font-size:10px;font-weight:800;color:${msColor}">${msIcon} ${esc(msStatus)}</div>
              <div style="font-size:9px;color:#6b7280;margin-top:2px;">Pt. Niv.: ${fmt2(c.pontoNivelamento)} sc/ha · Prod.: ${fmt2(c.produtividade_ha)} sc/ha</div>
            </div>
          </div>
          <div style="height:7px;background:#e5e7eb;border-radius:99px;overflow:hidden;">
            <div style="height:100%;width:${barW}%;background:${msColor};border-radius:99px;"></div>
          </div>
        </div>`;
    };
    return `
      <h2 class="section-title">Margem de Segurança</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;page-break-inside:avoid;break-inside:avoid;">
        ${renderMs(A, GREEN)}
        ${renderMs(B, BLUE)}
      </div>
      <div style="font-size:10px;color:#6b7280;margin-bottom:8px;padding:0 2px;">
        Indica quanto a receita pode cair antes de atingir o ponto de equilíbrio · (Receita − Custo Total) ÷ Receita × 100
      </div>`;
  })()}

  <!-- COMPARATIVO VISUAL DOS CENÁRIOS -->
  <h2 class="section-title">Comparativo Visual dos Cenários</h2>
  ${barChartHtml}

  <!-- ANÁLISE FINANCEIRA DETALHADA -->
  <h2 class="section-title">Análise Financeira Detalhada</h2>
  <div class="card" style="padding:0;overflow:hidden;">
    <table>
      <thead>
        <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
          <th style="padding:10px 14px;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;text-align:left">Métrica</th>
          <th style="padding:10px 14px;font-size:10px;color:${GREEN};text-transform:uppercase;letter-spacing:.5px;text-align:right">${esc(A.label)} — ${esc(A.talhaoNome)}</th>
          <th style="padding:10px 14px;font-size:10px;color:${BLUE};text-transform:uppercase;letter-spacing:.5px;text-align:right">${esc(B.label)} — ${esc(B.talhaoNome)}</th>
          <th style="padding:10px 14px;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;text-align:right">Diferença</th>
        </tr>
      </thead>
      <tbody>${metricsRows}</tbody>
    </table>
  </div>

  <!-- COMPARATIVO PRODUTO A PRODUTO -->
  <h2 class="section-title" style="margin-top:10px;">Comparativo de Insumos por Produto</h2>
  <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">Valores totais por produto (R$/ha × área do talhão)</div>
  <div class="card" style="padding:0;overflow:hidden;">
    <table>
      <thead>
        <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
          <th style="padding:8px 12px;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;text-align:left">Produto</th>
          <th style="padding:8px 12px;font-size:10px;color:${GREEN};text-transform:uppercase;letter-spacing:.5px;text-align:left;width:28%">${esc(A.label)}</th>
          <th style="padding:8px 12px;font-size:10px;color:${BLUE};text-transform:uppercase;letter-spacing:.5px;text-align:left;width:28%">${esc(B.label)}</th>
          <th style="padding:8px 12px;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;text-align:right;width:12%">Diferença</th>
        </tr>
      </thead>
      <tbody>${buildComparativoProdutos()}</tbody>
    </table>
  </div>

  <!-- INSUMOS CENÁRIO A -->
  <h2 class="section-title" style="color:${GREEN};margin-top:10px;">Insumos — ${esc(A.label)}: ${esc(A.talhaoNome)} · ${esc(A.safraAnome)}</h2>
  <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">Área: ${fmt2(A.areaHa)} ha · Total Insumos: ${fmtBRL(A.totalInsumos)}</div>
  ${buildInsumosTable(A, GREEN)}

  <h2 class="section-title" style="color:${GREEN};margin-top:8px;">Custos Operacionais — ${esc(A.label)}</h2>
  <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">Total Operacional: ${fmtBRL(A.totalOperacional)}</div>
  ${buildCustosTable(A, GREEN)}

  <!-- INSUMOS CENÁRIO B -->
  <h2 class="section-title" style="color:${BLUE};margin-top:10px;">Insumos — ${esc(B.label)}: ${esc(B.talhaoNome)} · ${esc(B.safraAnome)}</h2>
  <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">Área: ${fmt2(B.areaHa)} ha · Total Insumos: ${fmtBRL(B.totalInsumos)}</div>
  ${buildInsumosTable(B, BLUE)}

  <h2 class="section-title" style="color:${BLUE};margin-top:8px;">Custos Operacionais — ${esc(B.label)}</h2>
  <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">Total Operacional: ${fmtBRL(B.totalOperacional)}</div>
  ${buildCustosTable(B, BLUE)}

  ${footerHtml(appLogoBase64)}

</body>
</html>`;
}

// ── SHARED EXPORT LOGIC ───────────────────────────────────────────────────────

async function loadAppLogo(): Promise<string | undefined> {
  try {
    const asset = Asset.fromModule(require('../../assets/logo-transparent.png'));
    await asset.downloadAsync();
    if (asset.localUri) {
      return await FileSystem.readAsStringAsync(asset.localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
  } catch (_) {}
  return undefined;
}

async function shareHtmlAsPdf(html: string, filePrefix: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  const destino = `${FileSystem.cacheDirectory}${filePrefix}_${Date.now()}.pdf`;
  await FileSystem.copyAsync({ from: uri, to: destino });
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    Alert.alert('PDF gerado', 'Arquivo criado, mas compartilhamento não disponível neste dispositivo.');
    return;
  }
  await Sharing.shareAsync(destino, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'Exportar Relatório (PDF)',
  });
}

// ── PUBLIC EXPORTS ────────────────────────────────────────────────────────────

export async function exportarGestaoAnalisePdf(input: GestaoAnalisePdfInput): Promise<void> {
  try {
    const logo = await loadAppLogo();
    const html = buildAnaliseHtml(input, logo);
    await shareHtmlAsPdf(html, 'gestao_analise');
  } catch (err: any) {
    Alert.alert('Erro ao exportar PDF', err?.message ?? 'Não foi possível gerar o PDF.');
  }
}

export async function exportarGestaoComparacaoPdf(input: GestaoComparacaoPdfInput): Promise<void> {
  try {
    const logo = await loadAppLogo();
    const html = buildComparacaoHtml(input, logo);
    await shareHtmlAsPdf(html, 'gestao_comparacao');
  } catch (err: any) {
    Alert.alert('Erro ao exportar PDF', err?.message ?? 'Não foi possível gerar o PDF.');
  }
}