-- Desfaz o aceite de uma cotação ou proposta de fornecedor
-- Pode ser chamado pelo produtor via comparativo-viewer.html (anônimo)
-- SECURITY DEFINER: bypassa RLS
--
-- Comportamento:
--   • Se cotacao.proposta_aceita_id existir → modo propostas:
--       reseta itens_cotacao (valor_ha = 0, fornecedor = null)
--       e limpa proposta_aceita_id + status = 'enviada'
--   • Caso contrário → modo cotação comparativa:
--       apenas reverte status = 'enviada'

DROP FUNCTION IF EXISTS desfazer_aceite(UUID);

CREATE OR REPLACE FUNCTION desfazer_aceite(
  p_cotacao_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposta_aceita_id UUID;
  v_itens_json         JSONB;
  v_item               JSONB;
  v_item_id            UUID;
  v_alt                JSONB;
  v_usa_alt            BOOLEAN;
  has_proposta_col     BOOLEAN := false;
  has_approved_at      BOOLEAN := false;
BEGIN
  -- Verifica colunas opcionais
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

  -- Busca proposta aceita (se a coluna existir)
  IF has_proposta_col THEN
    EXECUTE 'SELECT proposta_aceita_id FROM cotacoes WHERE id = $1'
    INTO v_proposta_aceita_id
    USING p_cotacao_id;
  END IF;

  -- ── Modo propostas: tem proposta_aceita_id ──────────────────────────────────
  IF v_proposta_aceita_id IS NOT NULL THEN
    -- Busca itens_json da proposta aceita para saber quais itens resetar
    BEGIN
      SELECT itens_json INTO v_itens_json
      FROM propostas_fornecedor WHERE id = v_proposta_aceita_id;
    EXCEPTION WHEN OTHERS THEN
      v_itens_json := '[]'::jsonb;
    END;

    -- Reseta cada item da proposta
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_itens_json, '[]'::jsonb))
    LOOP
      BEGIN
        v_item_id := (v_item->>'id')::UUID;
      EXCEPTION WHEN OTHERS THEN CONTINUE; END;

      v_alt     := v_item->'alternativa';
      v_usa_alt := (v_item->>'disponivel' = 'false')
                   AND v_alt IS NOT NULL
                   AND v_alt != 'null'::jsonb
                   AND COALESCE((v_alt->>'valor_ha')::numeric, 0) > 0;

      BEGIN
        IF v_usa_alt AND COALESCE(v_alt->>'nome', '') != '' THEN
          -- Item com alternativa: restaura nome original do produto
          UPDATE itens_cotacao SET
            valor_ha     = 0,
            fornecedor   = NULL,
            produto_nome = COALESCE(NULLIF(v_item->>'produto', ''), produto_nome),
            principio_ativo = NULLIF(COALESCE(v_item->>'ia_orig', v_item->>'principio_ativo', ''), '')
          WHERE id = v_item_id;
        ELSE
          UPDATE itens_cotacao SET valor_ha = 0, fornecedor = NULL WHERE id = v_item_id;
        END IF;
      EXCEPTION WHEN OTHERS THEN CONTINUE; END;
    END LOOP;

    -- Limpa proposta_aceita_id, reseta status e approved_at
    IF has_approved_at THEN
      EXECUTE 'UPDATE cotacoes SET proposta_aceita_id = NULL, status = $1, approved_at = NULL WHERE id = $2'
      USING 'enviada', p_cotacao_id;
    ELSE
      EXECUTE 'UPDATE cotacoes SET proposta_aceita_id = NULL, status = $1 WHERE id = $2'
      USING 'enviada', p_cotacao_id;
    END IF;

  -- ── Modo cotação comparativa: sem proposta_aceita_id ────────────────────────
  ELSE
    -- Apenas reverte status (itens_cotacao não foram alterados no modo comparativo)
    IF has_approved_at THEN
      UPDATE cotacoes SET status = 'enviada', approved_at = NULL WHERE id = p_cotacao_id;
    ELSE
      UPDATE cotacoes SET status = 'enviada' WHERE id = p_cotacao_id;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION desfazer_aceite(UUID) TO anon;
GRANT EXECUTE ON FUNCTION desfazer_aceite(UUID) TO authenticated;
