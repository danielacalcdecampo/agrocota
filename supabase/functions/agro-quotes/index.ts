// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

type AgroCommodityCode = 'SOYBEAN' | 'CORN' | 'COFFEE' | 'WHEAT';

type AgroQuote = {
  code: AgroCommodityCode;
  label: string;
  unit: string;
  value: number;
  previousValue: number | null;
  changePercent: number | null;
  sourceDate: string;
};

type QuotesResponse = {
  quotes: AgroQuote[];
  source: string;
  fetchedAt: string;
};

const CACHE_KEY = 'default';
const CACHE_TTL_MINUTES = 10;

const AGRO_PAGES: Array<{ code: AgroCommodityCode; label: string; pageUrl: string }> = [
  { code: 'SOYBEAN', label: 'Soja (físico)', pageUrl: 'https://www.noticiasagricolas.com.br/cotacoes/soja' },
  { code: 'CORN', label: 'Milho (físico)', pageUrl: 'https://www.noticiasagricolas.com.br/cotacoes/milho' },
  { code: 'COFFEE', label: 'Café (físico)', pageUrl: 'https://www.noticiasagricolas.com.br/cotacoes/cafe' },
  { code: 'WHEAT', label: 'Trigo (físico)', pageUrl: 'https://www.noticiasagricolas.com.br/cotacoes/trigo' },
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function parsePtBrNumber(raw: string): number | null {
  if (!raw) return null;
  const normalized = raw
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function completeQuotes(quotes: AgroQuote[]): AgroQuote[] {
  const map = new Map(quotes.map((q) => [q.code, q]));
  return AGRO_PAGES
    .map(({ code }) => map.get(code) ?? null)
    .filter((q): q is AgroQuote => q !== null);
}

async function fetchPhysicalQuote(
  code: AgroCommodityCode,
  label: string,
  pageUrl: string,
): Promise<AgroQuote | null> {
  try {
    const response = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return null;

    const html = await response.text();
    const rowMatch =
      html.match(
        /(\d{2}\/\d{2}\/\d{4})\s*<\/td>\s*<td[^>]*>\s*([0-9\.,]+)\s*<\/td>\s*<td[^>]*>\s*([+\-]?[0-9\.,-]+)/i,
      ) || html.match(/(\d{2}\/\d{2}\/\d{4})\s*<\/td>\s*<td[^>]*>\s*([0-9\.,]+)/i);

    if (!rowMatch) return null;

    const dateText = rowMatch[1];
    const valueText = rowMatch[2];
    const variationText = rowMatch[3] ?? '';

    const value = parsePtBrNumber(valueText);
    if (value === null) return null;

    const variation = parsePtBrNumber(variationText);
    const changePercent = variation !== null ? variation : null;

    const sourceMatch = html.match(/Fonte:\s*([^<\n]+)/i);
    const sourceName = sourceMatch?.[1]?.trim() || 'Notícias Agrícolas';

    const [day, month, year] = dateText.split('/').map(Number);
    const sourceDate = new Date(year, month - 1, day, 12, 0, 0).toISOString();

    return {
      code,
      label: `${label} - ${sourceName}`,
      unit: 'BRL_SACA',
      value,
      previousValue: null,
      changePercent,
      sourceDate,
    };
  } catch {
    return null;
  }
}

async function fetchFreshQuotes(): Promise<QuotesResponse> {
  const settled = await Promise.allSettled(
    AGRO_PAGES.map((item) => fetchPhysicalQuote(item.code, item.label, item.pageUrl)),
  );

  const quotes = settled
    .filter((result): result is PromiseFulfilledResult<AgroQuote | null> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((quote): quote is AgroQuote => quote !== null);

  if (quotes.length === 0) {
    throw new Error('Não foi possível obter cotações físicas no momento.');
  }

  const latestTime = quotes.reduce((latest, quote) => {
    const ts = new Date(quote.sourceDate).getTime();
    return Number.isFinite(ts) ? Math.max(latest, ts) : latest;
  }, 0);

  return {
    quotes: completeQuotes(quotes),
    source: 'Notícias Agrícolas (físico por saca)',
    fetchedAt: latestTime > 0 ? new Date(latestTime).toISOString() : nowIso(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase env vars in function.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: cachedRow } = await supabase
      .from('agro_quotes_cache')
      .select('payload, expires_at')
      .eq('id', CACHE_KEY)
      .maybeSingle();

    const now = new Date();
    if (cachedRow?.payload && cachedRow?.expires_at && new Date(cachedRow.expires_at) > now) {
      return new Response(JSON.stringify(cachedRow.payload), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fresh = await fetchFreshQuotes();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MINUTES * 60_000).toISOString();

    await supabase
      .from('agro_quotes_cache')
      .upsert(
        {
          id: CACHE_KEY,
          source: fresh.source,
          fetched_at: fresh.fetchedAt,
          expires_at: expiresAt,
          payload: fresh,
        },
        { onConflict: 'id' },
      );

    return new Response(JSON.stringify(fresh), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unexpected error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
