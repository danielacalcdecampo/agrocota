-- ============================================================
-- AGROCOTA — FIX "infinite recursion detected in policy for relation cotacoes"
-- Execute no SQL Editor do Supabase
-- ============================================================

BEGIN;

-- 1) Remove TODAS as policies atuais de cotacoes (nomes antigos/legados inclusos)
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'cotacoes'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.cotacoes;', p.policyname);
  END LOOP;
END
$$;

-- 2) Garante RLS ligado
ALTER TABLE public.cotacoes ENABLE ROW LEVEL SECURITY;

-- 3) Recria policies sem recursão
-- Consultor: lê apenas suas cotações
CREATE POLICY cotacoes_consultor_select ON public.cotacoes
FOR SELECT
USING (consultor_id = auth.uid());

-- Consultor: insere cotação para si
CREATE POLICY cotacoes_consultor_insert ON public.cotacoes
FOR INSERT
WITH CHECK (consultor_id = auth.uid());

-- Consultor: atualiza apenas suas cotações
CREATE POLICY cotacoes_consultor_update ON public.cotacoes
FOR UPDATE
USING (consultor_id = auth.uid())
WITH CHECK (consultor_id = auth.uid());

-- Consultor: deleta apenas suas cotações
CREATE POLICY cotacoes_consultor_delete ON public.cotacoes
FOR DELETE
USING (consultor_id = auth.uid());

-- Produtor: lê cotações das próprias fazendas
CREATE POLICY cotacoes_produtor_select ON public.cotacoes
FOR SELECT
USING (
  fazenda_id IN (
    SELECT f.id
    FROM public.fazendas f
    WHERE f.produtor_id = auth.uid()
  )
);

-- Público (viewer por token): leitura permitida quando houver token
CREATE POLICY cotacoes_public_token_select ON public.cotacoes
FOR SELECT
USING (approval_token IS NOT NULL);

-- Público (viewer por token): atualização de status de aprovação
CREATE POLICY cotacoes_public_token_update ON public.cotacoes
FOR UPDATE
USING (
  approval_token IS NOT NULL
  AND (approval_token_exp IS NULL OR approval_token_exp > now())
)
WITH CHECK (
  approval_token IS NOT NULL
  AND status IN ('aprovada', 'recusada')
);

COMMIT;

-- ============================================================
-- Verificação rápida (rode após o COMMIT)
-- ============================================================
-- SELECT policyname, cmd, permissive, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname='public' AND tablename='cotacoes'
-- ORDER BY policyname;
