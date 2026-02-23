-- ============================================================
-- AGROCOTA — FIX RLS recursao infinita no viewer publico
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Funcao para buscar cotacao por token (bypassa RLS)
CREATE OR REPLACE FUNCTION get_cotacao_by_token(p_token TEXT)
RETURNS TABLE (
  id            UUID,
  titulo        TEXT,
  status        TEXT,
  created_at    TIMESTAMPTZ,
  fazenda_id    UUID,
  consultor_id  UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, titulo, status, created_at, fazenda_id, consultor_id
  FROM cotacoes
  WHERE approval_token = p_token
  LIMIT 1;
$$;

-- Permissao para anon chamar a funcao
GRANT EXECUTE ON FUNCTION get_cotacao_by_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_cotacao_by_token(TEXT) TO authenticated;


-- 2. Funcao para buscar itens por cotacao_id (bypassa RLS)
CREATE OR REPLACE FUNCTION get_itens_by_cotacao(p_cotacao_id UUID)
RETURNS TABLE (
  id            UUID,
  produto_nome  TEXT,
  fornecedor    TEXT,
  categoria     TEXT,
  valor_ha      NUMERIC,
  dose_ha       NUMERIC,
  unidade       TEXT,
  quantidade    NUMERIC,
  preco_unitario NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, produto_nome, fornecedor, categoria, valor_ha, dose_ha, unidade, quantidade, preco_unitario
  FROM itens_cotacao
  WHERE cotacao_id = p_cotacao_id
  ORDER BY categoria, produto_nome;
$$;

GRANT EXECUTE ON FUNCTION get_itens_by_cotacao(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_itens_by_cotacao(UUID) TO authenticated;


-- 3. Funcao para buscar fazenda por id (bypassa RLS)
CREATE OR REPLACE FUNCTION get_fazenda_by_id(p_id UUID)
RETURNS TABLE (
  nome               TEXT,
  area_total_ha      NUMERIC,
  cultura_principal  TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nome, area_total_ha, cultura_principal
  FROM fazendas
  WHERE id = p_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_fazenda_by_id(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_fazenda_by_id(UUID) TO authenticated;


-- 4. Funcao para buscar nome do consultor (bypassa RLS)
CREATE OR REPLACE FUNCTION get_profile_name(p_id UUID)
RETURNS TABLE (full_name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT full_name FROM profiles WHERE id = p_id LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_profile_name(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_profile_name(UUID) TO authenticated;
