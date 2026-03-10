/**
 * Gera PDF com relatório completo do usuário para admin:
 * Cadastro (com e-mail), fazendas, talhões, gestão financeira, cotações com produtos,
 * propostas de fornecedores (aceitas/recusadas), valores e itens.
 *
 * Para o e-mail aparecer: execute sql/admin_get_email.sql no SQL Editor do Supabase.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { Colors } from '../theme/colors';

const fmtBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function gerarRelatorioAdminPdf(userId: string): Promise<void> {
  const [profileRes, fazendasRes, cotacoesRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('fazendas').select('*').eq('consultor_id', userId).order('nome'),
    supabase.from('cotacoes').select('*').eq('consultor_id', userId).order('created_at', { ascending: false }),
  ]);

  const profile = profileRes.data as any;
  const fazendas = (fazendasRes.data ?? []) as any[];
  const cotacoes = (cotacoesRes.data ?? []) as any[];

  if (!profile) throw new Error('Usuário não encontrado.');

  let userEmail = (profile.original_email || '').trim() || '—';
  try {
    const { data: emailData, error } = await supabase.rpc('admin_get_user_email', { p_user_id: userId });
    if (!error && emailData != null && typeof emailData === 'string' && emailData.trim()) {
      userEmail = emailData.trim();
    }
  } catch { /* RPC pode não existir — usa fallback */ }

  const cotacaoIds = cotacoes.map(c => c.id);
  let itensCotacao: any[] = [];
  let propostasFornecedor: any[] = [];
  let aceites: any[] = [];

  if (cotacaoIds.length > 0) {
    const [itensRes, propRes, aceRes] = await Promise.all([
      supabase.from('itens_cotacao').select('*').in('cotacao_id', cotacaoIds),
      supabase.from('propostas_fornecedor').select('*').in('cotacao_id', cotacaoIds),
      supabase.from('cotacao_aceites').select('*').in('cotacao_id', cotacaoIds),
    ]);
    itensCotacao = itensRes.data ?? [];
    propostasFornecedor = propRes.data ?? [];
    aceites = aceRes.data ?? [];
  }

  const talhoesMap = new Map<string, any[]>();
  const custosOpMap = new Map<string, any[]>();
  const safraDadosMap = new Map<string, any>();

  for (const f of fazendas) {
    const [talRes, custosRes] = await Promise.all([
      supabase.from('talhoes').select('*').eq('fazenda_id', f.id),
      supabase.from('gestao_custos_operacionais').select('*').eq('fazenda_id', f.id),
    ]);
    talhoesMap.set(f.id, (talRes.data ?? []) as any[]);
    custosOpMap.set(f.id, (custosRes.data ?? []) as any[]);

    const talIds = (talRes.data ?? []).map((t: any) => t.id);
    if (talIds.length > 0) {
      const { data: safrasData } = await supabase.from('safras').select('id').in('talhao_id', talIds);
      const safraIds = (safrasData ?? []).map((s: any) => s.id);
      if (safraIds.length > 0) {
        const { data: prodData } = await supabase.from('safra_dados_producao').select('*').in('safra_id', safraIds);
        (prodData ?? []).forEach((d: any) => safraDadosMap.set(d.safra_id, d));
      }
    }
  }

  const html = buildHtml(profile, fazendas, talhoesMap, custosOpMap, safraDadosMap, cotacoes, itensCotacao, propostasFornecedor, aceites, userEmail);
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
}

function barChartHtml(label: string, value: number, maxV: number, color: string): string {
  const pct = maxV > 0 ? (value / maxV) * 100 : 0;
  return `<div class="chart-bar"><div class="chart-bar-fill" style="width:${pct}%;background:${color}"></div><span class="chart-bar-label">${esc(label)}</span><span class="chart-bar-value">${value}</span></div>`;
}

function buildHtml(
  profile: any,
  fazendas: any[],
  talhoesMap: Map<string, any[]>,
  custosOpMap: Map<string, any[]>,
  safraDadosMap: Map<string, any>,
  cotacoes: any[],
  itensCotacao: any[],
  propostas: any[],
  aceites: any[],
  userEmail: string,
): string {
  const nome = esc(profile.full_name || profile.company_name || 'Usuário');
  const empresa = esc(profile.company_name || '');
  const cadastradoEm = profile.created_at ? new Date(profile.created_at).toLocaleString('pt-BR') : '—';
  const totalHa = fazendas.reduce((s, f) => {
    const talhoes = talhoesMap.get(f.id) ?? [];
    return s + (talhoes.reduce((s2, t) => s2 + (Number(t.area_ha) || 0), 0) || Number(f.area_total_ha) || 0);
  }, 0);
  const chartData = [
    { label: 'Propriedades', value: fazendas.length, color: '#2563EB' },
    { label: 'Cotações', value: cotacoes.length, color: '#F59E0B' },
    { label: 'Hectares', value: Math.round(totalHa), color: Colors.primary },
  ];
  const chartMax = Math.max(...chartData.map(d => d.value), 1);

  let sections: string[] = [];

  sections.push(`
    <div class="section">
      <h2>1. Cadastro</h2>
      <table class="data-table">
        <tr><td>Nome</td><td>${nome}</td></tr>
        <tr><td>E-mail</td><td>${esc(userEmail || '—')}</td></tr>
        <tr><td>Empresa</td><td>${empresa}</td></tr>
        <tr><td>CNPJ</td><td>${esc(profile.cnpj || '—')}</td></tr>
        <tr><td>Telefone</td><td>${esc(profile.phone || '—')}</td></tr>
        <tr><td>Cadastrado em</td><td>${cadastradoEm}</td></tr>
      </table>
      <h4>Resumo</h4>
      <div class="chart-container">
        ${chartData.map(d => barChartHtml(d.label, d.value, chartMax, d.color)).join('')}
      </div>
    </div>
  `);

  sections.push(`
    <div class="section">
      <h2>2. Propriedades (${fazendas.length})</h2>
      ${fazendas.map(f => {
        const talhoes = talhoesMap.get(f.id) ?? [];
        const haTotal = talhoes.reduce((s, t) => s + (Number(t.area_ha) || 0), 0) || Number(f.area_total_ha) || 0;
        return `
          <div class="card">
            <h3>${esc(f.nome)}</h3>
            <p>${esc(f.municipio || '')} / ${esc(f.estado || '')} • ${fmtBRL(haTotal)} ha</p>
            <p>Produtor: ${esc(f.produtor_nome || '—')}</p>
            <p><strong>Talhões: ${talhoes.length}</strong></p>
            ${talhoes.map(t => `<p class="indent">• ${esc(t.nome)} — ${Number(t.area_ha) || 0} ha</p>`).join('')}
          </div>
        `;
      }).join('')}
    </div>
  `);

  const totalCustosOp = fazendas.reduce((s, f) => {
    const custos = custosOpMap.get(f.id) ?? [];
    return s + custos.reduce((s2, c) => s2 + (Number(c.valor) || 0), 0);
  }, 0);

  sections.push(`
    <div class="section">
      <h2>3. Gestão financeira</h2>
      <p><strong>Custos operacionais totais:</strong> R$ ${fmtBRL(totalCustosOp)}</p>
      ${fazendas.map(f => {
        const custos = custosOpMap.get(f.id) ?? [];
        return custos.length > 0 ? `
          <div class="card">
            <h3>${esc(f.nome)}</h3>
            ${custos.map(c => `<p>• ${esc(c.descricao)} — R$ ${fmtBRL(Number(c.valor) || 0)}</p>`).join('')}
          </div>
        ` : '';
      }).filter(Boolean).join('')}
    </div>
  `);

  sections.push(`
    <div class="section">
      <h2>4. Cotações (${cotacoes.length})</h2>
      ${cotacoes.map(c => {
        const itens = itensCotacao.filter(i => i.cotacao_id === c.id);
        const propsCot = propostas.filter(p => p.cotacao_id === c.id);
        const aceitesCot = aceites.filter(a => a.cotacao_id === c.id);
        const areaHa = Number(c.area_ha) || 0;
        return `
          <div class="card cotacao-card">
            <h3>${esc(c.titulo)}</h3>
            <p class="cotacao-meta"><strong>Status:</strong> ${esc(c.status || '—')} &nbsp;|&nbsp; <strong>Área:</strong> ${fmtBRL(areaHa)} ha &nbsp;|&nbsp; <strong>Criada:</strong> ${c.created_at ? new Date(c.created_at).toLocaleString('pt-BR') : '—'}</p>
            <h4>Produtos cotados (${itens.length})</h4>
            <table class="prod-table">
              <thead><tr><th>Produto</th><th>Categoria</th><th>Valor/ha</th><th>Dose/ha</th></tr></thead>
              <tbody>
                ${itens.map(i => `
                  <tr>
                    <td>${esc(i.produto_nome)}</td>
                    <td>${esc(i.categoria || '—')}</td>
                    <td>R$ ${fmtBRL(Number(i.valor_ha) || 0)}</td>
                    <td>${esc(String(i.dose_ha ?? ''))} ${esc(i.unidade || '')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <h4>Propostas de fornecedores (${propsCot.length})</h4>
            <p class="proposta-legenda"><span class="badge-aceita">ACEITA</span> proposta selecionada &nbsp;|&nbsp; <span class="badge-recusada">RECUSADA</span> proposta descartada</p>
            ${propsCot.map(p => {
              const itensJson = (p.itens_json || []) as any[];
              const isAceita = p.id === c.proposta_aceita_id;
              const isRecusada = !!p.descartada;
              const badge = isAceita ? '<span class="badge-aceita">ACEITA</span>' : (isRecusada ? '<span class="badge-recusada">RECUSADA</span>' : '');
              const itensRows = itensJson.map((it: any) => {
                const nome = esc(it.produto_nome || it.produto || it.nome || '—');
                const valorHa = Number(it.valor_ha || it.valor_ha_alt || 0) || 0;
                const total = Number(it.preco_total || it.total || it.preco || 0) || 0;
                return `<tr><td>${nome}</td><td>R$ ${fmtBRL(valorHa)}/ha</td><td>${total > 0 ? 'R$ ' + fmtBRL(total) : '—'}</td></tr>`;
              }).join('');
              const itensTable = itensJson.length > 0 ? `
                <table class="proposta-itens-table">
                  <thead><tr><th>Produto</th><th>Valor/ha</th><th>Total</th></tr></thead>
                  <tbody>${itensRows}</tbody>
                </table>
              ` : '';
              return `
              <div class="proposta-block ${isRecusada ? 'proposta-recusada' : ''}">
                <p class="proposta-header"><strong>${esc(p.empresa_nome)}</strong> — Total: R$ ${fmtBRL(Number(p.total_proposta) || 0)} ${badge}</p>
                ${p.responsavel_nome ? `<p class="proposta-contato">Responsável: ${esc(p.responsavel_nome)}${p.telefone ? ` • Tel: ${esc(p.telefone)}` : ''}${p.email ? ` • ${esc(p.email)}` : ''}</p>` : ''}
                ${itensTable}
              </div>
            `;
            }).join('')}
            ${aceitesCot.length > 0 ? `
              <h4>Itens aceitos pelo produtor</h4>
              <table class="prod-table">
                <thead><tr><th>Produto</th><th>Categoria</th><th>Valor/ha</th></tr></thead>
                <tbody>
                  ${aceitesCot.map(a => `
                    <tr>
                      <td>${esc(a.produto_nome)}</td>
                      <td>${esc(a.categoria || '—')}</td>
                      <td>R$ ${fmtBRL(Number(a.valor_ha) || 0)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 15mm 12mm; }
    @media print { body { padding: 0 !important; background: #fff !important; } }
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; font-size: 11px; color: #1a2c22; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h1 { color: ${Colors.primary}; font-size: 18px; margin-bottom: 20px; }
    h2 { color: ${Colors.primary}; font-size: 14px; margin-top: 24px; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
    h3 { font-size: 12px; margin: 12px 0 6px; }
    h4 { font-size: 11px; margin: 10px 0 4px; }
    .section { margin-bottom: 24px; }
    .card { background: #f8faf8; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
    .data-table, .prod-table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .data-table td, .prod-table td, .prod-table th { padding: 6px 8px; border: 1px solid #e5e7eb; text-align: left; }
    .prod-table th { background: #e8f0ea; font-weight: 700; }
    .indent { margin-left: 16px; }
    .meta { color: #6b7280; font-size: 10px; margin-top: 20px; }
    .chart-container { margin: 16px 0; }
    .chart-bar { display: flex; align-items: center; margin: 8px 0; gap: 12px; }
    .chart-bar-fill { height: 24px; border-radius: 6px; min-width: 4px; }
    .chart-bar-label { min-width: 100px; font-weight: 600; }
    .chart-bar-value { font-weight: 800; color: ${Colors.primary}; }
    .cotacao-card { border-left: 4px solid ${Colors.primary}; }
    .cotacao-meta { margin: 8px 0; color: #4b5563; }
    .proposta-block { margin: 10px 0; padding: 12px; background: #f1f5f1; border-radius: 6px; border-left: 4px solid #e5e7eb; }
    .proposta-block.proposta-recusada { background: #fef2f2; border-left-color: #B82828; opacity: 0.9; }
    .proposta-legenda { font-size: 10px; color: #6b7280; margin-bottom: 10px; }
    .proposta-header { margin: 0 0 4px 0; }
    .proposta-contato { font-size: 10px; color: #6b7280; margin: 4px 0 8px 0; }
    .proposta-itens-table { width: 100%; font-size: 10px; border-collapse: collapse; margin-top: 8px; }
    .proposta-itens-table td, .proposta-itens-table th { padding: 4px 8px; border: 1px solid #e5e7eb; text-align: left; }
    .proposta-itens-table th { background: #e8f0ea; }
    .badge-aceita { background: #16a34a; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-left: 8px; }
    .badge-recusada { background: #B82828; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-left: 8px; }
  </style>
</head>
<body>
  <h1>Relatório Admin — ${nome}</h1>
  <p class="meta">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
  ${sections.join('')}
</body>
</html>
  `;
}
