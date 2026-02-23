-- ============================================================
-- AGROCOTA — SCHEMA COMPLETO
-- Execute tudo no SQL Editor do Supabase de uma vez
-- ============================================================

-- ============================================================
-- 1. BUCKET DE IMAGENS (logos das empresas)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. TABELA: profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id               UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  role             TEXT CHECK (role IN ('consultor', 'produtor')),
  full_name        TEXT,
  phone            TEXT,
  avatar_url       TEXT,
  company_name     TEXT,
  cnpj             CHAR(14),          -- somente dígitos, sem máscara
  company_logo_url TEXT,              -- URL no Storage (bucket avatars)
  created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Garante ON DELETE CASCADE na FK existente (para tabelas já criadas sem cascade)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Colunas adicionadas posteriormente (seguro rodar mesmo se já existirem)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company_name     TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cnpj             CHAR(14);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company_logo_url TEXT;

-- Controle de exclusão de contas
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status           TEXT DEFAULT 'active' CHECK (status IN ('active', 'deleted'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_reason   TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS original_email   TEXT; -- e-mail guardado antes da exclusão

-- ============================================================
-- 3. TABELA: fazendas
-- ============================================================
CREATE TABLE IF NOT EXISTS fazendas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produtor_id      UUID REFERENCES profiles(id),
  consultor_id     UUID REFERENCES profiles(id),
  nome             TEXT NOT NULL,
  municipio        TEXT,
  estado           CHAR(2),
  area_total_ha    NUMERIC(10,2),
  cultura_principal TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE fazendas ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. TABELA: cotacoes
-- ============================================================
CREATE TABLE IF NOT EXISTS cotacoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultor_id        UUID REFERENCES profiles(id),
  fazenda_id          UUID REFERENCES fazendas(id),
  titulo              TEXT NOT NULL,
  tipo                TEXT CHECK (tipo IN ('individual', 'safra')),
  status              TEXT DEFAULT 'rascunho',  -- rascunho | enviada | aprovada | recusada
  data_validade       DATE,
  observacoes         TEXT,
  pdf_url             TEXT,
  -- Campos de aprovação via link (sem login)
  approval_token      TEXT UNIQUE,
  approval_token_exp  TIMESTAMPTZ,
  approved_by_type    TEXT CHECK (approved_by_type IN ('app', 'link', 'whatsapp')),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cotacoes ENABLE ROW LEVEL SECURITY;

-- Colunas adicionadas posteriormente (seguro rodar mesmo se já existirem)
ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS approval_token      TEXT UNIQUE;
ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS approval_token_exp  TIMESTAMPTZ;
ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS approved_by_type    TEXT CHECK (approved_by_type IN ('app', 'link', 'whatsapp'));
ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMPTZ;
ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT now();

-- ============================================================
-- 5. TABELA: itens_cotacao
-- ============================================================
CREATE TABLE IF NOT EXISTS itens_cotacao (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotacao_id          UUID REFERENCES cotacoes(id) ON DELETE CASCADE,
  produto_nome        TEXT NOT NULL,
  fornecedor          TEXT,
  unidade             TEXT,                       -- L, kg, sc, un
  quantidade          NUMERIC(10,3) NOT NULL,
  preco_unitario      NUMERIC(12,2) NOT NULL,
  preco_referencia    NUMERIC(12,2),
  desconto_pct        NUMERIC(5,2) DEFAULT 0,
  total               NUMERIC(14,2) GENERATED ALWAYS AS
                        (quantidade * preco_unitario * (1 - (desconto_pct / 100))) STORED,
  -- Campos da planilha agronômica
  categoria           TEXT,  -- livre: qualquer categoria da planilha
  opcao_num           INTEGER,                    -- grupo de escolha: 1, 2, 3...
  estagio             TEXT,                       -- 'V3', 'Pré Pendão', 'V3,V8'
  n_aplicacoes        INTEGER,
  dose_ha             NUMERIC(10,3),
  volume_total        NUMERIC(10,2),
  valor_ha            NUMERIC(12,2),              -- usado para ordenação no PDF
  escolhido_produtor  BOOLEAN DEFAULT false,      -- produtor marcou esta opção
  obs                 TEXT
);
ALTER TABLE itens_cotacao ENABLE ROW LEVEL SECURITY;

-- Colunas adicionadas posteriormente (seguro rodar mesmo se já existirem)
ALTER TABLE itens_cotacao ADD COLUMN IF NOT EXISTS categoria          TEXT; -- livre: sem CHECK
ALTER TABLE itens_cotacao ADD COLUMN IF NOT EXISTS opcao_num          INTEGER;
ALTER TABLE itens_cotacao ADD COLUMN IF NOT EXISTS estagio            TEXT;
ALTER TABLE itens_cotacao ADD COLUMN IF NOT EXISTS n_aplicacoes       INTEGER;
ALTER TABLE itens_cotacao ADD COLUMN IF NOT EXISTS dose_ha            NUMERIC(10,3);
ALTER TABLE itens_cotacao ADD COLUMN IF NOT EXISTS volume_total       NUMERIC(10,2);
ALTER TABLE itens_cotacao ADD COLUMN IF NOT EXISTS valor_ha           NUMERIC(12,2);
ALTER TABLE itens_cotacao ADD COLUMN IF NOT EXISTS escolhido_produtor BOOLEAN DEFAULT false;
ALTER TABLE itens_cotacao ADD COLUMN IF NOT EXISTS obs                TEXT;

-- ============================================================
-- 6. TABELA: caderno_campo (exportações / histórico de PDFs)
-- ============================================================
CREATE TABLE IF NOT EXISTS caderno_campo (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotacao_id       UUID REFERENCES cotacoes(id),
  fazenda_id       UUID REFERENCES fazendas(id),
  pdf_url          TEXT,
  status           TEXT DEFAULT 'pendente',  -- pendente | processando | pronto | erro
  anotacoes_manejo TEXT,
  gerado_em        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE caderno_campo ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. POLÍTICAS RLS — storage (bucket avatars)
-- ============================================================
-- Permite que usuários autenticados façam upload dos próprios arquivos
DROP POLICY IF EXISTS "Usuário faz upload no próprio diretório" ON storage.objects;
CREATE POLICY "Usuário faz upload no próprio diretório" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Permite atualizar (upsert) arquivos existentes
DROP POLICY IF EXISTS "Usuário atualiza próprio arquivo" ON storage.objects;
CREATE POLICY "Usuário atualiza próprio arquivo" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Permite leitura pública (bucket já é público, mas a policy garante o acesso)
DROP POLICY IF EXISTS "Leitura pública dos avatars" ON storage.objects;
CREATE POLICY "Leitura pública dos avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- ============================================================
-- 8. POLÍTICAS RLS — profiles
-- ============================================================
DROP POLICY IF EXISTS "Usuário insere próprio perfil" ON profiles;
CREATE POLICY "Usuário insere próprio perfil" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Usuário lê próprio perfil" ON profiles;
CREATE POLICY "Usuário lê próprio perfil" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Usuário atualiza próprio perfil" ON profiles;
CREATE POLICY "Usuário atualiza próprio perfil" ON profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Consultor vê perfis de seus produtores" ON profiles;
CREATE POLICY "Consultor vê perfis de seus produtores" ON profiles
  FOR SELECT USING (
    id IN (SELECT produtor_id FROM fazendas WHERE consultor_id = auth.uid())
  );

-- ============================================================
-- 8. POLÍTICAS RLS — fazendas
-- ============================================================
DROP POLICY IF EXISTS "Consultor vê suas fazendas" ON fazendas;
CREATE POLICY "Consultor vê suas fazendas" ON fazendas
  FOR ALL USING (auth.uid() = consultor_id);

DROP POLICY IF EXISTS "Produtor vê suas fazendas" ON fazendas;
CREATE POLICY "Produtor vê suas fazendas" ON fazendas
  FOR SELECT USING (auth.uid() = produtor_id);

-- ============================================================
-- 9. POLÍTICAS RLS — cotacoes
-- ============================================================
DROP POLICY IF EXISTS "Consultor gerencia suas cotações" ON cotacoes;
CREATE POLICY "Consultor gerencia suas cotações" ON cotacoes
  FOR ALL USING (auth.uid() = consultor_id);

DROP POLICY IF EXISTS "Produtor visualiza cotações da sua fazenda" ON cotacoes;
CREATE POLICY "Produtor visualiza cotações da sua fazenda" ON cotacoes
  FOR SELECT USING (
    fazenda_id IN (SELECT id FROM fazendas WHERE produtor_id = auth.uid())
  );

-- ============================================================
-- 10. POLÍTICAS RLS — itens_cotacao
-- ============================================================
DROP POLICY IF EXISTS "Consultor gerencia itens de suas cotações" ON itens_cotacao;
CREATE POLICY "Consultor gerencia itens de suas cotações" ON itens_cotacao
  FOR ALL USING (
    cotacao_id IN (SELECT id FROM cotacoes WHERE consultor_id = auth.uid())
  );

DROP POLICY IF EXISTS "Produtor visualiza itens das cotações da sua fazenda" ON itens_cotacao;
CREATE POLICY "Produtor visualiza itens das cotações da sua fazenda" ON itens_cotacao
  FOR SELECT USING (
    cotacao_id IN (
      SELECT id FROM cotacoes
      WHERE fazenda_id IN (SELECT id FROM fazendas WHERE produtor_id = auth.uid())
    )
  );

-- Aprovação pública via token (sem login): permite UPDATE do status pelo link
DROP POLICY IF EXISTS "Aprovação pública via token" ON cotacoes;
CREATE POLICY "Aprovação pública via token" ON cotacoes
  FOR UPDATE USING (
    approval_token IS NOT NULL
    AND approval_token_exp > now()
  )
  WITH CHECK (status IN ('aprovada', 'recusada'));

DROP POLICY IF EXISTS "Aprovação pública atualiza itens" ON itens_cotacao;
CREATE POLICY "Aprovação pública atualiza itens" ON itens_cotacao
  FOR UPDATE USING (
    cotacao_id IN (
      SELECT id FROM cotacoes
      WHERE approval_token IS NOT NULL AND approval_token_exp > now()
    )
  );

-- ============================================================
-- 11. POLÍTICAS RLS — caderno_campo
-- ============================================================
DROP POLICY IF EXISTS "Consultor gerencia caderno de campo" ON caderno_campo;
CREATE POLICY "Consultor gerencia caderno de campo" ON caderno_campo
  FOR ALL USING (
    fazenda_id IN (SELECT id FROM fazendas WHERE consultor_id = auth.uid())
  );

DROP POLICY IF EXISTS "Produtor visualiza caderno da sua fazenda" ON caderno_campo;
CREATE POLICY "Produtor visualiza caderno da sua fazenda" ON caderno_campo
  FOR SELECT USING (
    fazenda_id IN (SELECT id FROM fazendas WHERE produtor_id = auth.uid())
  );

-- ============================================================
-- 12. TRIGGER: atualiza updated_at automaticamente em cotacoes
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cotacoes_updated_at ON cotacoes;
CREATE TRIGGER cotacoes_updated_at
  BEFORE UPDATE ON cotacoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 13. TRIGGER: cria linha em profiles ao cadastrar novo usuário
--     Roda como SECURITY DEFINER (bypassa RLS), garante que o
--     perfil exista antes do app tentar fazer upsert.
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 14. CONTROLE DE CONTAS EXCLUÍDAS
--     View para o admin visualizar contas ativas e deletadas
-- ============================================================

-- View: todas as contas (ativas, excluídas e não confirmadas)
DROP VIEW IF EXISTS admin_accounts;
CREATE VIEW admin_accounts AS
SELECT
  p.id,
  COALESCE(p.original_email, u.email) AS email,
  p.full_name,
  p.company_name,
  p.cnpj,
  p.phone,
  p.company_logo_url,
  p.role,
  CASE
    WHEN p.status = 'deleted'         THEN 'Excluída'
    WHEN u.email_confirmed_at IS NULL  THEN 'Não confirmada'
    ELSE 'Ativa'
  END AS situacao,
  p.status,
  p.deleted_at,
  p.deleted_reason,
  p.original_email,
  u.email_confirmed_at,
  p.created_at
FROM profiles p
LEFT JOIN auth.users u ON u.id = p.id
ORDER BY p.created_at DESC;

-- View: somente contas ativas (e-mail confirmado)
DROP VIEW IF EXISTS active_accounts;
CREATE VIEW active_accounts AS
SELECT
  p.id,
  u.email,
  p.full_name,
  p.company_name,
  p.cnpj,
  p.phone,
  p.company_logo_url,
  u.email_confirmed_at,
  p.created_at
FROM profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.status = 'active'
  AND u.email_confirmed_at IS NOT NULL
ORDER BY p.created_at DESC;

-- View: cadastradas mas e-mail ainda não confirmado
DROP VIEW IF EXISTS unconfirmed_accounts;
CREATE VIEW unconfirmed_accounts AS
SELECT
  p.id,
  u.email,
  p.full_name,
  p.company_name,
  p.created_at
FROM profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.status = 'active'
  AND u.email_confirmed_at IS NULL
ORDER BY p.created_at DESC;

-- View: somente contas excluídas (e-mail original preservado)
DROP VIEW IF EXISTS deleted_accounts;
CREATE VIEW deleted_accounts AS
SELECT
  p.id,
  p.original_email   AS email,
  p.full_name,
  p.company_name,
  p.cnpj,
  p.phone,
  p.deleted_at,
  p.deleted_reason,
  p.created_at
FROM profiles p
WHERE p.status = 'deleted'
ORDER BY p.deleted_at DESC;

-- Função para excluir conta (chamada pelo app via RPC)
-- 1. Salva o e-mail original no perfil
-- 2. Libera o e-mail em auth.users (troca por endereço único inativo)
--    → o usuário pode se recadastrar com o mesmo e-mail
-- 3. Marca o perfil como excluído (dados do perfil ficam para histórico admin)
CREATE OR REPLACE FUNCTION delete_own_account(reason TEXT DEFAULT NULL)
RETURNS void AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
BEGIN
  -- Busca o e-mail atual antes de liberar
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Salva o e-mail original e marca como excluído
  UPDATE public.profiles
  SET
    status         = 'deleted',
    deleted_at     = now(),
    deleted_reason = reason,
    original_email = v_email
  WHERE id = v_uid;

  -- Libera o e-mail original em auth.users trocando por um endereço inativo único
  -- Isso permite que o usuário se recadastre com o mesmo e-mail
  UPDATE auth.users
  SET
    email               = 'excluido_' || v_uid::text || '@agrocota.deleted',
    email_confirmed_at  = NULL,
    updated_at          = now()
  WHERE id = v_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
