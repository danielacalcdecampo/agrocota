-- ============================================================
-- AGROCOTA — FIX recursao infinita em cotacoes RLS
-- Execute no SQL Editor do Supabase
-- ============================================================

-- Remove todas as policies existentes em cotacoes para recriar limpo
DROP POLICY IF EXISTS "cotacoes_public_by_token"                        ON cotacoes;
DROP POLICY IF EXISTS "Consultor gerencia suas cotações"               ON cotacoes;
DROP POLICY IF EXISTS "Consultor gerencia suas cotacoes"               ON cotacoes;
DROP POLICY IF EXISTS "Produtor visualiza cotações da sua fazenda"     ON cotacoes;
DROP POLICY IF EXISTS "Produtor visualiza cotacoes da sua fazenda"     ON cotacoes;
DROP POLICY IF EXISTS "cotacoes_consultor"                             ON cotacoes;
DROP POLICY IF EXISTS "cotacoes_produtor"                              ON cotacoes;
DROP POLICY IF EXISTS "cotacoes_anon_token"                            ON cotacoes;
DROP POLICY IF EXISTS "Aprovação pública lê cotações"                  ON cotacoes;

-- Recria policies sem recursao

-- Consultor: acesso total às suas cotações
CREATE POLICY "cotacoes_consultor" ON cotacoes
  FOR ALL
  USING (consultor_id = auth.uid());

-- Produtor: lê cotações vinculadas às suas fazendas
-- USA subquery em fazendas (sem recursao)
CREATE POLICY "cotacoes_produtor" ON cotacoes
  FOR SELECT
  USING (
    fazenda_id IN (
      SELECT id FROM fazendas WHERE produtor_id = auth.uid()
    )
  );

-- Anon/público: lê cotações que têm approval_token (sem referenciar cotacoes de novo)
CREATE POLICY "cotacoes_anon_token" ON cotacoes
  FOR SELECT
  USING (approval_token IS NOT NULL);

-- ============================================================
-- Garante que fazendas nao tem recursao tambem
-- ============================================================
DROP POLICY IF EXISTS "Produtor gerencia suas fazendas"    ON fazendas;
DROP POLICY IF EXISTS "Consultor acessa fazendas"          ON fazendas;
DROP POLICY IF EXISTS "fazendas_produtor"                  ON fazendas;
DROP POLICY IF EXISTS "fazendas_consultor"                 ON fazendas;
DROP POLICY IF EXISTS "fazendas_public_by_token"           ON fazendas;

CREATE POLICY "fazendas_produtor" ON fazendas
  FOR ALL
  USING (produtor_id = auth.uid());

CREATE POLICY "fazendas_consultor" ON fazendas
  FOR ALL
  USING (consultor_id = auth.uid());
