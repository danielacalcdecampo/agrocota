-- ============================================================
-- Fix: Consultor deve ler propostas_fornecedor das suas cotações
-- Execute no SQL Editor do Supabase se "Propostas Recebidas" não aparecer na home
-- ============================================================

-- Garante que RLS está habilitado
ALTER TABLE public.propostas_fornecedor ENABLE ROW LEVEL SECURITY;

-- Consultor pode SELECT propostas cuja cotação pertence a ele
DROP POLICY IF EXISTS "consultor_select_propostas_suas_cotacoes" ON public.propostas_fornecedor;
CREATE POLICY "consultor_select_propostas_suas_cotacoes" ON public.propostas_fornecedor
  FOR SELECT
  USING (
    cotacao_id IN (
      SELECT id FROM public.cotacoes WHERE consultor_id = auth.uid()
    )
  );

-- Consultor pode UPDATE (marcar lida, descartada) nas propostas das suas cotações
DROP POLICY IF EXISTS "consultor_update_propostas_suas_cotacoes" ON public.propostas_fornecedor;
CREATE POLICY "consultor_update_propostas_suas_cotacoes" ON public.propostas_fornecedor
  FOR UPDATE
  USING (
    cotacao_id IN (
      SELECT id FROM public.cotacoes WHERE consultor_id = auth.uid()
    )
  )
  WITH CHECK (
    cotacao_id IN (
      SELECT id FROM public.cotacoes WHERE consultor_id = auth.uid()
    )
  );

-- Coluna para o consultor descartar propostas (oculta da lista, mas preserva no banco)
ALTER TABLE public.propostas_fornecedor ADD COLUMN IF NOT EXISTS descartada BOOLEAN DEFAULT false;
