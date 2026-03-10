-- ============================================================
-- AGROCOTA — FIX V2 recursão RLS (cotacoes <-> fazendas)
-- Execute no SQL Editor do Supabase
-- ============================================================

BEGIN;

-- 0) Remove policy cruzada em fazendas que referencia cotacoes (causa ciclo)
DROP POLICY IF EXISTS "fazendas_public_by_token" ON public.fazendas;

-- 1) Helper sem RLS para validar posse da fazenda pelo produtor
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

-- 2) Recria SOMENTE a policy de produtor em cotacoes usando helper (sem subquery com RLS)
DROP POLICY IF EXISTS cotacoes_produtor_select ON public.cotacoes;
CREATE POLICY cotacoes_produtor_select ON public.cotacoes
FOR SELECT
USING (public.produtor_possui_fazenda(fazenda_id));

COMMIT;

-- ============================================================
-- Verificação
-- ============================================================
-- SELECT policyname, qual
-- FROM pg_policies
-- WHERE schemaname='public' AND tablename IN ('cotacoes','fazendas')
-- ORDER BY tablename, policyname;
