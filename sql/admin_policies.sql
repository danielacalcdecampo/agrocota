-- ============================================================
-- AGROCOTA — POLÍTICAS RLS PARA ADMIN (agrocota64@gmail.com)
-- Permite ao administrador visualizar TODOS os dados da plataforma
-- Execute no SQL Editor do Supabase
-- ============================================================

-- Função auxiliar: retorna true se o usuário logado é o admin
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean AS $$
BEGIN
  RETURN (
    SELECT email = 'agrocota64@gmail.com'
    FROM auth.users
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- ============================================================
-- PROFILES — Admin vê todos os perfis
-- ============================================================
DROP POLICY IF EXISTS "Admin vê todos os perfis" ON profiles;
CREATE POLICY "Admin vê todos os perfis" ON profiles
  FOR SELECT USING (public.is_admin_user());

-- ============================================================
-- FAZENDAS — Admin vê todas as propriedades
-- ============================================================
DROP POLICY IF EXISTS "Admin vê todas as fazendas" ON fazendas;
CREATE POLICY "Admin vê todas as fazendas" ON fazendas
  FOR SELECT USING (public.is_admin_user());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='talhoes') THEN
    DROP POLICY IF EXISTS "Admin vê todos os talhoes" ON talhoes;
    CREATE POLICY "Admin vê todos os talhoes" ON talhoes
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

-- ============================================================
-- COTACOES — Admin vê todas as cotações
-- ============================================================
DROP POLICY IF EXISTS "Admin vê todas as cotacoes" ON cotacoes;
CREATE POLICY "Admin vê todas as cotacoes" ON cotacoes
  FOR SELECT USING (public.is_admin_user());

-- ============================================================
-- ITENS_COTACAO — Admin vê todos os itens
-- ============================================================
DROP POLICY IF EXISTS "Admin vê todos os itens_cotacao" ON itens_cotacao;
CREATE POLICY "Admin vê todos os itens_cotacao" ON itens_cotacao
  FOR SELECT USING (public.is_admin_user());

-- ============================================================
-- Tabelas opcionais: cria política apenas se a tabela existir
-- (evita erro 42P01 quando o schema não tem todas as tabelas)
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='propostas_fornecedor') THEN
    DROP POLICY IF EXISTS "Admin vê todas as propostas_fornecedor" ON propostas_fornecedor;
    CREATE POLICY "Admin vê todas as propostas_fornecedor" ON propostas_fornecedor
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='planos_safra') THEN
    DROP POLICY IF EXISTS "Admin vê todos os planos_safra" ON planos_safra;
    CREATE POLICY "Admin vê todos os planos_safra" ON planos_safra
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='plano_itens') THEN
    DROP POLICY IF EXISTS "Admin vê todos os plano_itens" ON plano_itens;
    CREATE POLICY "Admin vê todos os plano_itens" ON plano_itens
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sistema_plantio') THEN
    DROP POLICY IF EXISTS "Admin vê todos os sistema_plantio" ON sistema_plantio;
    CREATE POLICY "Admin vê todos os sistema_plantio" ON sistema_plantio
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='anotacoes') THEN
    DROP POLICY IF EXISTS "Admin vê todas as anotacoes" ON anotacoes;
    CREATE POLICY "Admin vê todas as anotacoes" ON anotacoes
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cotacao_aceites') THEN
    DROP POLICY IF EXISTS "Admin vê todos os cotacao_aceites" ON cotacao_aceites;
    CREATE POLICY "Admin vê todos os cotacao_aceites" ON cotacao_aceites
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='safras') THEN
    DROP POLICY IF EXISTS "Admin vê todas as safras" ON safras;
    CREATE POLICY "Admin vê todas as safras" ON safras
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='safra_dados_producao') THEN
    DROP POLICY IF EXISTS "Admin vê todos safra_dados_producao" ON safra_dados_producao;
    CREATE POLICY "Admin vê todos safra_dados_producao" ON safra_dados_producao
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gestao_custos_operacionais') THEN
    DROP POLICY IF EXISTS "Admin vê todos gestao_custos_operacionais" ON gestao_custos_operacionais;
    CREATE POLICY "Admin vê todos gestao_custos_operacionais" ON gestao_custos_operacionais
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='caderno_campo') THEN
    DROP POLICY IF EXISTS "Admin vê todos caderno_campo" ON caderno_campo;
    CREATE POLICY "Admin vê todos caderno_campo" ON caderno_campo
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='anotacao_blocos') THEN
    DROP POLICY IF EXISTS "Admin vê todos anotacao_blocos" ON anotacao_blocos;
    CREATE POLICY "Admin vê todos anotacao_blocos" ON anotacao_blocos
      FOR SELECT USING (public.is_admin_user());
  END IF;
END $$;
