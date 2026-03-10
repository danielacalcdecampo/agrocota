import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, ScrollView, StatusBar, Modal, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useThemeMode } from '../context/ThemeContext';
import { RootStackParamList } from '../navigation/AppNavigator';
import { exportarPropostasComparativoPdf, type PropostasComparativoPdfInput } from '../services/CotacaoPdfExportService';

interface AlternativaItem {
  nome: string;
  ia?: string;
  dose?: string;
  unidade?: string;
  valor_ha: number;
  info?: string;
}

interface PropostaItem {
  id: string;
  produto: string;
  cat: string;
  dose?: string;
  dose_orig?: string;
  ia_orig?: string;
  valor_ha: number;
  info: string;
  principio_ativo?: string;
  fonte?: string;
  disponivel?: boolean;
  alternativa?: AlternativaItem | null;
}

interface Proposta {
  id: string;
  created_at: string;
  empresa_nome: string;
  responsavel_nome: string;
  telefone: string | null;
  email: string | null;
  validade_proposta: string | null;
  observacoes: string | null;
  itens_json: PropostaItem[];
  total_proposta: number;
  lida: boolean;
  descartada?: boolean;
}

interface ItemComparacao {
  id: string;
  produto: string;
  categoria: string;
  principio_ativo: string;
  fonte: string;
  dose: string;
  melhorValor: number;
  propostas: {
    propostaId: string;
    empresa: string;
    valor_ha: number;
    info: string;
    pctAMais: number;
    isMelhor: boolean;
    isAlternativa?: boolean;
    produtoAlternativo?: string;
    doseAlternativa?: string;
    doseOriginal?: string;
    pctDiferencaDose?: number;
  }[];
}

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PropostasFornecedor'>;
  route: RouteProp<RootStackParamList, 'PropostasFornecedor'>;
};

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export default function PropostasFornecedorScreen({ navigation, route }: Props) {
  const { cotacaoId, titulo } = route.params;
  const { isDark } = useThemeMode();
  const insets = useSafeAreaInsets();

  const [propostas, setPropostas]                   = useState<Proposta[]>([]);
  const [loading, setLoading]                       = useState(true);
  const [expandidas, setExpandidas]                 = useState<Set<string>>(new Set());
  const [aceitando, setAceitando]                   = useState<string | null>(null);
  const [propostaAceitaId, setPropostaAceitaId]     = useState<string | null>(null);
  const [showComparacao, setShowComparacao]         = useState(false);
  const [itensComparacao, setItensComparacao]       = useState<ItemComparacao[]>([]);
  const [exportandoPdf, setExportandoPdf]           = useState(false);
  const [compartilhandoLink, setCompartilhandoLink] = useState(false);
  const [desfazendo, setDesfazendo]                 = useState(false);

  // Paleta limpa — mínimo de cores
  const c = {
    bg:        isDark ? '#0F1712' : '#F6F7F6',
    surface:   isDark ? '#17241C' : '#FFFFFF',
    border:    isDark ? '#233020' : '#E8E8E8',
    headerBg:  isDark ? '#111D16' : '#1B3D1B',
    title:     isDark ? '#E4F0E7' : '#111111',
    body:      isDark ? '#7A9885' : '#555555',
    muted:     isDark ? '#4D6657' : '#AAAAAA',
    accent:    '#2E7D32',
    accentBg:  isDark ? '#1A3020' : '#F0F7F0',
    rowBorder: isDark ? '#1E2E23' : '#F2F2F2',
    warnBg:    isDark ? '#2A1A0A' : '#FFF8F0',
    warnBorder:isDark ? '#4A2A0A' : '#FFE0B2',
    warnText:  isDark ? '#E8A060' : '#B45309',
  };

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [propostasRes, cotacaoRes] = await Promise.all([
        supabase.from('propostas_fornecedor').select('*').eq('cotacao_id', cotacaoId).order('total_proposta', { ascending: true }),
        supabase.from('cotacoes').select('proposta_aceita_id').eq('id', cotacaoId).single(),
      ]);

      if (!propostasRes.error) {
        // Busca os itens reais da cotação para ter principio_ativo e fonte por id
        const { data: itensCotacao } = await supabase
          .from('itens_cotacao')
          .select('id, principio_ativo, fonte, produto_nome')
          .eq('cotacao_id', cotacaoId);

        // Monta mapa: id do item → { principio_ativo, fonte }
        const paMap: Record<string, { principio_ativo: string; fonte: string }> = {};
        (itensCotacao ?? []).forEach((it: any) => {
          paMap[it.id] = {
            principio_ativo: it.principio_ativo || '',
            fonte:           it.fonte || '',
          };
        });

        // Enriquece cada proposta: injeta principio_ativo e fonte; preserva alternativa
        const parseAlternativa = (raw: any): AlternativaItem | null => {
          if (raw == null) return null;
          let obj = raw;
          if (typeof raw === 'string') {
            try { obj = JSON.parse(raw); } catch { return null; }
          }
          if (typeof obj !== 'object') return null;
          const nome = String(obj.nome ?? '').trim();
          const dose = String(obj.dose ?? '').trim();
          const valorHa = parseFloat(obj.valor_ha ?? obj.valor_ha_alt ?? 0) || 0;
          if (!nome && !dose && valorHa <= 0) return null;
          return {
            nome: nome || 'Produto alternativo',
            ia: String(obj.ia ?? '').trim(),
            dose,
            unidade: String(obj.unidade ?? 'L/ha').trim() || 'L/ha',
            valor_ha: valorHa,
            info: String(obj.info ?? '').trim(),
          };
        };

        const propostasEnriquecidas = (propostasRes.data ?? []).map((p: any) => {
          const itens = Array.isArray(p.itens_json) ? p.itens_json : (typeof p.itens_json === 'string' ? (() => { try { return JSON.parse(p.itens_json) || []; } catch { return []; } })() : []);
          return {
            ...p,
            itens_json: itens.map((item: any) => {
              const altNorm = parseAlternativa(item.alternativa);
              return {
                ...item,
                principio_ativo: item.principio_ativo || paMap[item.id]?.principio_ativo || '',
                fonte:           item.fonte           || paMap[item.id]?.fonte           || '',
                alternativa:     altNorm,
              };
            }),
          };
        });

        const raw = propostasEnriquecidas as (Proposta & { descartada?: boolean })[];
        const aceitaId = cotacaoRes.data?.proposta_aceita_id ?? null;
        // Filtra descartadas e ordena: aceita primeiro, depois por menor preço
        const ordenadas = raw
          .filter(p => !p.descartada)
          .sort((a, b) => {
            if (a.id === aceitaId) return -1;
            if (b.id === aceitaId) return 1;
            return (a.total_proposta || 0) - (b.total_proposta || 0);
          });
        setPropostas(ordenadas);
        setPropostaAceitaId(aceitaId);
        await supabase.from('propostas_fornecedor').update({ lida: true }).eq('cotacao_id', cotacaoId).eq('lida', false);
        await supabase.from('notificacoes').update({ lida: true }).eq('cotacao_id', cotacaoId).eq('lida', false);
      }
    } finally { setLoading(false); }
  }, [cotacaoId]);

  // Carrega ao montar e sempre que a tela volta ao foco (cobre link → app)
  useFocusEffect(useCallback(() => {
    carregar();
  }, [carregar]));

  // Realtime: escuta alterações na cotação (proposta_aceita_id mudou via link ou outro dispositivo)
  useEffect(() => {
    if (!cotacaoId) return;
    const channel = supabase
      .channel(`propostas-cotacao-${cotacaoId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cotacoes', filter: `id=eq.${cotacaoId}` },
        () => { carregar(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'propostas_fornecedor', filter: `cotacao_id=eq.${cotacaoId}` },
        () => { carregar(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [cotacaoId, carregar]);

  const toggleExpandir = (id: string) => {
    setExpandidas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // Gera comparação com todos os produtos que têm preço (original ou alternativa), com % diferença
  const gerarComparacao = () => {
    const mapa = new Map<string, {
      id: string; produto: string; categoria: string; principio_ativo: string; fonte: string; dose: string;
      propostas: { propostaId: string; empresa: string; valor_ha: number; info: string; isAlternativa?: boolean; produtoAlternativo?: string; doseAlternativa?: string }[];
    }>();

    const addOferta = (chave: string, item: PropostaItem, p: Proposta, valorHa: number, isAlt: boolean, altNome?: string, altDose?: string, doseOriginal?: string, pctDiferencaDose?: number) => {
      if (valorHa <= 0) return;
      const cat = String((item as any).cat || (item as any).categoria || 'Insumo').trim() || 'Insumo';
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          id: item.id, produto: item.produto, categoria: cat,
          principio_ativo: item.principio_ativo || '',
          fonte: item.fonte || '',
          dose: item.dose || item.dose_orig || '',
          propostas: [],
        });
      }
      mapa.get(chave)!.propostas.push({
        propostaId: p.id, empresa: p.empresa_nome, valor_ha: valorHa, info: item.info || '',
        isAlternativa: isAlt, produtoAlternativo: altNome, doseAlternativa: altDose, doseOriginal: doseOriginal,
        pctDiferencaDose: pctDiferencaDose,
      });
    };

    propostas.forEach(p => {
      p.itens_json.forEach(item => {
        const chave = String(item.produto || '').trim().toLowerCase();
        const indisponivel = item.disponivel === false;
        const alt = item.alternativa;

        if (indisponivel && alt && (alt.valor_ha || 0) > 0) {
          const doseOrig = String(item.dose || item.dose_orig || '').trim();
          const doseAlt = String(alt.dose || '').trim();
          const unidadeAlt = String(alt.unidade || 'L/ha').trim();
          const origNum = parseFloat(doseOrig.replace(',', '.')) || 0;
          const altNum  = parseFloat(doseAlt.replace(',', '.')) || 0;
          const pctDose = origNum > 0 ? Math.round(((altNum - origNum) / origNum) * 100) : 0;
          addOferta(chave, item, p, alt.valor_ha, true, alt.nome, doseAlt ? `${doseAlt} ${unidadeAlt}` : undefined, doseOrig || undefined, pctDose || undefined);
        } else if (item.valor_ha > 0) {
          addOferta(chave, item, p, item.valor_ha, false);
        }
      });
    });

    const itens: ItemComparacao[] = Array.from(mapa.values())
      .filter(i => i.propostas.length > 0)
      .map(item => {
        const sorted = [...item.propostas].sort((a, b) => a.valor_ha - b.valor_ha);
        const melhorValor = sorted[0]?.valor_ha ?? 0;
        return {
          ...item,
          melhorValor,
          propostas: sorted.map((p, idx) => ({
            ...p, isMelhor: idx === 0,
            pctAMais: melhorValor > 0 ? ((p.valor_ha - melhorValor) / melhorValor) * 100 : 0,
          })),
        };
      })
      .sort((a, b) => b.propostas.length - a.propostas.length || b.melhorValor - a.melhorValor);

    setItensComparacao(itens);
    setShowComparacao(true);
  };

  const handleDescartar = async (proposta: Proposta) => {
    if (propostaAceitaId === proposta.id) return;
    setPropostas(prev => prev.filter(x => x.id !== proposta.id));
    const { error } = await supabase
      .from('propostas_fornecedor')
      .update({ descartada: true })
      .eq('id', proposta.id);
    if (error) {
      console.warn('[Propostas] Erro ao persistir descarte:', error.message);
    }
  };

  const handleExportarPdf = async () => {
    if (itensComparacao.length === 0 || propostas.length === 0) return;
    setExportandoPdf(true);
    try {
      let consultorEmpresa: PropostasComparativoPdfInput['consultorEmpresa'];
      let fazendaNome: string | undefined;
      let produtorNome: string | undefined;
      let fazendaLocalizacao: string | undefined;

      const { data: cotacao } = await supabase
        .from('cotacoes')
        .select('consultor_id, fazenda_id')
        .eq('id', cotacaoId)
        .single();

      if (cotacao?.consultor_id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, company_name, cnpj, phone, company_logo_url')
          .eq('id', cotacao.consultor_id)
          .single();
        if (prof) {
          consultorEmpresa = {
            consultorNome: prof.full_name ?? undefined,
            companyName: prof.company_name ?? undefined,
            cnpj: prof.cnpj ?? undefined,
            phone: prof.phone ?? undefined,
            logoUrl: prof.company_logo_url ?? undefined,
          };
        }
      }
      if (cotacao?.fazenda_id) {
        const { data: faz } = await supabase
          .from('fazendas')
          .select('nome, produtor_nome, municipio, estado')
          .eq('id', cotacao.fazenda_id)
          .single();
        if (faz) {
          fazendaNome = faz.nome ?? undefined;
          produtorNome = faz.produtor_nome ?? undefined;
          const parts = [faz.municipio, faz.estado].filter(Boolean);
          fazendaLocalizacao = parts.length > 0 ? parts.join(' / ') : undefined;
        }
      }

      await exportarPropostasComparativoPdf({
        titulo,
        propostas: propostas.map(p => ({
          id: p.id,
          empresa_nome: p.empresa_nome,
          total_proposta: p.total_proposta,
        })),
        itensComparacao,
        consultorEmpresa,
        fazendaNome,
        produtorNome,
        fazendaLocalizacao,
      });
    } catch (err: any) {
      console.warn('[PDF] Erro ao gerar PDF:', err?.message);
    } finally {
      setExportandoPdf(false);
    }
  };

  const handleCompartilharProdutor = async () => {
    if (itensComparacao.length === 0 || propostas.length === 0) return;
    setCompartilhandoLink(true);
    try {
      // Ordena propostas do menor para o maior total (mesma ordem do comparativo)
      const sortedPropostas = [...propostas].sort((a, b) => (a.total_proposta || 0) - (b.total_proposta || 0));

      const payload = {
        mode: 'propostas',
        cotacao_id: cotacaoId,
        titulo,
        proposta_ids: sortedPropostas.map(p => p.id),
        cotacoes: sortedPropostas.map(p => ({
          titulo: p.empresa_nome,
          total: p.total_proposta || 0,
        })),
        produtos: itensComparacao.map(item => ({
          nome: item.produto,
          categoria: item.categoria,
          principio_ativo: item.principio_ativo || null,
          fonte: item.fonte || null,
          precos: sortedPropostas.map(p => {
            const oferta = item.propostas.find(o => o.propostaId === p.id);
            if (!oferta) return null;
            return {
              valor: oferta.valor_ha,
              dose: oferta.isAlternativa ? (oferta.doseOriginal || item.dose || null) : (item.dose || null),
              produtoAlternativo: oferta.produtoAlternativo || null,
              doseAlternativa: oferta.doseAlternativa || null,
              pctDiferencaDose: oferta.pctDiferencaDose || null,
            };
          }),
        })),
      };

      const data = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const url = `https://agrocota64-ctrl.github.io/aceite-agrocota/comparativo-viewer.html?id=${cotacaoId}&data=${data}`;
      await Share.share({
        message: `Comparativo de propostas — ${titulo}\n\nAcesse o link para visualizar e confirmar a proposta:\n\n${url}`,
        title: `Comparativo de Propostas — ${titulo}`,
      });
    } catch (err: any) {
      console.warn('[Compartilhar] Erro ao gerar link:', err?.message);
    } finally {
      setCompartilhandoLink(false);
    }
  };

  const handleAceitarProposta = async (proposta: Proposta) => {
    if (propostaAceitaId === proposta.id) return;
    setAceitando(proposta.id);
    try {
      // Separa itens com alternativa dos normais
      const altItems = proposta.itens_json.filter(
        i => i.disponivel === false && i.alternativa && (i.alternativa.valor_ha || 0) > 0,
      );
      const normalItems = proposta.itens_json.filter(
        i => !(i.disponivel === false && i.alternativa && (i.alternativa.valor_ha || 0) > 0)
          && (i.valor_ha || 0) > 0,
      );

      // Itens normais em paralelo (sem restauração de produto_nome)
      const normalUpdates = normalItems.map(item =>
        supabase.from('itens_cotacao').update({
          valor_ha:        item.valor_ha,
          fornecedor:      proposta.empresa_nome,
          principio_ativo: item.principio_ativo || null,
          fonte:           item.fonte || null,
        }).eq('id', item.id),
      );

      // Itens com alternativa em paralelo
      const altUpdates = altItems.map(item => {
        const updateData: Record<string, any> = {
          valor_ha:        item.alternativa!.valor_ha,
          fornecedor:      proposta.empresa_nome,
          principio_ativo: item.alternativa!.ia || null,
          fonte:           item.fonte || null,
        };
        if (item.alternativa!.nome) updateData.produto_nome = item.alternativa!.nome;
        return supabase.from('itens_cotacao').update(updateData).eq('id', item.id);
      });

      const cotacaoUpdate = supabase
        .from('cotacoes')
        .update({ proposta_aceita_id: proposta.id, status: 'aprovada' })
        .eq('id', cotacaoId);

      await Promise.all([...normalUpdates, ...altUpdates, cotacaoUpdate]);
      // Recarrega do banco para garantir estado consistente (inclui sincronismo com o link)
      await carregar();
    } catch (err) {
      console.warn('[Propostas] Erro ao aceitar:', err);
    } finally {
      setAceitando(null);
    }
  };

  const handleDesfazerAceite = async () => {
    const proposta = propostas.find(p => p.id === propostaAceitaId);
    if (!proposta || desfazendo) return;
    setDesfazendo(true);
    try {
      const altItems  = proposta.itens_json.filter(i => i.disponivel === false && i.alternativa && (i.alternativa.valor_ha || 0) > 0);
      const normalIds = proposta.itens_json.filter(i => !(i.disponivel === false && i.alternativa && (i.alternativa.valor_ha || 0) > 0)).map(i => i.id).filter(Boolean);

      const normalUpdate = normalIds.length > 0
        ? supabase.from('itens_cotacao').update({ valor_ha: 0, fornecedor: null }).in('id', normalIds)
        : Promise.resolve();

      const altUpdates = altItems.map(item =>
        supabase.from('itens_cotacao').update({
          valor_ha: 0, fornecedor: null,
          produto_nome: item.produto || undefined,
          principio_ativo: item.principio_ativo || null,
        }).eq('id', item.id),
      );

      const cotacaoUpdate = supabase
        .from('cotacoes')
        .update({ proposta_aceita_id: null, status: 'enviada' })
        .eq('id', cotacaoId);

      await Promise.all([normalUpdate, ...altUpdates, cotacaoUpdate]);
      // Recarrega do banco para garantir estado consistente
      await carregar();
    } catch (err) {
      console.warn('[Propostas] Erro ao desfazer aceite:', err);
    } finally {
      setDesfazendo(false);
    }
  };

  const renderProposta = ({ item: p, index }: { item: Proposta; index: number }) => {
    const aberta  = expandidas.has(p.id);
    const melhor  = index === 0 && propostas.length > 1;
    const aceita  = propostaAceitaId === p.id;
    const itensCom = p.itens_json.filter(it =>
      it.valor_ha > 0 || (it.alternativa && (it.alternativa.valor_ha || 0) > 0)
    );

    return (
      <View style={[
        s.card, { backgroundColor: c.surface, borderColor: aceita ? c.accent : c.border },
        aceita && { borderWidth: 1.5 },
      ]}>
        {/* Faixa de status */}
        {(aceita || melhor) && (
          <View style={[s.faixa, { backgroundColor: aceita ? c.accent : c.accentBg }]}>
            <Text style={[s.faixaText, { color: aceita ? '#fff' : c.accent }]}>
              {aceita ? 'Proposta aceita' : 'Menor preço'}
            </Text>
          </View>
        )}

        {/* Cabeçalho */}
        <TouchableOpacity style={s.cardHead} onPress={() => toggleExpandir(p.id)} activeOpacity={0.75}>
          <View style={{ flex: 1 }}>
            <Text style={[s.empresa, { color: c.title }]}>{p.empresa_nome}</Text>
            <Text style={[s.meta, { color: c.body }]}>
              {p.responsavel_nome}{p.telefone ? `  ·  ${p.telefone}` : ''}
            </Text>
            <Text style={[s.meta, { color: c.muted }]}>
              Enviado em {fmtData(p.created_at)}
              {p.validade_proposta ? `  ·  Validade: ${fmtData(p.validade_proposta)}` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[s.total, { color: aceita ? c.accent : c.title }]}>{fmtBRL(p.total_proposta)}</Text>
            <Text style={[s.meta, { color: c.muted }]}>{itensCom.length}/{p.itens_json.length} produtos</Text>
            <Text style={[s.expandir, { color: c.accent }]}>{aberta ? 'Recolher' : 'Ver itens'}</Text>
          </View>
        </TouchableOpacity>

        {/* Itens expandidos */}
        {aberta && (
          <View style={[s.itensWrap, { borderTopColor: c.border }]}>
            {p.observacoes ? (
              <View style={[s.obsBox, { backgroundColor: c.warnBg, borderColor: c.warnBorder }]}>
                <Text style={[s.obsLabel, { color: c.warnText }]}>Observações da revenda</Text>
                <Text style={[s.obsText, { color: c.title }]}>{p.observacoes}</Text>
              </View>
            ) : null}

            {/* Cabeçalho da tabela */}
            <View style={[s.tabelaHead, { borderBottomColor: c.border }]}>
              <Text style={[s.th, { color: c.muted, flex: 1 }]}>Produto</Text>
              <Text style={[s.th, { color: c.muted, width: 88, textAlign: 'right' }]}>R$/ha</Text>
            </View>

            {p.itens_json.flatMap((item) => {
                const alt = item.alternativa;
                const indisponivel = item.disponivel === false;
                const temAlternativa = alt != null;
                const rows: React.ReactNode[] = [];

                const linhaOriginal = (
                  <View key={`${item.id}-orig`} style={[s.itemRow, { borderBottomColor: c.rowBorder }, indisponivel && { backgroundColor: c.warnBg, opacity: 0.9 }]}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={[s.itemNome, { color: c.title }]} numberOfLines={2}>{item.produto}</Text>
                        {indisponivel && (
                          <View style={[s.indisponivelPill, { backgroundColor: c.warnBorder }]}>
                            <Text style={[s.indisponivelPillText, { color: c.warnText }]}>Não disponível</Text>
                          </View>
                        )}
                      </View>
                      {(item.principio_ativo || item.ia_orig) ? (
                        <Text style={[s.itemMeta, { color: c.body }]}>P.A.: {item.principio_ativo || item.ia_orig || ''}</Text>
                      ) : null}
                      {item.fonte ? <Text style={[s.itemMeta, { color: c.body }]}>Fonte: {item.fonte}</Text> : null}
                      {(item.dose || item.dose_orig) ? (
                        <Text style={[s.itemMeta, { color: c.muted }]}>{item.dose || item.dose_orig || ''}</Text>
                      ) : null}
                      {item.info ? <Text style={[s.itemMeta, { color: c.muted }]} numberOfLines={2}>{item.info}</Text> : null}
                    </View>
                    <Text style={[s.itemValor, { color: item.valor_ha > 0 ? c.accent : c.muted }]}>
                      {item.valor_ha > 0 ? `${fmtBRL(item.valor_ha)}/ha` : '—'}
                    </Text>
                  </View>
                );

                const linhaAlternativa = temAlternativa ? (
                  <View key={`${item.id}-alt`} style={[s.itemRow, s.altRow, { borderBottomColor: c.rowBorder }]}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <View style={[s.altBadge, { backgroundColor: c.accentBg }]}>
                          <Text style={[s.altBadgeText, { color: c.accent }]}>Alternativa</Text>
                        </View>
                        <Text style={[s.itemNome, { color: c.title }]} numberOfLines={2}>{alt!.nome}</Text>
                      </View>
                      {alt!.ia ? <Text style={[s.itemMeta, { color: c.body }]}>P.A.: {alt!.ia}</Text> : null}
                      {(alt!.dose || alt!.unidade || item.dose_orig || item.dose) ? (
                        <Text style={[s.itemMeta, { color: c.muted }]}>
                          Dose: {alt!.dose || '—'} {alt!.unidade || ''}
                          {(item.dose_orig || item.dose) ? (
                            (() => {
                              const origStr = String(item.dose_orig || item.dose);
                              const origDose = parseFloat(origStr.replace(',', '.').split(/[\s/]/)[0]) || 0;
                              const altDose = parseFloat(String(alt!.dose || '0').replace(',', '.')) || 0;
                              const pct = origDose > 0 ? Math.round(((altDose - origDose) / origDose) * 100) : 0;
                              return (
                                <>
                                  <Text style={{ fontSize: 11 }}> vs {origStr} (original)</Text>
                                  {pct !== 0 && (
                                    <Text style={{ fontSize: 11, color: pct > 0 ? c.warnText : c.accent, fontWeight: '600' }}>
                                      {' '}{pct > 0 ? '+' : ''}{pct}%
                                    </Text>
                                  )}
                                </>
                              );
                            })()
                          ) : null}
                        </Text>
                      ) : null}
                      {alt!.info ? <Text style={[s.itemMeta, { color: c.muted }]} numberOfLines={2}>{alt!.info}</Text> : null}
                    </View>
                    <Text style={[s.itemValor, { color: (alt!.valor_ha || 0) > 0 ? c.accent : c.muted }]}>
                      {(alt!.valor_ha || 0) > 0 ? `${fmtBRL(alt!.valor_ha)}/ha` : '—'}
                    </Text>
                  </View>
                ) : null;

                rows.push(linhaOriginal);
                if (temAlternativa) rows.push(linhaAlternativa!);
                return rows;
              })}
          </View>
        )}

        {/* Ações: Aceitar / Descartar */}
        <View style={[s.cardFoot, { borderTopColor: c.border }]}>
          {aceita ? (
            <View style={s.cardFootRow}>
              <View style={[s.btnAceitar, s.btnAceitarFlex, { backgroundColor: c.accentBg, borderWidth: 1, borderColor: c.accent }]}>
                <Text style={[s.btnAceitarText, { color: c.accent }]}>✓ Aceita</Text>
              </View>
              <TouchableOpacity
                style={[s.btnDescartar, { borderColor: c.border }]}
                onPress={handleDesfazerAceite}
                disabled={desfazendo}
                activeOpacity={0.75}
              >
                {desfazendo
                  ? <ActivityIndicator size="small" color={c.muted} />
                  : <Text style={[s.btnDescartarText, { color: c.muted }]}>Mudar de ideia</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.cardFootRow}>
              <TouchableOpacity
                style={[s.btnAceitar, s.btnAceitarFlex, { backgroundColor: c.accent }, aceitando === p.id && { opacity: 0.6 }]}
                onPress={() => handleAceitarProposta(p)}
                disabled={!!aceitando}
                activeOpacity={0.82}
              >
                {aceitando === p.id
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={[s.btnAceitarText, { color: '#fff' }]}>Aceitar proposta</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnDescartar, { borderColor: c.border }]}
                onPress={() => handleDescartar(p)}
                activeOpacity={0.75}
              >
                <Text style={[s.btnDescartarText, { color: c.muted }]}>Descartar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  // Modal de comparação — layout tabela, contraste claro entre ofertas
  const renderComparacao = () => (
    <Modal visible={showComparacao} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowComparacao(false)}>
      <View style={[s.modalRoot, { backgroundColor: c.bg }]}>
        <StatusBar barStyle="light-content" backgroundColor={c.headerBg} />

        <View style={[s.modalHeader, { paddingTop: insets.top + 12, backgroundColor: c.headerBg }]}>
          {/* Linha 1: título + fechar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.modalHeaderTitle}>Comparação de propostas</Text>
              <Text style={s.modalHeaderSub}>{propostas.length} revendas · {itensComparacao.length} produtos</Text>
            </View>
            <TouchableOpacity onPress={() => setShowComparacao(false)} style={s.modalCloseBtn}>
              <Text style={s.modalCloseTxt}>Fechar</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.modalHeaderPorHa}>Valores em R$/ha · Total calculado pelo talhão ao aceitar</Text>
          {/* Linha 2: botões de ação */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity
              style={[s.modalPdfBtn, { flex: 1, borderColor: 'rgba(255,255,255,0.4)' }]}
              onPress={handleExportarPdf}
              disabled={exportandoPdf || compartilhandoLink}
              activeOpacity={0.8}
            >
              {exportandoPdf
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.modalPdfBtnTxt}>Exportar PDF</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalPdfBtn, { flex: 1, borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.12)' }]}
              onPress={handleCompartilharProdutor}
              disabled={compartilhandoLink || exportandoPdf}
              activeOpacity={0.8}
            >
              {compartilhandoLink
                ? <ActivityIndicator size="small" color="#4ade80" />
                : <Text style={[s.modalPdfBtnTxt, { color: '#4ade80' }]}>Enviar ao Produtor</Text>}
            </TouchableOpacity>
          </View>
        </View>

        {itensComparacao.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={[s.emptyTitle, { color: c.title }]}>Nenhum produto com preço informado</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 32, gap: 16 }} showsVerticalScrollIndicator={false}>
            {itensComparacao.map((item, idx) => (
              <View key={idx} style={[s.compCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                {/* Cabeçalho do produto — dose original sempre visível */}
                <View style={[s.compProdInfo, { borderBottomWidth: 1, borderBottomColor: c.border }]}>
                  <Text style={[s.compNome, { color: c.title }]}>{item.produto}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {item.principio_ativo ? (
                      <Text style={[s.compMeta, { color: c.body }]}>P.A.: {item.principio_ativo}</Text>
                    ) : null}
                    {item.fonte ? (
                      <Text style={[s.compMeta, { color: c.body }]}>Fonte: {item.fonte}</Text>
                    ) : null}
                    {item.dose ? (
                      <Text style={[s.compDoseOrig, { color: c.muted }]}>Dose solic.: {item.dose}</Text>
                    ) : null}
                  </View>
                </View>

                {/* Tabela de ofertas — zebra + destaque no melhor */}
                <View style={s.ofertasWrap}>
                  <View style={[s.compTableHead, { backgroundColor: isDark ? '#1E2E23' : '#F0F2F0', borderBottomWidth: 1, borderBottomColor: c.border }]}>
                    <Text style={[s.compTableTh, { color: c.muted, flex: 1 }]}>Revenda / Produto</Text>
                    <Text style={[s.compTableTh, { color: c.muted, width: 70 }]}>Dose</Text>
                    <Text style={[s.compTableTh, { color: c.muted, width: 85, textAlign: 'right' }]}>R$/ha</Text>
                  </View>
                  {item.propostas.map((oferta, oIdx) => {
                    const isZebra = oIdx % 2 === 1;
                    const rowBg = oferta.isMelhor
                      ? (isDark ? '#1A3020' : '#E8F5E9')
                      : (isZebra ? (isDark ? '#1D2A20' : '#FAFAFA') : 'transparent');
                    return (
                      <View
                        key={`${oferta.propostaId}-${oIdx}`}
                        style={[
                          s.compOfertaRow,
                          { backgroundColor: rowBg, borderBottomColor: c.rowBorder },
                          oferta.isMelhor && { borderLeftWidth: 4, borderLeftColor: c.accent },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={[s.ofertaEmpresa, { color: c.title }]}>{oferta.empresa}</Text>
                            {oferta.isMelhor && (
                              <View style={[s.melhorPill, { backgroundColor: c.accent }]}>
                                <Text style={s.melhorPillTxt}>Melhor</Text>
                              </View>
                            )}
                          </View>
                          {oferta.isAlternativa && oferta.produtoAlternativo ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                              <View style={[s.altBadge, { backgroundColor: c.accentBg }]}>
                                <Text style={[s.altBadgeText, { color: c.accent }]}>Alternativa</Text>
                              </View>
                              <Text style={[s.ofertaInfo, { color: c.body }]}>{oferta.produtoAlternativo}</Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={{ width: 80 }}>
                          {oferta.isAlternativa ? (
                            <>
                              {oferta.doseOriginal ? (
                                <Text style={[s.ofertaDose, { color: c.muted }]}>Orig: {oferta.doseOriginal}</Text>
                              ) : null}
                              {oferta.doseAlternativa ? (
                                <Text style={[s.ofertaDose, { color: c.accent, fontWeight: '700' }]}>Alt: {oferta.doseAlternativa}</Text>
                              ) : null}
                              {oferta.pctDiferencaDose !== undefined && oferta.pctDiferencaDose !== 0 ? (
                                <Text style={{ fontSize: 10, fontWeight: '700', color: oferta.pctDiferencaDose > 0 ? '#E07B00' : c.accent }}>
                                  {oferta.pctDiferencaDose > 0 ? '+' : ''}{oferta.pctDiferencaDose}% dose
                                </Text>
                              ) : null}
                            </>
                          ) : (
                            <Text style={[s.ofertaDose, { color: c.muted }]}>{item.dose || '—'}</Text>
                          )}
                        </View>
                        <View style={{ width: 85, alignItems: 'flex-end' }}>
                          <Text style={[s.ofertaValor, { color: oferta.isMelhor ? c.accent : c.title }]}>
                            {fmtBRL(oferta.valor_ha)}
                          </Text>
                          {!oferta.isMelhor && oferta.pctAMais > 0 ? (
                            <Text style={[s.ofertaPct, { color: c.muted }]}>+{oferta.pctAMais.toFixed(0)}%</Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );

  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <StatusBar barStyle="light-content" backgroundColor={c.headerBg} />

      <View style={[s.header, { paddingTop: insets.top + 12, backgroundColor: c.headerBg }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backBtnText}>Voltar</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Propostas recebidas</Text>
          <Text style={s.headerSub} numberOfLines={1}>{titulo}</Text>
          <Text style={s.headerPorHa}>Valores em R$/ha · Total pelo talhão ao aceitar</Text>
        </View>
      </View>

      {!loading && propostas.length > 0 && (
        <View style={[s.barra, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.barraTxt, { color: c.body }]}>
              {propostas.length} proposta{propostas.length > 1 ? 's' : ''} — menor preço primeiro
            </Text>
            <Text style={[s.barraPorHa, { color: c.muted }]}>
              Valores em R$/ha · Total calculado pelo talhão ao aceitar
            </Text>
          </View>
          <TouchableOpacity
            style={[s.btnComparar, { borderColor: c.border }]}
            onPress={gerarComparacao}
            activeOpacity={0.75}
          >
            <Text style={[s.btnCompararTxt, { color: c.accent }]}>Comparar</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={s.centrado}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : propostas.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={[s.emptyTitle, { color: c.title }]}>Nenhuma proposta recebida</Text>
          <Text style={[s.emptyBody, { color: c.body }]}>Gere um link exclusivo para cada revenda enviar sua proposta.</Text>
        </View>
      ) : (
        <FlatList
          data={propostas}
          keyExtractor={p => p.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 24 }]}
          renderItem={renderProposta}
        />
      )}

      {renderComparacao()}
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1 },
  centrado: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, gap: 12 },
  backBtn:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)' },
  backBtnText: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '500' },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  headerSub:   { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 1 },
  headerPorHa: { color: 'rgba(255,255,255,0.65)', fontSize: 10, marginTop: 4 },

  barra:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, gap: 12 },
  barraTxt:     { flex: 1, fontSize: 12 },
  barraPorHa:   { fontSize: 11, marginTop: 2 },
  btnComparar:  { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  btnCompararTxt:{ fontSize: 13, fontWeight: '600' },

  emptyWrap:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptyBody:  { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  list:       { padding: 14, gap: 12 },

  card:      { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  faixa:     { paddingHorizontal: 14, paddingVertical: 6 },
  faixaText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },

  cardHead:  { flexDirection: 'row', padding: 14, gap: 10, alignItems: 'flex-start' },
  empresa:   { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  meta:      { fontSize: 12, marginTop: 1 },
  total:     { fontSize: 19, fontWeight: '700' },
  expandir:  { fontSize: 12, fontWeight: '600', marginTop: 2 },

  itensWrap: { borderTopWidth: 1 },
  obsBox:    { margin: 12, padding: 12, borderRadius: 8, borderWidth: 1 },
  obsLabel:  { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  obsText:   { fontSize: 13, lineHeight: 18 },

  tabelaHead: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1 },
  th:         { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },

  itemRow:    { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, gap: 10, alignItems: 'flex-start' },
  itemNome:   { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  itemMeta:   { fontSize: 12, marginTop: 2, lineHeight: 16 },
  itemValor:  { width: 88, fontSize: 14, fontWeight: '700', textAlign: 'right', paddingTop: 1 },
  indisponivelPill:   { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  indisponivelPillText:{ fontSize: 10, fontWeight: '700' },
  altRow:     { borderLeftWidth: 3, borderLeftColor: '#2e7d32', marginLeft: 14 },
  altBadge:   { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start' },
  altBadgeText:{ fontSize: 10, fontWeight: '700' },

  cardFoot:      { padding: 12, borderTopWidth: 1 },
  cardFootRow:   { flexDirection: 'row', gap: 10, alignItems: 'center' },
  btnAceitar:    { height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnAceitarFlex:{ flex: 1 },
  btnAceitarText:{ fontSize: 14, fontWeight: '600' },
  btnDescartar:  { height: 46, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnDescartarText: { fontSize: 13, fontWeight: '600' },

  // Modal
  modalRoot:       { flex: 1 },
  modalHeader:     { flexDirection: 'column', paddingHorizontal: 16, paddingBottom: 14 },
  modalHeaderTitle:{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  modalHeaderSub:  { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 1 },
  modalHeaderPorHa:{ color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 4 },
  modalPdfBtn:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1, minWidth: 110, alignItems: 'center', justifyContent: 'center' },
  modalPdfBtnTxt:  { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  modalCloseBtn:   { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)' },
  modalCloseTxt:   { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '500' },

  compCard:       { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  compProdInfo:   { padding: 14 },
  compNome:       { fontSize: 16, fontWeight: '800' },
  compMeta:       { fontSize: 12, lineHeight: 17 },
  compDoseOrig:   { fontSize: 11, fontStyle: 'italic' },
  compTableHead:  { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10 },
  compTableTh:    { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  ofertasWrap:    {},
  compOfertaRow:  { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, alignItems: 'center', gap: 10 },
  ofertaEmpresa:  { fontSize: 14, fontWeight: '700' },
  ofertaInfo:     { fontSize: 12, lineHeight: 16 },
  ofertaDose:     { fontSize: 11, lineHeight: 15 },
  ofertaValor:    { fontSize: 15, fontWeight: '800' },
  ofertaPct:      { fontSize: 10 },
  melhorPill:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  melhorPillTxt:  { color: '#fff', fontSize: 10, fontWeight: '800' },
});