-- ============================================================
-- AGROCOTA — FIX RLS recursao infinita no viewer publico
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 0. Central de notificações do consultor
CREATE TABLE IF NOT EXISTS consultor_notificacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cotacao_id UUID REFERENCES cotacoes(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('aceite', 'recusa')),
  mensagem TEXT NOT NULL,
  titulo_cotacao TEXT,
  nome_fazenda TEXT,
  lida_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE consultor_notificacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consultor_notificacoes_read_own" ON consultor_notificacoes;
CREATE POLICY "consultor_notificacoes_read_own" ON consultor_notificacoes
  FOR SELECT USING (consultor_id = auth.uid());

DROP POLICY IF EXISTS "consultor_notificacoes_update_own" ON consultor_notificacoes;
CREATE POLICY "consultor_notificacoes_update_own" ON consultor_notificacoes
  FOR UPDATE USING (consultor_id = auth.uid())
  WITH CHECK (consultor_id = auth.uid());

-- 1. Funcao para buscar cotacao por token (bypassa RLS)
DROP FUNCTION IF EXISTS get_cotacao_by_token(TEXT);

CREATE OR REPLACE FUNCTION get_cotacao_by_token(p_token TEXT)
RETURNS TABLE (
  id              UUID,
  titulo          TEXT,
  status          TEXT,
  created_at      TIMESTAMPTZ,
  fazenda_id      UUID,
  consultor_id    UUID,
  talhao_id       UUID,
  talhao_nome     TEXT,
  talhao_area_ha  NUMERIC,
  area_ha         NUMERIC,
  approved_at     TIMESTAMPTZ,
  excel_itens_json JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.titulo,
    c.status,
    c.created_at,
    c.fazenda_id,
    c.consultor_id,
    c.talhao_id,
    t.nome AS talhao_nome,
    t.area_ha AS talhao_area_ha,
    c.area_ha,
    c.approved_at,
    c.excel_itens_json
  FROM cotacoes c
  LEFT JOIN talhoes t ON t.id = c.talhao_id
  WHERE c.approval_token = p_token
  LIMIT 1;
$$;

-- Permissao para anon chamar a funcao
GRANT EXECUTE ON FUNCTION get_cotacao_by_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_cotacao_by_token(TEXT) TO authenticated;


-- 2. Funcao para buscar itens por cotacao_id (bypassa RLS)
CREATE OR REPLACE FUNCTION get_itens_by_cotacao(p_cotacao_id UUID)
RETURNS TABLE (
  id            UUID,
  produto_nome  TEXT,
  fornecedor    TEXT,
  categoria     TEXT,
  valor_ha      NUMERIC,
  dose_ha       NUMERIC,
  unidade       TEXT,
  quantidade    NUMERIC,
  preco_unitario NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, produto_nome, fornecedor, categoria, valor_ha, dose_ha, unidade, quantidade, preco_unitario
  FROM itens_cotacao
  WHERE cotacao_id = p_cotacao_id
  ORDER BY categoria, produto_nome;
$$;

GRANT EXECUTE ON FUNCTION get_itens_by_cotacao(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_itens_by_cotacao(UUID) TO authenticated;


-- 3. Funcao para buscar fazenda por id (bypassa RLS)
CREATE OR REPLACE FUNCTION get_fazenda_by_id(p_id UUID)
RETURNS TABLE (
  nome               TEXT,
  area_total_ha      NUMERIC,
  cultura_principal  TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nome, area_total_ha, cultura_principal
  FROM fazendas
  WHERE id = p_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_fazenda_by_id(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_fazenda_by_id(UUID) TO authenticated;


-- 4. Funcao para buscar nome do consultor (bypassa RLS)
CREATE OR REPLACE FUNCTION get_profile_name(p_id UUID)
RETURNS TABLE (full_name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT full_name FROM profiles WHERE id = p_id LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_profile_name(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_profile_name(UUID) TO authenticated;


-- 4.1 Funcao para buscar itens aceitos por cotacao (bypassa RLS)
CREATE OR REPLACE FUNCTION get_aceites_by_cotacao(p_cotacao_id UUID)
RETURNS TABLE (
  item_id UUID,
  categoria TEXT,
  produto_nome TEXT,
  fornecedor TEXT,
  valor_ha NUMERIC,
  aceito_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'cotacao_aceites'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ca.item_id,
    ca.categoria,
    ca.produto_nome,
    ca.fornecedor,
    ca.valor_ha,
    ca.aceito_em
  FROM cotacao_aceites ca
  WHERE ca.cotacao_id = p_cotacao_id
  ORDER BY ca.categoria, ca.produto_nome;
END;
$$;

GRANT EXECUTE ON FUNCTION get_aceites_by_cotacao(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_aceites_by_cotacao(UUID) TO authenticated;


-- 5. Registrar aceite do produtor (bypassa RLS)
DROP FUNCTION IF EXISTS registrar_aceite_cotacao(UUID, UUID[], NUMERIC, TEXT);
DROP FUNCTION IF EXISTS registrar_aceite_cotacao(UUID, TEXT[], NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION registrar_aceite_cotacao(
  p_cotacao_id UUID,
  p_itens TEXT[],
  p_total_ha NUMERIC,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE (
  cotacao_id UUID,
  status TEXT,
  aceite_em TIMESTAMPTZ,
  total_ha NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_aceite_em TIMESTAMPTZ := now();
  v_total_ha NUMERIC := 0;
  v_consultor_id UUID;
  v_titulo_cotacao TEXT;
  v_nome_fazenda TEXT;
  v_nome_produtor TEXT;
  has_cotacao_aceites BOOLEAN := false;
  has_approved_at BOOLEAN := false;
  has_approved_by_type BOOLEAN := false;
BEGIN
  SELECT approval_token INTO v_token
  FROM cotacoes
  WHERE id = p_cotacao_id
  LIMIT 1;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Cotação inválida para aceite';
  END IF;

  SELECT c.consultor_id, c.titulo, f.nome, f.produtor_nome
  INTO v_consultor_id, v_titulo_cotacao, v_nome_fazenda, v_nome_produtor
  FROM cotacoes c
  LEFT JOIN fazendas f ON f.id = c.fazenda_id
  WHERE c.id = p_cotacao_id
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'cotacao_aceites'
  ) INTO has_cotacao_aceites;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cotacoes'
      AND column_name = 'approved_at'
  ) INTO has_approved_at;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cotacoes'
      AND column_name = 'approved_by_type'
  ) INTO has_approved_by_type;

  IF has_cotacao_aceites THEN
    DELETE FROM cotacao_aceites ca
    WHERE ca.cotacao_id = p_cotacao_id;

    INSERT INTO cotacao_aceites (
      cotacao_id,
      categoria,
      item_id,
      produto_nome,
      fornecedor,
      valor_ha,
      aceito_em
    )
    SELECT
      i.cotacao_id,
      COALESCE(i.categoria, 'Insumo') AS categoria,
      i.id AS item_id,
      i.produto_nome,
      i.fornecedor,
      i.valor_ha,
      v_aceite_em
    FROM itens_cotacao i
    WHERE i.cotacao_id = p_cotacao_id;
  END IF;

  SELECT COALESCE(SUM(COALESCE(i.valor_ha, 0)), 0)
  INTO v_total_ha
  FROM itens_cotacao i
  WHERE i.cotacao_id = p_cotacao_id;

  IF has_approved_at AND has_approved_by_type THEN
    UPDATE cotacoes
    SET
      status = 'aprovada',
      approved_at = v_aceite_em,
      approved_by_type = 'link'
    WHERE id = p_cotacao_id;
  ELSIF has_approved_at THEN
    UPDATE cotacoes
    SET
      status = 'aprovada',
      approved_at = v_aceite_em
    WHERE id = p_cotacao_id;
  ELSE
    UPDATE cotacoes
    SET status = 'aprovada'
    WHERE id = p_cotacao_id;
  END IF;

  IF v_consultor_id IS NOT NULL THEN
    INSERT INTO consultor_notificacoes (
      consultor_id,
      cotacao_id,
      tipo,
      mensagem,
      titulo_cotacao,
      nome_fazenda
    ) VALUES (
      v_consultor_id,
      p_cotacao_id,
      'aceite',
      format(
        'Aceite recebido: proprietário %s, %s, cotação "%s".',
        COALESCE(v_nome_produtor, 'não informado'),
        COALESCE(v_nome_fazenda, 'não informada'),
        COALESCE(v_titulo_cotacao, 'Sem título')
      ),
      v_titulo_cotacao,
      v_nome_fazenda
    );
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.status,
    CASE WHEN has_approved_at THEN c.approved_at ELSE v_aceite_em END,
    v_total_ha
  FROM cotacoes c
  WHERE c.id = p_cotacao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_aceite_cotacao(UUID, TEXT[], NUMERIC, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION registrar_aceite_cotacao(UUID, TEXT[], NUMERIC, TEXT) TO authenticated;


-- 6. Registrar recusa do produtor (bypassa RLS)
DROP FUNCTION IF EXISTS registrar_recusa_cotacao(UUID, TEXT);

CREATE OR REPLACE FUNCTION registrar_recusa_cotacao(
  p_cotacao_id UUID,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE (
  cotacao_id UUID,
  status TEXT,
  recusado_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_recusado_em TIMESTAMPTZ := now();
  v_consultor_id UUID;
  v_titulo_cotacao TEXT;
  v_nome_fazenda TEXT;
  has_approved_at BOOLEAN := false;
  has_approved_by_type BOOLEAN := false;
BEGIN
  SELECT approval_token INTO v_token
  FROM cotacoes
  WHERE id = p_cotacao_id
  LIMIT 1;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Cotação inválida para recusa';
  END IF;

  SELECT c.consultor_id, c.titulo, f.nome
  INTO v_consultor_id, v_titulo_cotacao, v_nome_fazenda
  FROM cotacoes c
  LEFT JOIN fazendas f ON f.id = c.fazenda_id
  WHERE c.id = p_cotacao_id
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cotacoes'
      AND column_name = 'approved_at'
  ) INTO has_approved_at;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cotacoes'
      AND column_name = 'approved_by_type'
  ) INTO has_approved_by_type;

  IF has_approved_at AND has_approved_by_type THEN
    UPDATE cotacoes
    SET
      status = 'recusada',
      approved_at = v_recusado_em,
      approved_by_type = 'link'
    WHERE id = p_cotacao_id;
  ELSIF has_approved_at THEN
    UPDATE cotacoes
    SET
      status = 'recusada',
      approved_at = v_recusado_em
    WHERE id = p_cotacao_id;
  ELSE
    UPDATE cotacoes
    SET status = 'recusada'
    WHERE id = p_cotacao_id;
  END IF;

  IF v_consultor_id IS NOT NULL THEN
    INSERT INTO consultor_notificacoes (
      consultor_id,
      cotacao_id,
      tipo,
      mensagem,
      titulo_cotacao,
      nome_fazenda
    ) VALUES (
      v_consultor_id,
      p_cotacao_id,
      'recusa',
      format(
        'Recusa recebida: proprietário, %s, cotação "%s".',
        COALESCE(v_nome_fazenda, 'não informada'),
        COALESCE(v_titulo_cotacao, 'Sem título')
      ),
      v_titulo_cotacao,
      v_nome_fazenda
    );
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.status,
    CASE WHEN has_approved_at THEN c.approved_at ELSE v_recusado_em END
  FROM cotacoes c
  WHERE c.id = p_cotacao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_recusa_cotacao(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION registrar_recusa_cotacao(UUID, TEXT) TO authenticated;


-- 7. Push nativo (Expo): dispara envio ao criar notificação do consultor
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_tokens_self" ON public.push_tokens;
CREATE POLICY "push_tokens_self" ON public.push_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.dispatch_consultor_push_from_notificacao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_body JSONB;
BEGIN
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_token IN
    SELECT pt.token
    FROM public.push_tokens pt
    WHERE pt.user_id = NEW.consultor_id
  LOOP
    BEGIN
      v_body := jsonb_build_object(
        'to', v_token,
        'title', 'Agrocota',
        'body', COALESCE(NEW.mensagem, 'Nova atualização de cotação.'),
        'sound', 'default',
        'priority', 'high',
        'channelId', 'agrocota-consultor',
        '_displayInForeground', true,
        'ttl', 3600,
        'data', jsonb_build_object(
          'tipo', NEW.tipo,
          'cotacao_id', NEW.cotacao_id,
          'notificacao_id', NEW.id
        )
      );

      PERFORM net.http_post(
        'https://exp.host/--/api/v2/push/send',
        v_body,
        '{}'::jsonb,
        '{"Content-Type":"application/json"}'::jsonb,
        5000
      );
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_consultor_push_on_notificacao ON public.consultor_notificacoes;
CREATE TRIGGER trg_dispatch_consultor_push_on_notificacao
AFTER INSERT ON public.consultor_notificacoes
FOR EACH ROW
EXECUTE FUNCTION public.dispatch_consultor_push_from_notificacao();

-- ── Polling de status para o comparativo-viewer (acesso anônimo) ────────────
-- Retorna apenas status, proposta_aceita_id e approved_at de uma cotação.
-- Usado pelo comparativo-viewer.html para detectar mudanças (aceite/desfazer)
-- sem expor todos os dados da cotação via REST.
DROP FUNCTION IF EXISTS get_cotacao_status_public(UUID);

CREATE OR REPLACE FUNCTION get_cotacao_status_public(p_cotacao_id UUID)
RETURNS TABLE(
  status             TEXT,
  proposta_aceita_id UUID,
  approved_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.status::TEXT,
    c.proposta_aceita_id,
    c.approved_at
  FROM cotacoes c
  WHERE c.id = p_cotacao_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_cotacao_status_public(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_cotacao_status_public(UUID) TO authenticated;
