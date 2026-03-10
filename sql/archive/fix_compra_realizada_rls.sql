-- Permite que o consultor marque/desmarque compra_realizada_em
-- nos aceites das suas próprias cotações.

DROP POLICY IF EXISTS "cotacao_aceites_consultor_update" ON cotacao_aceites;
CREATE POLICY "cotacao_aceites_consultor_update" ON cotacao_aceites
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM cotacoes c
      WHERE c.id = cotacao_id AND c.consultor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cotacoes c
      WHERE c.id = cotacao_id AND c.consultor_id = auth.uid()
    )
  );
