-- ============================================================
--  REGISTROS DE SAFRA
--  Planos de safra (consultor → produtor aceita)
--  Compras realizadas
-- ============================================================

-- ── PLANOS DE SAFRA ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planos_safra (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  fazenda_id  UUID        NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  talhao_id   UUID        REFERENCES talhoes(id) ON DELETE SET NULL,
  safra       TEXT,                          -- ex: "2024/2025"
  descricao   TEXT,
  status      TEXT        NOT NULL DEFAULT 'rascunho',
    -- 'rascunho'   = consultor ainda editando
    -- 'submetido'  = enviado para produtor revisar
    -- 'aceito'     = produtor aprovou
    -- 'rejeitado'  = produtor rejeitou
  criado_por  UUID        REFERENCES auth.users(id),
  criado_em   TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

-- ── ITENS DO PLANO ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plano_itens (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  plano_id    UUID        NOT NULL REFERENCES planos_safra(id) ON DELETE CASCADE,
  categoria   TEXT,                          -- 'semente' | 'fertilizante' | 'defensivo' | 'servico' | 'outro'
  produto     TEXT        NOT NULL,
  quantidade  NUMERIC,
  unidade     TEXT,                          -- 'kg' | 'L' | 'sc' | 'un' | 'ha' | 't'
  preco_unit  NUMERIC,
  total       NUMERIC GENERATED ALWAYS AS (COALESCE(quantidade, 0) * COALESCE(preco_unit, 0)) STORED,
  status      TEXT        NOT NULL DEFAULT 'pendente',
    -- 'pendente' | 'aceito' | 'rejeitado'
  obs         TEXT,
  criado_em   TIMESTAMPTZ DEFAULT now()
);

-- ── COMPRAS REALIZADAS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS compras (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  fazenda_id    UUID        NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  talhao_id     UUID        REFERENCES talhoes(id) ON DELETE SET NULL,
  plano_item_id UUID        REFERENCES plano_itens(id) ON DELETE SET NULL,
  safra         TEXT,
  categoria     TEXT,                        -- mesmas categorias de plano_itens
  produto       TEXT        NOT NULL,
  quantidade    NUMERIC,
  unidade       TEXT,
  preco_unit    NUMERIC,
  total         NUMERIC,                     -- pode ser informado diretamente ou = qtd * preco_unit
  data_compra   DATE,
  fornecedor    TEXT,
  obs           TEXT,
  criado_em     TIMESTAMPTZ DEFAULT now()
);

-- ── ÍNDICES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_planos_safra_fazenda ON planos_safra(fazenda_id);
CREATE INDEX IF NOT EXISTS idx_plano_itens_plano    ON plano_itens(plano_id);
CREATE INDEX IF NOT EXISTS idx_compras_fazenda      ON compras(fazenda_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE planos_safra  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plano_itens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras       ENABLE ROW LEVEL SECURITY;

-- Acesso completo ao usuario autenticado que pertence à fazenda
-- (ajuste conforme sua politica real de usuario/fazenda)

CREATE POLICY "planos_safra_all" ON planos_safra
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "plano_itens_all" ON plano_itens
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "compras_all" ON compras
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
