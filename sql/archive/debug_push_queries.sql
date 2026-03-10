-- ============================================================
-- AGROCOTA — QUERIES de diagnóstico Push Nativo
-- ============================================================

-- 0) Descobrir o UUID do consultor
-- Opção A: pelo e-mail do consultor
-- SELECT id, full_name, role, created_at
-- FROM public.profiles
-- WHERE role = 'consultor' AND email = 'EMAIL_DO_CONSULTOR'
-- LIMIT 1;

-- Opção B: último consultor criado
-- SELECT id, full_name, role, created_at
-- FROM public.profiles
-- WHERE role = 'consultor'
-- ORDER BY created_at DESC
-- LIMIT 5;

-- 1) Ver tokens cadastrados (troque pelo UUID real)
-- SELECT id, user_id, token, platform, created_at, updated_at
-- FROM public.push_tokens
-- WHERE user_id = '00000000-0000-0000-0000-000000000000'
-- ORDER BY updated_at DESC;

-- 2) Disparar push de teste para o consultor (retorna quantidade de tokens)
-- SELECT public.testar_push_consultor('00000000-0000-0000-0000-000000000000', 'Teste de push nativo Agrocota');

-- 2.1) Variante sem colar UUID manual (usa o consultor mais recente)
-- WITH consultor_alvo AS (
--   SELECT id
--   FROM public.profiles
--   WHERE role = 'consultor'
--   ORDER BY created_at DESC
--   LIMIT 1
-- )
-- SELECT public.testar_push_consultor((SELECT id FROM consultor_alvo), 'Teste de push nativo Agrocota');

-- 3) Ver logs do dispatch
-- SELECT id, created_at, notificacao_id, consultor_id, token, request_id, status, details
-- FROM public.push_dispatch_logs
-- WHERE consultor_id = '00000000-0000-0000-0000-000000000000'
-- ORDER BY created_at DESC
-- LIMIT 50;

-- 4) (Opcional) Respostas HTTP do pg_net para request_ids recentes
-- SELECT id, status_code, content_type, content
-- FROM net._http_response
-- WHERE id IN (
--   SELECT request_id
--   FROM public.push_dispatch_logs
--   WHERE request_id IS NOT NULL
--   ORDER BY created_at DESC
--   LIMIT 20
-- )
-- ORDER BY id DESC;
