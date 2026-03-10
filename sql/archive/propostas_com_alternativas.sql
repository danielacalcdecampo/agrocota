-- ═══════════════════════════════════════════════════════════════════
-- SUPABASE: Suporte a Produtos Indisponíveis + Alternativas
-- ═══════════════════════════════════════════════════════════════════
-- Não é necessária nenhuma alteração de schema!
-- A tabela propostas_fornecedor já possui itens_json (jsonb)
-- que agora armazena a estrutura expandida abaixo.
--
-- ESTRUTURA DO ITEM EM itens_json (nova):
-- {
--   "id":         "uuid-do-item-cotacao",
--   "produto":    "Roundup Original",           -- nome do produto do consultor
--   "cat":        "Herbicida",
--   "dose_orig":  "4 L/ha",                     -- dose travada enviada pelo consultor
--   "ia_orig":    "Glifosato 360 g/L",
--   "disponivel": false,                         -- true = revenda tem; false = não tem
--   "valor_ha":   0,                             -- valor quando disponivel=true
--   "info":       "...",                         -- informações gerais da revenda
--   "alternativa": {                             -- null quando disponivel=true
--     "nome":     "Zapp QI 620",
--     "ia":       "Glifosato 620 g/L",
--     "dose":     "3",
--     "unidade":  "L/ha",
--     "valor_ha": 38.50,
--     "info":     "Disponível em 2 dias úteis"
--   }
-- }
-- ═══════════════════════════════════════════════════════════════════

-- ─── VIEW: Facilita leitura das propostas com alternativas ───────
CREATE OR REPLACE VIEW public.v_propostas_com_alternativas AS
SELECT
  pf.id               AS proposta_id,
  pf.cotacao_id,
  pf.empresa_nome,
  pf.responsavel_nome,
  pf.total_proposta,
  pf.created_at,
  pf.lida,
  -- Itens disponíveis (cotados normalmente)
  (
    SELECT COUNT(*)
    FROM jsonb_array_elements(pf.itens_json) AS it
    WHERE (it->>'disponivel')::boolean = true
      AND (it->>'valor_ha')::numeric > 0
  ) AS qtd_cotados,
  -- Itens marcados como indisponíveis
  (
    SELECT COUNT(*)
    FROM jsonb_array_elements(pf.itens_json) AS it
    WHERE (it->>'disponivel')::boolean = false
  ) AS qtd_indisponiveis,
  -- Itens indisponíveis com alternativa proposta
  (
    SELECT COUNT(*)
    FROM jsonb_array_elements(pf.itens_json) AS it
    WHERE (it->>'disponivel')::boolean = false
      AND it->'alternativa' IS NOT NULL
      AND it->>'alternativa' != 'null'
  ) AS qtd_com_alternativa
FROM public.propostas_fornecedor pf;

-- ─── VIEW: Detalhe item a item com alternativa (flat) ────────────
CREATE OR REPLACE VIEW public.v_itens_proposta_detalhado AS
SELECT
  pf.id               AS proposta_id,
  pf.cotacao_id,
  pf.empresa_nome,
  (it->>'id')         AS item_cotacao_id,
  (it->>'produto')    AS produto_orig,
  (it->>'cat')        AS categoria,
  (it->>'dose_orig')  AS dose_orig,
  (it->>'ia_orig')    AS ia_orig,
  ((it->>'disponivel')::boolean) AS disponivel,
  (it->>'valor_ha')::numeric     AS valor_ha_ofertado,
  -- Alternativa (quando disponivel = false)
  (it->'alternativa'->>'nome')     AS alt_nome,
  (it->'alternativa'->>'ia')       AS alt_ia,
  (it->'alternativa'->>'dose')     AS alt_dose,
  (it->'alternativa'->>'unidade')  AS alt_unidade,
  (it->'alternativa'->>'valor_ha')::numeric AS alt_valor_ha,
  (it->'alternativa'->>'info')     AS alt_info
FROM public.propostas_fornecedor pf,
     jsonb_array_elements(pf.itens_json) AS it;

-- ─── RLS: garantir acesso anônimo leitura (já deve existir) ──────
-- As views herdam as políticas das tabelas base.
-- Se precisar garantir acesso anônimo às views:
-- ALTER VIEW public.v_propostas_com_alternativas OWNER TO anon;
-- ALTER VIEW public.v_itens_proposta_detalhado   OWNER TO anon;

-- ─── GRANT para anon e service_role ──────────────────────────────
GRANT SELECT ON public.v_propostas_com_alternativas TO anon, authenticated, service_role;
GRANT SELECT ON public.v_itens_proposta_detalhado   TO anon, authenticated, service_role;
