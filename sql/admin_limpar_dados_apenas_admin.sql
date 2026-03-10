-- ============================================================
-- AGROCOTA — LIMPAR DADOS: MANTER APENAS agrocota64@gmail.com
-- Remove todos os dados de outros usuários e mantém só o admin.
-- ATENÇÃO: IRREVERSÍVEL. Faça backup antes de executar.
-- Execute no SQL Editor do Supabase.
-- ============================================================

DO $$
DECLARE
  v_admin_id UUID;
BEGIN
  -- 1. Obter ID do admin
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE email = 'agrocota64@gmail.com'
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Usuário agrocota64@gmail.com não encontrado em auth.users. Cancele a operação.';
  END IF;

  RAISE NOTICE 'Admin ID: %', v_admin_id;

  -- 2. Consultor_notificacoes (consultors não-admin)
  DELETE FROM consultor_notificacoes WHERE consultor_id != v_admin_id;

  -- 4. Push tokens (se existir)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_tokens') THEN
    DELETE FROM push_tokens WHERE user_id != v_admin_id;
  END IF;

  -- 5. Cotacao_aceites (cotações de não-admin)
  DELETE FROM cotacao_aceites
  WHERE cotacao_id IN (SELECT id FROM cotacoes WHERE consultor_id IS DISTINCT FROM v_admin_id);

  -- 6. Propostas_fornecedor (cotações de não-admin)
  -- Primeiro desfaz FK cotacoes.proposta_aceita_id para evitar violação
  UPDATE cotacoes SET proposta_aceita_id = NULL
  WHERE consultor_id IS DISTINCT FROM v_admin_id AND proposta_aceita_id IS NOT NULL;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'propostas_fornecedor') THEN
    DELETE FROM propostas_fornecedor
    WHERE cotacao_id IN (SELECT id FROM cotacoes WHERE consultor_id IS DISTINCT FROM v_admin_id);
  END IF;

  -- 7. Itens_cotacao (cotações de não-admin)
  DELETE FROM itens_cotacao
  WHERE cotacao_id IN (SELECT id FROM cotacoes WHERE consultor_id IS DISTINCT FROM v_admin_id);

  -- 8. Caderno_campo (cotações/fazendas de não-admin)
  DELETE FROM caderno_campo
  WHERE cotacao_id IN (SELECT id FROM cotacoes WHERE consultor_id IS DISTINCT FROM v_admin_id)
     OR fazenda_id IN (SELECT id FROM fazendas WHERE consultor_id IS DISTINCT FROM v_admin_id);

  -- 9. Cotações (não-admin)
  DELETE FROM cotacoes WHERE consultor_id IS DISTINCT FROM v_admin_id;

  -- 10. Compras (fazendas de não-admin)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'compras') THEN
    DELETE FROM compras
    WHERE fazenda_id IN (SELECT id FROM fazendas WHERE consultor_id IS DISTINCT FROM v_admin_id);
  END IF;

  -- 11. Plano_itens (planos de fazendas de não-admin)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plano_itens') THEN
    DELETE FROM plano_itens
    WHERE plano_id IN (
      SELECT id FROM planos_safra
      WHERE fazenda_id IN (SELECT id FROM fazendas WHERE consultor_id IS DISTINCT FROM v_admin_id)
    );
  END IF;

  -- 12. Planos_safra (fazendas de não-admin)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'planos_safra') THEN
    DELETE FROM planos_safra
    WHERE fazenda_id IN (SELECT id FROM fazendas WHERE consultor_id IS DISTINCT FROM v_admin_id);
  END IF;

  -- 13. Gestao_custos_operacionais (fazendas de não-admin)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gestao_custos_operacionais') THEN
    DELETE FROM gestao_custos_operacionais
    WHERE fazenda_id IN (SELECT id FROM fazendas WHERE consultor_id IS DISTINCT FROM v_admin_id);
  END IF;

  -- 14. Anotacoes (consultors não-admin)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'anotacoes') THEN
    DELETE FROM anotacao_blocos
    WHERE anotacao_id IN (
      SELECT id FROM anotacoes
      WHERE consultor_id IS DISTINCT FROM v_admin_id
    );
    DELETE FROM anotacoes WHERE consultor_id IS DISTINCT FROM v_admin_id;
  END IF;

  -- 15. Sistema_plantio (fazendas de não-admin)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sistema_plantio') THEN
    DELETE FROM sistema_plantio
    WHERE fazenda_id IN (SELECT id FROM fazendas WHERE consultor_id IS DISTINCT FROM v_admin_id);
  END IF;

  -- 16. Culturas_fazenda (fazendas de não-admin)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'culturas_fazenda') THEN
    DELETE FROM culturas_fazenda
    WHERE fazenda_id IN (SELECT id FROM fazendas WHERE consultor_id IS DISTINCT FROM v_admin_id);
  END IF;

  -- 17. Safras (talhões de fazendas de não-admin)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'safras') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'safra_dados_producao') THEN
      DELETE FROM safra_dados_producao
      WHERE safra_id IN (
        SELECT s.id FROM safras s
        JOIN talhoes t ON t.id = s.talhao_id
        JOIN fazendas f ON f.id = t.fazenda_id
        WHERE f.consultor_id IS DISTINCT FROM v_admin_id
      );
    END IF;
    DELETE FROM safras
    WHERE talhao_id IN (
      SELECT t.id FROM talhoes t
      JOIN fazendas f ON f.id = t.fazenda_id
      WHERE f.consultor_id IS DISTINCT FROM v_admin_id
    );
  END IF;

  -- 18. Talhoes (fazendas de não-admin)
  DELETE FROM talhoes
  WHERE fazenda_id IN (SELECT id FROM fazendas WHERE consultor_id IS DISTINCT FROM v_admin_id);

  -- 19. Fazendas (não-admin)
  DELETE FROM fazendas WHERE consultor_id IS DISTINCT FROM v_admin_id;

  -- 20. Profiles (manter apenas admin)
  DELETE FROM profiles WHERE id != v_admin_id;

  RAISE NOTICE 'Limpeza concluída. Apenas dados de agrocota64@gmail.com foram mantidos.';
END $$;

-- NOTA: Contas em auth.users de outros e-mails permanecem.
-- Para removê-las: Supabase Dashboard > Authentication > Users >
-- exclua manualmente ou use a API de Admin do Supabase.
