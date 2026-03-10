-- Registra o aceite de uma proposta de fornecedor pelo produtor
-- Chamado pelo comparativo-viewer.html (modo propostas) sem autenticação
-- SECURITY DEFINER: bypassa RLS
-- Usa consultor_notificacoes (mesmo padrão de registrar_aceite_cotacao)

DROP FUNCTION IF EXISTS registrar_aceite_proposta(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION registrar_aceite_proposta(
  p_cotacao_id  UUID,
  p_proposta_id UUID,
  p_user_agent  TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consultor_id     UUID;
  v_titulo           TEXT;
  v_fazenda_nome     TEXT;
  v_produtor_nome    TEXT;
  v_empresa_nome     TEXT;
  v_itens_json       JSONB;
  v_item             JSONB;
  v_alt              JSONB;
  v_usa_alt          BOOLEAN;
  v_valor_ha         NUMERIC;
  v_item_id          UUID;
  has_proposta_col   BOOLEAN := false;
  has_approved_at    BOOLEAN := false;
BEGIN
  -- Valida que a proposta pertence à cotação
  IF NOT EXISTS (
    SELECT 1 FROM propostas_fornecedor
    WHERE id = p_proposta_id AND cotacao_id = p_cotacao_id
  ) THEN
    RAISE EXCEPTION 'Proposta inválida para esta cotação';
  END IF;

  -- Busca dados da proposta
  SELECT empresa_nome, itens_json
  INTO v_empresa_nome, v_itens_json
  FROM propostas_fornecedor
  WHERE id = p_proposta_id;

  -- Busca dados da cotação para notificação
  SELECT c.consultor_id, c.titulo, f.nome, f.produtor_nome
  INTO v_consultor_id, v_titulo, v_fazenda_nome, v_produtor_nome
  FROM cotacoes c
  LEFT JOIN fazendas f ON f.id = c.fazenda_id
  WHERE c.id = p_cotacao_id
  LIMIT 1;

  -- Verifica se colunas opcionais existem
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cotacoes'
      AND column_name = 'proposta_aceita_id'
  ) INTO has_proposta_col;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cotacoes'
      AND column_name = 'approved_at'
  ) INTO has_approved_at;

  -- Atualiza itens_cotacao com os preços da proposta
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_itens_json, '[]'::jsonb))
  LOOP
    BEGIN
      v_item_id := (v_item->>'id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    v_alt     := v_item->'alternativa';
    v_usa_alt := (v_item->>'disponivel' = 'false')
                 AND v_alt IS NOT NULL
                 AND v_alt != 'null'::jsonb
                 AND COALESCE((v_alt->>'valor_ha')::numeric, 0) > 0;

    v_valor_ha := CASE
      WHEN v_usa_alt THEN COALESCE((v_alt->>'valor_ha')::numeric, 0)
      ELSE COALESCE((v_item->>'valor_ha')::numeric, 0)
    END;

    CONTINUE WHEN v_valor_ha <= 0;

    BEGIN
      IF v_usa_alt AND COALESCE(v_alt->>'nome', '') != '' THEN
        UPDATE itens_cotacao SET
          valor_ha        = v_valor_ha,
          fornecedor      = v_empresa_nome,
          produto_nome    = v_alt->>'nome',
          principio_ativo = NULLIF(COALESCE(v_alt->>'ia', principio_ativo), ''),
          fonte           = NULLIF(COALESCE(v_item->>'fonte', fonte), '')
        WHERE id = v_item_id;
      ELSE
        UPDATE itens_cotacao SET
          valor_ha        = v_valor_ha,
          fornecedor      = v_empresa_nome,
          principio_ativo = NULLIF(COALESCE(v_item->>'principio_ativo', principio_ativo), ''),
          fonte           = NULLIF(COALESCE(v_item->>'fonte', fonte), '')
        WHERE id = v_item_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  -- Atualiza cotação com proposta aceita + status + approved_at
  IF has_proposta_col AND has_approved_at THEN
    EXECUTE format(
      'UPDATE cotacoes SET proposta_aceita_id = $1, status = $2, approved_at = $3 WHERE id = $4'
    ) USING p_proposta_id, 'aprovada', NOW(), p_cotacao_id;
  ELSIF has_proposta_col THEN
    EXECUTE format(
      'UPDATE cotacoes SET proposta_aceita_id = $1, status = $2 WHERE id = $3'
    ) USING p_proposta_id, 'aprovada', p_cotacao_id;
  ELSIF has_approved_at THEN
    EXECUTE format(
      'UPDATE cotacoes SET status = $1, approved_at = $2 WHERE id = $3'
    ) USING 'aprovada', NOW(), p_cotacao_id;
  ELSE
    UPDATE cotacoes SET status = 'aprovada' WHERE id = p_cotacao_id;
  END IF;

  -- Notifica o consultor via consultor_notificacoes (mesmo padrão de registrar_aceite_cotacao)
  IF v_consultor_id IS NOT NULL THEN
    BEGIN
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
          'Proposta aceita: %s escolheu "%s" para a cotação "%s"%s.',
          COALESCE(v_produtor_nome, 'Produtor'),
          COALESCE(v_empresa_nome, 'fornecedor'),
          COALESCE(v_titulo, 'sem título'),
          CASE WHEN v_fazenda_nome IS NOT NULL THEN ' — ' || v_fazenda_nome ELSE '' END
        ),
        v_titulo,
        v_fazenda_nome
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_aceite_proposta(UUID, UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION registrar_aceite_proposta(UUID, UUID, TEXT) TO authenticated;
