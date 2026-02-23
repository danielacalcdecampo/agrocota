-- ============================================================
-- AGROCOTA — COTACOES V2 (Excel Import + Share Link + Push)
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ============================================================
-- 1. ADICIONAR COLUNAS EM cotacoes (para import Excel)
-- ============================================================
ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS share_url        TEXT;
ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS excel_itens_json JSONB;   -- backup raw do Excel

-- Garante que approval_token seja único e indexado
CREATE UNIQUE INDEX IF NOT EXISTS cotacoes_approval_token_idx ON cotacoes(approval_token);

-- ============================================================
-- 2. TABELA: push_tokens (Expo Notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  platform    TEXT CHECK (platform IN ('ios', 'android', 'web')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- RLS: usuário só vê e gerencia seus próprios tokens
DROP POLICY IF EXISTS "push_tokens_self" ON push_tokens;
CREATE POLICY "push_tokens_self" ON push_tokens
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 3. TABELA: cotacao_aceites (escolhas do produtor via link)
-- ============================================================
CREATE TABLE IF NOT EXISTS cotacao_aceites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotacao_id      UUID NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
  categoria       TEXT NOT NULL,
  item_id         UUID REFERENCES itens_cotacao(id),
  produto_nome    TEXT,
  fornecedor      TEXT,
  valor_ha        NUMERIC(12,2),
  aceito_em       TIMESTAMPTZ DEFAULT now(),
  produtor_nome   TEXT,
  produtor_email  TEXT
);
ALTER TABLE cotacao_aceites ENABLE ROW LEVEL SECURITY;

-- Leitura pública por approval_token (via cotacao_id)
DROP POLICY IF EXISTS "cotacao_aceites_public_insert" ON cotacao_aceites;
CREATE POLICY "cotacao_aceites_public_insert" ON cotacao_aceites
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM cotacoes c
      WHERE c.id = cotacao_id
        AND c.approval_token IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "cotacao_aceites_consultor_read" ON cotacao_aceites;
CREATE POLICY "cotacao_aceites_consultor_read" ON cotacao_aceites
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cotacoes c
      WHERE c.id = cotacao_id AND c.consultor_id = auth.uid()
    )
  );

-- ============================================================
-- 4. RLS: leitura pública de cotacoes por approval_token
-- ============================================================
DROP POLICY IF EXISTS "cotacoes_public_by_token" ON cotacoes;
CREATE POLICY "cotacoes_public_by_token" ON cotacoes
  FOR SELECT USING (
    approval_token IS NOT NULL
    OR consultor_id = auth.uid()
  );

-- ============================================================
-- 5. RLS: leitura pública de itens_cotacao por token
-- ============================================================
DROP POLICY IF EXISTS "itens_public_by_cotacao_token" ON itens_cotacao;
CREATE POLICY "itens_public_by_cotacao_token" ON itens_cotacao
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cotacoes c
      WHERE c.id = cotacao_id AND c.approval_token IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM cotacoes c
      WHERE c.id = cotacao_id AND c.consultor_id = auth.uid()
    )
  );

-- ============================================================
-- 6. FUNCAO: notificar_consultor_aceite
--    Chamada pelo Edge Function após produtor dar aceite
-- ============================================================
CREATE OR REPLACE FUNCTION notificar_aceite_consultor(p_cotacao_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_consultor_id UUID;
  v_titulo       TEXT;
BEGIN
  SELECT consultor_id, titulo INTO v_consultor_id, v_titulo
  FROM cotacoes WHERE id = p_cotacao_id;

  -- Atualiza status da cotacao
  UPDATE cotacoes
  SET status = 'aprovada', approved_at = now(), approved_by_type = 'link'
  WHERE id = p_cotacao_id;

  RETURN v_titulo;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
