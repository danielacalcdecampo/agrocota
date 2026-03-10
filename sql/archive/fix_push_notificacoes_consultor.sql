-- ============================================================
-- AGROCOTA — Push de sistema para consultor (Expo)
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 1) Garante tabela de tokens
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

-- Log técnico para auditoria do envio de push
CREATE TABLE IF NOT EXISTS public.push_dispatch_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacao_id UUID,
  consultor_id UUID,
  token TEXT,
  request_id BIGINT,
  status TEXT,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_dispatch_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_dispatch_logs_consultor_read" ON public.push_dispatch_logs;
CREATE POLICY "push_dispatch_logs_consultor_read" ON public.push_dispatch_logs
  FOR SELECT USING (consultor_id = auth.uid());

-- 2) Trigger function para enviar push via Expo quando entrar notificação
CREATE OR REPLACE FUNCTION public.dispatch_consultor_push_from_notificacao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_request_id BIGINT;
  v_body JSONB;
BEGIN
  -- Se tabela de tokens não existir, encerra silenciosamente
  IF to_regclass('public.push_tokens') IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_token IN
    SELECT pt.token
    FROM public.push_tokens pt
    WHERE pt.user_id = NEW.consultor_id
  LOOP
    BEGIN
      v_token := btrim(v_token);

      IF v_token IS NULL OR v_token = '' THEN
        INSERT INTO public.push_dispatch_logs (notificacao_id, consultor_id, token, status, details)
        VALUES (NEW.id, NEW.consultor_id, v_token, 'skip', 'token vazio');
        CONTINUE;
      END IF;

      IF v_token NOT LIKE 'ExpoPushToken[%]' AND v_token NOT LIKE 'ExponentPushToken[%]' THEN
        INSERT INTO public.push_dispatch_logs (notificacao_id, consultor_id, token, status, details)
        VALUES (NEW.id, NEW.consultor_id, v_token, 'skip', 'token fora do padrão Expo');
        CONTINUE;
      END IF;

      v_body := jsonb_build_object(
        'to', v_token,
        'title', 'Agrocota',
        'body', COALESCE(NEW.mensagem, 'Nova atualização de cotação.'),
        'sound', 'default',
        'priority', 'high',
        'channelId', 'agrocota-consultor',
        'data', jsonb_build_object(
          'tipo', NEW.tipo,
          'cotacao_id', NEW.cotacao_id,
          'notificacao_id', NEW.id
        )
      );

      SELECT net.http_post(
        'https://exp.host/--/api/v2/push/send',
        v_body,
        '{}'::jsonb,
        '{"Content-Type":"application/json"}'::jsonb,
        5000
      ) INTO v_request_id;

      INSERT INTO public.push_dispatch_logs (notificacao_id, consultor_id, token, request_id, status, details)
      VALUES (NEW.id, NEW.consultor_id, v_token, v_request_id, 'queued', 'requisição enviada ao pg_net');
    EXCEPTION WHEN OTHERS THEN
      -- Não quebra o fluxo principal caso o push falhe
      INSERT INTO public.push_dispatch_logs (notificacao_id, consultor_id, token, status, details)
      VALUES (NEW.id, NEW.consultor_id, v_token, 'error', SQLERRM);
      CONTINUE;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Função de teste manual de push (para debug rápido)
CREATE OR REPLACE FUNCTION public.testar_push_consultor(
  p_consultor_id UUID,
  p_mensagem TEXT DEFAULT 'Teste de push Agrocota'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO public.consultor_notificacoes (
    consultor_id,
    tipo,
    mensagem,
    titulo_cotacao,
    nome_fazenda
  ) VALUES (
    p_consultor_id,
    'aceite',
    p_mensagem,
    'Teste de Push',
    'Sistema'
  );

  SELECT COUNT(*)
  INTO v_count
  FROM public.push_tokens
  WHERE user_id = p_consultor_id;

  RETURN v_count;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_consultor_push_on_notificacao ON public.consultor_notificacoes;
CREATE TRIGGER trg_dispatch_consultor_push_on_notificacao
AFTER INSERT ON public.consultor_notificacoes
FOR EACH ROW
EXECUTE FUNCTION public.dispatch_consultor_push_from_notificacao();
