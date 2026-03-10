// ─── AgroMarketService.ts ─────────────────────────────────────────────────────
// Fonte: Yahoo Finance (gratuito, sem chave de API)
//
// Símbolos Yahoo Finance — Futuros verificados e com liquidez:
//
//   GRÃOS & DERIVADOS
//     ZS=F  → Soja             (USc/bushel · 1 bu = 27.2155 kg)
//     ZC=F  → Milho            (USc/bushel · 1 bu = 25.4012 kg)
//     ZW=F  → Trigo            (USc/bushel · 1 bu = 27.2155 kg)
//     ZO=F  → Aveia            (USc/bushel · 1 bu = 14.515 kg  ← diferente!)
//     ZM=F  → Farelo de Soja   (USD/short ton → ton métrica)
//     ZL=F  → Óleo de Soja     (USc/lb → R$/L, densidade 0.92 kg/L)
//
//   PECUÁRIA
//     LE=F  → Boi (CBOT)       (USc/lb → R$/@ — referência futuros EUA)
//     GF=F  → Novilho (CBOT)   (USc/lb → R$/@ — referência futuros EUA)
//     HE=F  → Suíno Vivo       (USc/lb → R$/kg)
//     DC=F  → Leite Classe III (USD/cwt → R$/100kg)
//
//   OUTROS AGRO & ENERGIA
//     KC=F  → Café Arábica     (USc/lb → R$/sc 60kg)
//     SB=F  → Açúcar #11       (USc/lb → R$/kg)
//     CT=F  → Algodão          (USc/lb → R$/arroba)
//     CC=F  → Cacau            (USD/t métrica → R$/t)
//     OJ=F  → Suco Laranja     (USc/lb → R$/t FCOJ)
//     RB=F  → Gasolina RBOB    (USD/galão → R$/litro)
//     HO=F  → Diesel/HO        (USD/galão → R$/litro)
//     LBS=F → Madeira Serrada  (USD/MBF → R$/m³)
//
//   CÂMBIO
//     BRL=X → USD/BRL
//
//   REMOVIDOS (símbolo inválido / moeda não-USD / sem liquidez):
//     ZR=F  → retorna USD/ZAR (Rand), não arroz
//     RS=F  → Canola em CAD/ton
//     KPO=F → Óleo de Palma em MYR/ton
//     CB=F  → Manteiga sem liquidez
//     CSC=F → Queijo sem liquidez

export type AgroCommodityCode =
  // Grãos
  | 'SOYBEAN' | 'CORN' | 'WHEAT' | 'OATS'
  | 'SOYBEAN_MEAL' | 'SOYBEAN_OIL'
  // Pecuária
  | 'CATTLE' | 'FEEDER_CATTLE' | 'HOG' | 'MILK' | 'BUTTER' | 'CHEESE'
  // Outros Agro & Energia
  | 'COFFEE' | 'SUGARCANE' | 'COTTON'
  | 'COCOA' | 'ORANGE_JUICE'
  | 'GASOLINE' | 'DIESEL' | 'TRACTOR_OIL'
  | 'LUMBER';

export type CommodityGroup = 'grains' | 'livestock' | 'outros';

export interface AgroQuote {
  code:           AgroCommodityCode;
  label:          string;
  shortLabel:     string;
  unit:           string;
  group:          CommodityGroup;
  value:          number;   // R$ (unidade de exibição)
  previousValue:  number;   // R$ — fechamento anterior
  changeAbsolute: number;   // R$ — variação absoluta
  changePercent:  number;   // %  — variação percentual
  trend:          'up' | 'down' | 'flat';
  rawValue:       number;   // valor bruto Yahoo Finance
  rawUnit:        string;   // unidade original: "USc/bu", "USD/cwt", etc.
  usdBrl:         number;   // câmbio usado
  sourceDate:     string;   // ISO
  yahooSymbol:    string;
}

export interface QuotesResponse {
  quotes:    AgroQuote[];
  usdBrl:    number;
  source:    string;
  fetchedAt: string;
}

// ─── Modos de conversão ───────────────────────────────────────────────────────
type ConversionMode =
  | 'usc_bu_soja_sc60'   // USc/bu (27.2155 kg/bu) → R$/sc 60kg  [soja, trigo]
  | 'usc_bu_milho_sc60'  // USc/bu (25.4012 kg/bu) → R$/sc 60kg  [milho]
  | 'usc_bu_aveia_sc40'  // USc/bu (14.515  kg/bu) → R$/sc 40kg  [aveia — padrão comercial BR]
  | 'usd_shortton_t'     // USD/short ton → R$/t métrica          [farelo de soja]
  | 'usc_lb_litro_oleo'  // USc/lb → R$/litro (dens. 0.92 kg/L)  [óleo de soja]
  | 'usc_lb_sc60'        // USc/lb → R$/sc 60kg                   [café]
  | 'usc_lb_kg'          // USc/lb → R$/kg                        [açúcar, suíno, manteiga]
  | 'usd_lb_kg'          // USD/lb → R$/kg  (sem ÷100)            [queijo CSC=F — cotado em USD, não centavos]
  | 'usc_lb_arr'         // USc/lb → R$/arroba (15kg)             [boi, novilho, algodão]
  | 'usd_cwt_100kg'      // USD/cwt (45.3592 kg) → R$/100kg       [leite]
  | 'usd_ton_metric'     // USD/t métrica → R$/t (direto)         [cacau, FCOJ]
  | 'usd_gal_litro'      // USD/galão → R$/litro                  [gasolina, diesel]
  | 'usc_lb_t'           // USc/lb → R$/t métrica (×2204.623)    [FCOJ]
  | 'usd_mbf_m3';        // USD/MBF → R$/m³                       [madeira]

const RAW_UNIT: Record<ConversionMode, string> = {
  usc_bu_soja_sc60:  'USc/bu',
  usc_bu_milho_sc60: 'USc/bu',
  usc_bu_aveia_sc40: 'USc/bu',
  usd_shortton_t:    'USD/short ton',
  usc_lb_litro_oleo: 'USc/lb',
  usc_lb_sc60:       'USc/lb',
  usc_lb_kg:         'USc/lb',
  usd_lb_kg:         'USD/lb',
  usc_lb_arr:        'USc/lb',
  usd_cwt_100kg:     'USD/cwt',
  usd_ton_metric:    'USD/t',
  usc_lb_t:          'USc/lb',
  usd_gal_litro:     'USD/gal',
  usd_mbf_m3:        'USD/MBF',
};

interface CommodityConfig {
  code: AgroCommodityCode;
  label: string;
  shortLabel: string;
  displayUnit: string;
  group: CommodityGroup;
  yahooSymbol: string;
  conversion: ConversionMode;
}

const COMMODITY_CONFIG: CommodityConfig[] = [
  // ─── Grãos & Derivados ────────────────────────────────────────────────────
  { code: 'SOYBEAN',      label: 'Soja',           shortLabel: 'Soja',      displayUnit: 'R$/sc 60kg', group: 'grains',    yahooSymbol: 'ZS=F',  conversion: 'usc_bu_soja_sc60'  },
  { code: 'CORN',         label: 'Milho',          shortLabel: 'Milho',     displayUnit: 'R$/sc 60kg', group: 'grains',    yahooSymbol: 'ZC=F',  conversion: 'usc_bu_milho_sc60' },
  { code: 'WHEAT',        label: 'Trigo',          shortLabel: 'Trigo',     displayUnit: 'R$/sc 60kg', group: 'grains',    yahooSymbol: 'ZW=F',  conversion: 'usc_bu_soja_sc60'  },
  { code: 'OATS',         label: 'Aveia',          shortLabel: 'Aveia',     displayUnit: 'R$/sc 40kg', group: 'grains',    yahooSymbol: 'ZO=F',  conversion: 'usc_bu_aveia_sc40' },
  { code: 'SOYBEAN_MEAL', label: 'Farelo de Soja', shortLabel: 'Far.Soja',  displayUnit: 'R$/t',       group: 'grains',    yahooSymbol: 'ZM=F',  conversion: 'usd_shortton_t'    },
  { code: 'SOYBEAN_OIL',  label: 'Óleo de Soja',  shortLabel: 'Óleo Soja', displayUnit: 'R$/L',       group: 'grains',    yahooSymbol: 'ZL=F',  conversion: 'usc_lb_litro_oleo' },
  // ─── Pecuária ─────────────────────────────────────────────────────────────
  { code: 'CATTLE',       label: 'Boi Gordo (CBOT)',  shortLabel: 'Boi Gordo', displayUnit: 'R$/arroba',  group: 'livestock', yahooSymbol: 'LE=F',  conversion: 'usc_lb_arr'        },
  { code: 'FEEDER_CATTLE',label: 'Novilho (CBOT)',    shortLabel: 'Novilho',   displayUnit: 'R$/arroba',  group: 'livestock', yahooSymbol: 'GF=F',  conversion: 'usc_lb_arr'        },
  { code: 'HOG',          label: 'Suíno Vivo',     shortLabel: 'Suíno',     displayUnit: 'R$/kg',      group: 'livestock', yahooSymbol: 'HE=F',  conversion: 'usc_lb_kg'         },
  { code: 'MILK',         label: 'Leite Cl. III',  shortLabel: 'Leite',     displayUnit: 'R$/100kg',   group: 'livestock', yahooSymbol: 'DC=F',  conversion: 'usd_cwt_100kg'     },
  // CB=F: Cash-Settled Butter — USc/lb → R$/kg  (vol ~86/dia, líquido)
  { code: 'BUTTER',       label: 'Manteiga (CME)', shortLabel: 'Manteiga',  displayUnit: 'R$/kg',      group: 'livestock', yahooSymbol: 'CB=F',  conversion: 'usc_lb_kg'         },
  // CSC=F: Cash-Settled Cheese — ⚠️ cotado em USD/lb (DÓLARES, não centavos!) → R$/kg
  { code: 'CHEESE',       label: 'Queijo Cheddar', shortLabel: 'Queijo',    displayUnit: 'R$/kg',      group: 'livestock', yahooSymbol: 'CSC=F', conversion: 'usd_lb_kg'         },
  // ─── Outros Agro & Energia ───────────────────────────────────────────────
  { code: 'COFFEE',       label: 'Café Arábica',   shortLabel: 'Café',      displayUnit: 'R$/sc 60kg', group: 'outros',    yahooSymbol: 'KC=F',  conversion: 'usc_lb_sc60'       },
  // Açúcar: R$/kg é mais universal (funciona para produtor e indústria)
  { code: 'SUGARCANE',    label: 'Açúcar Bruto',   shortLabel: 'Açúcar',    displayUnit: 'R$/kg',      group: 'outros',    yahooSymbol: 'SB=F',  conversion: 'usc_lb_kg'         },
  { code: 'COTTON',       label: 'Algodão',        shortLabel: 'Algodão',   displayUnit: 'R$/arroba',  group: 'outros',    yahooSymbol: 'CT=F',  conversion: 'usc_lb_arr'        },
  { code: 'COCOA',        label: 'Cacau',          shortLabel: 'Cacau',     displayUnit: 'R$/t',       group: 'outros',    yahooSymbol: 'CC=F',  conversion: 'usd_ton_metric'    },
  // OJ=F = FCOJ (suco concentrado, cotado em USc/lb) → R$/t métrica
  { code: 'ORANGE_JUICE', label: 'FCOJ (Suco Conc.)', shortLabel: 'FCOJ',   displayUnit: 'R$/t',       group: 'outros',    yahooSymbol: 'OJ=F',  conversion: 'usc_lb_t'          },
  { code: 'GASOLINE',     label: 'Gasolina (RBOB)', shortLabel: 'Gasolina', displayUnit: 'R$/L',       group: 'outros',    yahooSymbol: 'RB=F',  conversion: 'usd_gal_litro'     },
  { code: 'DIESEL',       label: 'Diesel (HO)',    shortLabel: 'Diesel',    displayUnit: 'R$/L',       group: 'outros',    yahooSymbol: 'HO=F',  conversion: 'usd_gal_litro'     },
  { code: 'TRACTOR_OIL',  label: 'Óleo Diesel Ag.',shortLabel: 'Óleo Ag.', displayUnit: 'R$/L',       group: 'outros',    yahooSymbol: 'HO=F',  conversion: 'usd_gal_litro'     },
  { code: 'LUMBER',       label: 'Madeira Serrada',shortLabel: 'Madeira',   displayUnit: 'R$/m³',      group: 'outros',    yahooSymbol: 'LBS=F', conversion: 'usd_mbf_m3'        },
];

export const AGRO_COMMODITIES = COMMODITY_CONFIG.map(
  ({ code, label, shortLabel, displayUnit, group }) => ({ code, label, shortLabel, unit: displayUnit, group }),
);

// ─── Constantes físicas (USDA / padrões internacionais) ──────────────────────
const LB_KG        = 0.453592;
const CWT_KG       = 45.3592;     // 1 cwt = 100 lb
const GALLON_L     = 3.78541;
const MBF_M3       = 2.35974;
const SHORT_TON_KG = 907.185;     // 1 short ton americana
const OIL_DENSITY  = 0.920;       // densidade óleo vegetal (kg/L)

// Peso de 1 bushel por cultura (USDA)
const BU_KG_SOJA  = 27.2155;      // soja e trigo
const BU_KG_MILHO = 25.4012;      // milho
const BU_KG_AVEIA = 14.5150;      // aveia ← significativamente menor

function convert(raw: number, mode: ConversionMode, usdBrl: number): number {
  const usd = mode.startsWith('usc') ? raw / 100 : raw;
  const brl = usd * usdBrl;
  switch (mode) {
    // Grãos — fator correto por cultura
    case 'usc_bu_soja_sc60':  return brl * (60  / BU_KG_SOJA);   // 2.2046
    case 'usc_bu_milho_sc60': return brl * (60  / BU_KG_MILHO);  // 2.3622
    case 'usc_bu_aveia_sc40': return brl * (40  / BU_KG_AVEIA);  // 2.7557
    // Derivados
    case 'usd_shortton_t':    return brl * (1000 / SHORT_TON_KG); // short ton → t métrica
    case 'usc_lb_litro_oleo': return (brl / LB_KG) / OIL_DENSITY; // USc/lb → R$/L
    // Café e outros em saca
    case 'usc_lb_sc60':       return brl * (60  / LB_KG);
    // Unidades simples
    case 'usc_lb_kg':         return brl  / LB_KG;
    // USD/lb direto (sem ÷100) — CSC=F queijo é cotado em dólares, não centavos
    case 'usd_lb_kg':         return raw * usdBrl / LB_KG;
    case 'usc_lb_arr':        return brl * (15  / LB_KG);         // arroba = 15 kg
    case 'usd_cwt_100kg':     return brl * (100 / CWT_KG);
    // Direto (já em USD/t métrica)
    case 'usd_ton_metric':    return brl;
    // USc/lb → R$/t métrica: (raw/100 USD/lb) × (1000/0.453592 lb/t) × BRL
    case 'usc_lb_t':          return brl * (1000 / LB_KG);
    // Energia e madeira
    case 'usd_gal_litro':     return brl  / GALLON_L;
    case 'usd_mbf_m3':        return brl  / MBF_M3;
    default:                  return brl;
  }
}

// ─── Yahoo Finance fetch ──────────────────────────────────────────────────────
interface YahooMeta {
  regularMarketPrice:  number;
  previousClose:       number;
  chartPreviousClose?: number;
  regularMarketTime:   number;
}

async function fetchYahoo(symbol: string): Promise<YahooMeta | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&range=5d&includePrePost=false`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta as YahooMeta | undefined;
    if (!meta || !Number.isFinite(meta.regularMarketPrice)) return null;

    if (!meta.previousClose || meta.previousClose === 0) {
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
      const lastClose = closes.filter((v: number) => Number.isFinite(v)).slice(-2)[0];
      meta.previousClose = meta.chartPreviousClose
        || (Number.isFinite(lastClose) ? lastClose : meta.regularMarketPrice);
    }
    return meta;
  } catch {
    return null;
  }
}

// ─── Ponto de entrada público ─────────────────────────────────────────────────
export async function getAgroQuotes(): Promise<QuotesResponse> {
  // Deduplica símbolos para não fazer chamadas repetidas (ex: HO=F aparece 2x)
  const uniqueSymbols = [...new Set([...COMMODITY_CONFIG.map(c => c.yahooSymbol), 'BRL=X'])];
  const settled = await Promise.allSettled(uniqueSymbols.map(s => fetchYahoo(s)));

  const data = new Map<string, YahooMeta>();
  uniqueSymbols.forEach((sym, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled' && r.value) data.set(sym, r.value);
  });

  const usdBrl = data.get('BRL=X')?.regularMarketPrice ?? 5.85;

  const quotes: AgroQuote[] = [];

  for (const cfg of COMMODITY_CONFIG) {
    const meta = data.get(cfg.yahooSymbol);
    if (!meta) continue;

    const value  = convert(meta.regularMarketPrice, cfg.conversion, usdBrl);
    const prev   = convert(meta.previousClose,       cfg.conversion, usdBrl);
    const absChg = value - prev;

    let pctChg = 0;
    if (prev !== 0 && Number.isFinite(prev) && Number.isFinite(absChg)) {
      pctChg = (absChg / prev) * 100;
    }
    if (!Number.isFinite(pctChg)) pctChg = 0;

    quotes.push({
      code:           cfg.code,
      label:          cfg.label,
      shortLabel:     cfg.shortLabel,
      unit:           cfg.displayUnit,
      group:          cfg.group,
      value,
      previousValue:  prev,
      changeAbsolute: Number.isFinite(absChg) ? absChg : 0,
      changePercent:  pctChg,
      trend:          pctChg > 0.05 ? 'up' : pctChg < -0.05 ? 'down' : 'flat',
      rawValue:       meta.regularMarketPrice,
      rawUnit:        RAW_UNIT[cfg.conversion],
      usdBrl,
      sourceDate:     meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
      yahooSymbol:    cfg.yahooSymbol,
    });
  }

  if (quotes.length === 0) {
    throw new Error('Não foi possível obter cotações. Verifique sua conexão.');
  }

  return { quotes, usdBrl, source: 'Yahoo Finance · Futuros', fetchedAt: new Date().toISOString() };
}

// ─── Formatadores exportados ──────────────────────────────────────────────────

/** "+1,23%" / "-0,50%" / "—" */
export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2).replace('.', ',')}%`;
}

/** "+R$ 3,50" / "-R$ 1,20" */
export function fmtAbsChange(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '-';
  return `${sign}R$\u00A0${Math.abs(v).toFixed(2).replace('.', ',')}`;
}

/** "1.234,56" sem prefixo */
export function fmtNum(v: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}
