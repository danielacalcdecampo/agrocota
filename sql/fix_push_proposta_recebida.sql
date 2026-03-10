-- ============================================================
-- AGROCOTA — Push nativo para "Proposta recebida"
-- Adiciona trigger na tabela notificacoes para enviar push quando
-- um fornecedor envia proposta (igual ao aceite/recusa).
-- Execute no SQL Editor do Supabase
-- ============================================================

-- Função que envia push quando INSERT em notificacoes (propostas de fornecedor)
CREATE OR REPLACE FUNCTION public.dispatch_push_from_notificacoes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_body JSONB;
  v_title TEXT := 'Proposta recebida';
  v_body_text TEXT;
BEGIN
  -- Requer pg_net para enviar HTTP
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RETURN NEW;
  END IF;

  v_body_text := COALESCE(NEW.mensagem, COALESCE(NEW.empresa_fornecedor, 'Fornecedor') || ' enviou uma proposta');

  FOR v_token IN
    SELECT pt.token
    FROM public.push_tokens pt
    WHERE pt.user_id = NEW.consultor_id
  LOOP
    BEGIN
      v_body := jsonb_build_object(
        'to', v_token,
        'title', v_title,
        'body', v_body_text,
        'sound', 'default',
        'priority', 'high',
        'channelId', 'agrocota-consultor',
        '_displayInForeground', true,
        'ttl', 3600,
        'data', jsonb_build_object(
          'tipo', COALESCE(NEW.tipo, 'proposta_fornecedor'),
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

DROP TRIGGER IF EXISTS trg_dispatch_push_on_notificacoes ON public.notificacoes;
CREATE TRIGGER trg_dispatch_push_on_notificacoes
AFTER INSERT ON public.notificacoes
FOR EACH ROW
EXECUTE FUNCTION public.dispatch_push_from_notificacoes();
