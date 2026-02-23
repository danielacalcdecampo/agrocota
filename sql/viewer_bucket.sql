-- ============================================================
-- AGROCOTA — BUCKET PÚBLICO PARA VIEWER DE COTAÇÕES
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Cria o bucket público "Agrocota"
INSERT INTO storage.buckets (id, name, public)
VALUES ('Agrocota', 'Agrocota', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Política: qualquer um pode ler arquivos do bucket Agrocota
DROP POLICY IF EXISTS "viewers_public_read" ON storage.objects;
CREATE POLICY "viewers_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'Agrocota');

-- 3. Política: qualquer um pode fazer upload no bucket Agrocota
--    (bucket é público e de uso interno do dev CLI — sem restrição de auth)
DROP POLICY IF EXISTS "viewers_auth_insert" ON storage.objects;
CREATE POLICY "viewers_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'Agrocota');

-- 4. Política: qualquer um pode deletar arquivos do bucket Agrocota
--    (permite que o script de upload limpe a versão anterior)
DROP POLICY IF EXISTS "viewers_auth_delete" ON storage.objects;
CREATE POLICY "viewers_auth_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'Agrocota');

-- 5. Política: qualquer um pode atualizar (upsert) arquivos do bucket Agrocota
DROP POLICY IF EXISTS "viewers_auth_update" ON storage.objects;
CREATE POLICY "viewers_auth_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'Agrocota');

-- ============================================================
-- (OPCIONAL) Permitir leitura pública de profiles e fazendas
-- para exibir nome do consultor e dados da fazenda no viewer
-- ============================================================

-- Leitura pública de profiles (somente campos não sensíveis)
DROP POLICY IF EXISTS "profiles_public_read_name" ON profiles;
CREATE POLICY "profiles_public_read_name" ON profiles
  FOR SELECT USING (true);  -- anon pode ler (só exibe full_name)

-- Leitura pública de fazendas vinculadas a cotações com token
DROP POLICY IF EXISTS "fazendas_public_by_token" ON fazendas;
CREATE POLICY "fazendas_public_by_token" ON fazendas
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cotacoes c
      WHERE c.fazenda_id = fazendas.id
        AND c.approval_token IS NOT NULL
    )
  );
