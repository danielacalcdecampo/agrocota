-- ============================================================
-- AGROCOTA — FIX PERFIL/Fazenda "sumiu"
-- Execute no SQL Editor do Supabase
-- ============================================================

BEGIN;

-- 1) Backfill: cria profiles para usuários auth antigos que ainda não têm linha em public.profiles
INSERT INTO public.profiles (id, full_name, status)
SELECT
  u.id,
  COALESCE(NULLIF(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)),
  'active'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- 2) Garante trigger de criação automática de profile para novos usuários
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3) RLS de profiles (separado por operação, com WITH CHECK explícito)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuário lê próprio perfil" ON public.profiles;
CREATE POLICY "Usuário lê próprio perfil" ON public.profiles
FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Usuário insere próprio perfil" ON public.profiles;
CREATE POLICY "Usuário insere próprio perfil" ON public.profiles
FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Usuário atualiza próprio perfil" ON public.profiles;
CREATE POLICY "Usuário atualiza próprio perfil" ON public.profiles
FOR UPDATE USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Consultor vê perfis de seus produtores" ON public.profiles;
CREATE POLICY "Consultor vê perfis de seus produtores" ON public.profiles
FOR SELECT USING (
  id IN (SELECT produtor_id FROM public.fazendas WHERE consultor_id = auth.uid())
);

-- 4) RLS de fazendas (separado por operação para não perder registro por política)
ALTER TABLE public.fazendas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultor vê suas fazendas" ON public.fazendas;
DROP POLICY IF EXISTS "Produtor vê suas fazendas" ON public.fazendas;

DROP POLICY IF EXISTS "Consultor seleciona fazendas" ON public.fazendas;
CREATE POLICY "Consultor seleciona fazendas" ON public.fazendas
FOR SELECT USING (auth.uid() = consultor_id);

DROP POLICY IF EXISTS "Consultor insere fazendas" ON public.fazendas;
CREATE POLICY "Consultor insere fazendas" ON public.fazendas
FOR INSERT WITH CHECK (auth.uid() = consultor_id);

DROP POLICY IF EXISTS "Consultor atualiza fazendas" ON public.fazendas;
CREATE POLICY "Consultor atualiza fazendas" ON public.fazendas
FOR UPDATE USING (auth.uid() = consultor_id)
WITH CHECK (auth.uid() = consultor_id);

DROP POLICY IF EXISTS "Consultor deleta fazendas" ON public.fazendas;
CREATE POLICY "Consultor deleta fazendas" ON public.fazendas
FOR DELETE USING (auth.uid() = consultor_id);

DROP POLICY IF EXISTS "Produtor seleciona fazendas" ON public.fazendas;
CREATE POLICY "Produtor seleciona fazendas" ON public.fazendas
FOR SELECT USING (auth.uid() = produtor_id);

COMMIT;

-- ============================================================
-- VERIFICAÇÃO (rode após o COMMIT)
-- ============================================================
-- SELECT COUNT(*) AS total_auth_users FROM auth.users;
-- SELECT COUNT(*) AS total_profiles FROM public.profiles;
--
-- -- Verifique se o seu usuário existe em profiles
-- -- Troque pelo seu UUID real:
-- -- SELECT * FROM public.profiles WHERE id = 'SEU_USER_ID';
--
-- -- Últimas fazendas cadastradas e seus donos
-- SELECT id, nome, consultor_id, produtor_id, created_at
-- FROM public.fazendas
-- ORDER BY created_at DESC
-- LIMIT 20;
