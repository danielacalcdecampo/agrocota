-- ============================================================
-- AGROCOTA — Correções dos erros do Database Linter (Supabase)
-- Execute no SQL Editor do Supabase
-- ============================================================

BEGIN;

-- 1) Views administrativas: evitar SECURITY DEFINER e exposição ao PostgREST
ALTER VIEW IF EXISTS public.admin_accounts SET (security_invoker = true);
ALTER VIEW IF EXISTS public.active_accounts SET (security_invoker = true);
ALTER VIEW IF EXISTS public.unconfirmed_accounts SET (security_invoker = true);
ALTER VIEW IF EXISTS public.deleted_accounts SET (security_invoker = true);

REVOKE ALL ON TABLE public.admin_accounts FROM anon, authenticated;
REVOKE ALL ON TABLE public.active_accounts FROM anon, authenticated;
REVOKE ALL ON TABLE public.unconfirmed_accounts FROM anon, authenticated;
REVOKE ALL ON TABLE public.deleted_accounts FROM anon, authenticated;

-- Opcional: garantir leitura apenas para service_role (backend/admin)
GRANT SELECT ON TABLE public.admin_accounts TO service_role;
GRANT SELECT ON TABLE public.active_accounts TO service_role;
GRANT SELECT ON TABLE public.unconfirmed_accounts TO service_role;
GRANT SELECT ON TABLE public.deleted_accounts TO service_role;

-- 2) Tabela pública sem RLS: habilitar RLS em cotacoes_links
ALTER TABLE IF EXISTS public.cotacoes_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cotacoes_links FORCE ROW LEVEL SECURITY;

-- Reforço de permissões: remover acesso direto de anon/authenticated
REVOKE ALL ON TABLE public.cotacoes_links FROM anon, authenticated;

-- 3) Funções com search_path mutável: fixar search_path
DO $$
BEGIN
	IF to_regprocedure('public.notificar_aceite_consultor(uuid)') IS NOT NULL THEN
		EXECUTE 'ALTER FUNCTION public.notificar_aceite_consultor(UUID) SET search_path = public';
	END IF;

	IF to_regprocedure('public.delete_own_account(text)') IS NOT NULL THEN
		EXECUTE 'ALTER FUNCTION public.delete_own_account(TEXT) SET search_path = public';
	END IF;

	IF to_regprocedure('public.update_updated_at()') IS NOT NULL THEN
		EXECUTE 'ALTER FUNCTION public.update_updated_at() SET search_path = public';
	END IF;

	IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
		EXECUTE 'ALTER FUNCTION public.handle_new_user() SET search_path = public';
	END IF;

	IF to_regprocedure('admin_safe.get_admin_accounts()') IS NOT NULL THEN
		EXECUTE 'ALTER FUNCTION admin_safe.get_admin_accounts() SET search_path = admin_safe, public';
	END IF;
END
$$;

COMMIT;

-- ============================================================
-- Verificação rápida (opcional)
-- ============================================================
-- SELECT schemaname, viewname, definition FROM pg_views
-- WHERE schemaname = 'public'
--   AND viewname IN ('admin_accounts','active_accounts','unconfirmed_accounts','deleted_accounts');
--
-- SELECT relname, relrowsecurity, relforcerowsecurity
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname = 'cotacoes_links';
