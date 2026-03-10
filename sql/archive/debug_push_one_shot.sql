-- ============================================================
-- AGROCOTA — PUSH ONE-SHOT (token + dispatch + resposta Expo)
-- Execute no SQL Editor do Supabase
-- ============================================================
-- COMO USAR:
-- 1) Opcional: troque o UUID abaixo (v_input_uuid)
-- 2) Se deixar o placeholder, usa automaticamente o consultor mais recente
-- 3) Execute o bloco inteiro
-- 4) Veja os resultados retornados em sequência

DO $$
DECLARE
  v_input_uuid TEXT := '00000000-0000-0000-0000-000000000000';
  v_consultor_id UUID;
BEGIN
  IF v_input_uuid = '00000000-0000-0000-0000-000000000000' THEN
    SELECT p.id
    INTO v_consultor_id
    FROM public.profiles p
    WHERE p.role = 'consultor'
    ORDER BY p.created_at DESC
    LIMIT 1;
  ELSE
    v_consultor_id := v_input_uuid::uuid;
  END IF;

  IF v_consultor_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum consultor encontrado. Informe um UUID real em v_input_uuid.';
  END IF;

  PERFORM set_config('app.current_consultor_id', v_consultor_id::text, true);

  -- dispara notificação de teste
  PERFORM public.testar_push_consultor(v_consultor_id, 'Teste push Agrocota (one-shot)');
END $$;

-- UUID efetivamente usado neste teste
SELECT
  'CONSULTOR_USADO' AS etapa,
  current_setting('app.current_consultor_id', true)::uuid AS consultor_id;

-- 1) Tokens do consultor
SELECT
  'TOKENS' AS etapa,
  id,
  user_id,
  platform,
  token,
  updated_at
FROM public.push_tokens
WHERE user_id = current_setting('app.current_consultor_id', true)::uuid
ORDER BY updated_at DESC;

-- 2) Últimos logs do dispatch
SELECT
  'DISPATCH_LOG' AS etapa,
  id,
  created_at,
  notificacao_id,
  consultor_id,
  token,
  request_id,
  status,
  details
FROM public.push_dispatch_logs
WHERE consultor_id = current_setting('app.current_consultor_id', true)::uuid
ORDER BY created_at DESC
LIMIT 20;

-- 3) Resposta HTTP do pg_net (Expo)
SELECT
  'HTTP_RESPONSE' AS etapa,
  r.id,
  r.status_code,
  r.content_type,
  r.content
FROM net._http_response r
WHERE r.id IN (
  SELECT request_id
  FROM public.push_dispatch_logs
  WHERE consultor_id = current_setting('app.current_consultor_id', true)::uuid
    AND request_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 20
)
ORDER BY r.id DESC;

-- 4) Última notificação gravada para o consultor
SELECT
  'NOTIFICACAO_DB' AS etapa,
  id,
  created_at,
  tipo,
  mensagem,
  lida_em
FROM public.consultor_notificacoes
WHERE consultor_id = current_setting('app.current_consultor_id', true)::uuid
ORDER BY created_at DESC
LIMIT 5;
