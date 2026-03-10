-- ============================================================
-- AGROCOTA — RPC para admin obter e-mail do usuário
-- Permite ao admin (agrocota64@gmail.com) ver e-mail de qualquer usuário
-- Execute no SQL Editor do Supabase
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_get_user_email(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_original_email TEXT;
BEGIN
  IF NOT public.is_admin_user() THEN
    RETURN NULL;
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user_id;
  IF v_email IS NOT NULL AND v_email NOT LIKE '%@agrocota.deleted' THEN
    RETURN v_email;
  END IF;

  SELECT p.original_email INTO v_original_email FROM profiles p WHERE p.id = p_user_id;
  RETURN COALESCE(v_original_email, v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_email(UUID) TO authenticated;
