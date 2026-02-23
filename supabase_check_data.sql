-- ============================================================
-- AGROCOTA - SQL COMPLETO PARA RODAR NO SUPABASE
-- Supabase > SQL Editor > New query > Cole tudo > Run
-- ============================================================

-- PASSO 1: ADICIONAR COLUNAS (seguro rodar mais de uma vez)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status         TEXT DEFAULT 'active';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_reason TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS original_email TEXT;
UPDATE profiles SET status = 'active' WHERE status IS NULL;

-- PASSO 2: FUNCAO DE EXCLUSAO
-- Libera o e-mail para novo cadastro. Dados ficam salvos para o admin.
CREATE OR REPLACE FUNCTION delete_own_account(reason TEXT DEFAULT NULL)
RETURNS void AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  UPDATE public.profiles
  SET status='deleted', deleted_at=now(), deleted_reason=reason, original_email=v_email
  WHERE id = v_uid;
  UPDATE auth.users
  SET email='excluido_' || v_uid::text || '@agrocota.deleted', email_confirmed_at=NULL, updated_at=now()
  WHERE id = v_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PASSO 3: VIEWS PERMANENTES (Supabase Studio > Table Editor > Views)

-- Remove views antigas para evitar conflito de tipos de coluna
DROP VIEW IF EXISTS admin_accounts;
DROP VIEW IF EXISTS active_accounts;
DROP VIEW IF EXISTS unconfirmed_accounts;
DROP VIEW IF EXISTS deleted_accounts;

-- TODAS as contas: ativas, nao confirmadas e excluidas
CREATE VIEW admin_accounts AS
SELECT
  p.id,
  COALESCE(p.original_email, u.email) AS email,
  p.full_name AS nome_completo,
  p.company_name AS empresa,
  p.cnpj,
  p.phone AS telefone,
  p.company_logo_url AS foto_url,
  p.role AS tipo,
  CASE
    WHEN p.status = 'deleted'        THEN 'Excluida'
    WHEN u.email_confirmed_at IS NULL THEN 'Nao confirmada'
    ELSE 'Ativa'
  END AS situacao,
  p.deleted_at AS excluida_em,
  p.deleted_reason AS motivo_exclusao,
  u.email_confirmed_at AS confirmada_em,
  p.created_at AS cadastrado_em
FROM profiles p
LEFT JOIN auth.users u ON u.id = p.id
ORDER BY p.created_at DESC;

-- Somente ATIVAS (e-mail confirmado)
CREATE VIEW active_accounts AS
SELECT p.id, u.email, p.full_name AS nome, p.company_name AS empresa,
  p.cnpj, p.phone AS telefone, p.company_logo_url AS foto_url,
  u.email_confirmed_at AS confirmada_em, p.created_at AS cadastrado_em
FROM profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.status = 'active' AND u.email_confirmed_at IS NOT NULL
ORDER BY p.created_at DESC;

-- Somente NAO CONFIRMADAS
CREATE VIEW unconfirmed_accounts AS
SELECT p.id, u.email, p.full_name AS nome, p.company_name AS empresa, p.created_at AS cadastrado_em
FROM profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.status = 'active' AND u.email_confirmed_at IS NULL
ORDER BY p.created_at DESC;

-- Somente EXCLUIDAS (e-mail original salvo, liberado para novo cadastro)
CREATE VIEW deleted_accounts AS
SELECT p.id, p.original_email AS email, p.full_name AS nome, p.company_name AS empresa,
  p.cnpj, p.phone AS telefone, p.deleted_at AS excluida_em, p.deleted_reason AS motivo, p.created_at AS cadastrado_em
FROM profiles p WHERE p.status = 'deleted'
ORDER BY p.deleted_at DESC;

-- PASSO 4: CONSULTAS DE VERIFICACAO

-- Ver TUDO (ativas + nao confirmadas + excluidas)
SELECT * FROM admin_accounts;

-- Ver so ativas
SELECT * FROM active_accounts;

-- Ver so nao confirmadas
SELECT * FROM unconfirmed_accounts;

-- Ver so excluidas
SELECT * FROM deleted_accounts;

-- Contagem por situacao
SELECT
  CASE WHEN p.status='deleted' THEN 'Excluidas'
       WHEN u.email_confirmed_at IS NULL THEN 'Nao confirmadas'
       ELSE 'Ativas' END AS situacao,
  COUNT(*) AS total
FROM profiles p LEFT JOIN auth.users u ON u.id = p.id
GROUP BY 1 ORDER BY 1;
