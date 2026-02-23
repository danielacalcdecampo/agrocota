-- ============================================================
--  Conectar cotacoes às propriedades + rastrear compras
--  Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Vincular cotação a uma fazenda (campo opcional)
ALTER TABLE cotacoes
  ADD COLUMN IF NOT EXISTS fazenda_id UUID REFERENCES fazendas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cotacoes_fazenda ON cotacoes(fazenda_id);

-- 2. Rastrear compra realizada por item aceito
ALTER TABLE cotacao_aceites
  ADD COLUMN IF NOT EXISTS compra_realizada_em TIMESTAMPTZ;

ALTER TABLE cotacao_aceites
  ADD COLUMN IF NOT EXISTS compra_obs TEXT;

-- 3. RLS: permitir update de compra_realizada_em para auth'd (consultor)
DROP POLICY IF EXISTS "cotacao_aceites_consultor_update" ON cotacao_aceites;
CREATE POLICY "cotacao_aceites_consultor_update" ON cotacao_aceites
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM cotacoes c
      WHERE c.id = cotacao_id AND c.consultor_id = auth.uid()
    )
  );
