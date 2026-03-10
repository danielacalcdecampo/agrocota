-- ============================================================
-- AGROCOTA — Corrigir perfil: foto (company_logo_url) e CNPJ não salvam
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 1. CNPJ: character(1) impede salvar 14 dígitos (drop views que dependem da coluna)
DROP VIEW IF EXISTS admin_accounts CASCADE;
DROP VIEW IF EXISTS active_accounts CASCADE;
DROP VIEW IF EXISTS unconfirmed_accounts CASCADE;
DROP VIEW IF EXISTS deleted_accounts CASCADE;

ALTER TABLE profiles ALTER COLUMN cnpj TYPE VARCHAR(14) USING CASE WHEN cnpj IS NULL THEN NULL ELSE SUBSTRING(cnpj::text, 1, 14) END;

-- Recriar views
CREATE VIEW admin_accounts WITH (security_invoker = true) AS
SELECT p.id, COALESCE(p.original_email, u.email) AS email, p.full_name, p.company_name, p.cnpj, p.phone,
  p.company_logo_url, p.role,
  CASE WHEN p.status = 'deleted' THEN 'Excluída' WHEN u.email_confirmed_at IS NULL THEN 'Não confirmada' ELSE 'Ativa' END AS situacao,
  p.status, p.deleted_at, p.deleted_reason, p.original_email, u.email_confirmed_at, p.created_at
FROM profiles p LEFT JOIN auth.users u ON u.id = p.id
ORDER BY p.created_at DESC;

CREATE VIEW active_accounts WITH (security_invoker = true) AS
SELECT p.id, u.email, p.full_name, p.company_name, p.cnpj, p.phone, p.company_logo_url, u.email_confirmed_at, p.created_at
FROM profiles p LEFT JOIN auth.users u ON u.id = p.id
WHERE p.status = 'active' AND u.email_confirmed_at IS NOT NULL
ORDER BY p.created_at DESC;

CREATE VIEW unconfirmed_accounts WITH (security_invoker = true) AS
SELECT p.id, u.email, p.full_name, p.company_name, p.created_at
FROM profiles p LEFT JOIN auth.users u ON u.id = p.id
WHERE p.status = 'active' AND u.email_confirmed_at IS NULL
ORDER BY p.created_at DESC;

CREATE VIEW deleted_accounts WITH (security_invoker = true) AS
SELECT p.id, p.original_email AS email, p.full_name, p.company_name, p.cnpj, p.phone, p.deleted_at, p.deleted_reason, p.created_at
FROM profiles p WHERE p.status = 'deleted'
ORDER BY p.deleted_at DESC;

REVOKE ALL ON admin_accounts, active_accounts, unconfirmed_accounts, deleted_accounts FROM anon, authenticated;
GRANT SELECT ON admin_accounts, active_accounts, unconfirmed_accounts, deleted_accounts TO service_role;

-- 2. RLS: WITH CHECK permite que o usuário atualize todos os campos do próprio perfil
DROP POLICY IF EXISTS "Usuário atualiza próprio perfil" ON profiles;
CREATE POLICY "Usuário atualiza próprio perfil" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 3. Storage avatars: garantir que o upload em {user_id}/logo.jpg funcione
DROP POLICY IF EXISTS "Usuário faz upload no próprio diretório" ON storage.objects;
CREATE POLICY "Usuário faz upload no próprio diretório" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Usuário atualiza próprio arquivo" ON storage.objects;
CREATE POLICY "Usuário atualiza próprio arquivo" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
