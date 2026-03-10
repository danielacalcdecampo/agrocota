-- ============================================================
-- AGROCOTA — Corrige RLS de push_tokens
-- O upsert direto falha quando o token já existe de outra conta.
-- Esta RPC faz o upsert com SECURITY DEFINER (bypassa RLS).
-- Execute no SQL Editor do Supabase
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_push_token(p_token TEXT, p_platform TEXT DEFAULT 'android')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.push_tokens (user_id, token, platform, updated_at)
  VALUES (auth.uid(), p_token, p_platform, now())
  ON CONFLICT (token) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    updated_at = EXCLUDED.updated_at;
END;
$$;

-- Permite authenticated chamar a função
GRANT EXECUTE ON FUNCTION public.save_push_token(TEXT, TEXT) TO authenticated;
