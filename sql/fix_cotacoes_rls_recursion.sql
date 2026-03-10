-- ============================================================
-- AGROCOTA — FIX "infinite recursion detected in policy for relation cotacoes"
-- Resolve erro ao abrir link de cotação compartilhada (token).
-- Execute no SQL Editor do Supabase
-- ============================================================

BEGIN;

-- 0) Remove policy cruzada em fazendas que referencia cotacoes (causa ciclo)
DROP POLICY IF EXISTS "fazendas_public_by_token" ON public.fazendas;

-- 1) Helper SECURITY DEFINER: valida se produtor possui a fazenda (evita RLS recursivo)
CREATE OR REPLACE FUNCTION public.produtor_possui_fazenda(p_fazenda_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fazendas f
    WHERE f.id = p_fazenda_id
      AND f.produtor_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.produtor_possui_fazenda(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.produtor_possui_fazenda(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.produtor_possui_fazenda(UUID) TO anon;

-- 2) Remove TODAS as policies atuais de cotacoes
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cotacoes'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.cotacoes;', p.policyname);
  END LOOP;
END
$$;

-- 3) Recria policies SEM recursão

-- Consultor: acesso total às suas cotações
CREATE POLICY "cotacoes_consultor_all" ON public.cotacoes
  FOR ALL
  USING (consultor_id = auth.uid())
  WITH CHECK (consultor_id = auth.uid());

-- Produtor: lê cotações via helper (sem subquery que dispara RLS de fazendas)
CREATE POLICY "cotacoes_produtor_select" ON public.cotacoes
  FOR SELECT
  USING (public.produtor_possui_fazenda(fazenda_id));

-- Público/anon: leitura por token (link compartilhado) — SEM referenciar outras tabelas
CREATE POLICY "cotacoes_public_token_select" ON public.cotacoes
  FOR SELECT
  USING (approval_token IS NOT NULL);

-- Público/anon: atualização de status de aprovação pelo link
CREATE POLICY "cotacoes_public_token_update" ON public.cotacoes
  FOR UPDATE
  USING (
    approval_token IS NOT NULL
    AND (approval_token_exp IS NULL OR approval_token_exp > now())
  )
  WITH CHECK (
    approval_token IS NOT NULL
    AND status IN ('aprovada', 'recusada')
  );

-- 4) itens_cotacao: leitura pública quando a cotação tem approval_token
-- (usado pelos viewers index.html e agrocota-fornecedor.html)
DROP POLICY IF EXISTS "itens_public_by_cotacao_token" ON public.itens_cotacao;
DROP POLICY IF EXISTS "itens_public_by_token" ON public.itens_cotacao;
CREATE POLICY "itens_public_by_token" ON public.itens_cotacao
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cotacoes c
      WHERE c.id = cotacao_id AND c.approval_token IS NOT NULL
    )
  );

COMMIT;

-- ============================================================
-- Verificação (opcional)
-- ============================================================
-- SELECT policyname, cmd, permissive
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('cotacoes','itens_cotacao')
-- ORDER BY tablename, policyname;
