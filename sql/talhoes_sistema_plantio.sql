-- ============================================================
-- AGROCOTA -- Propriedades, Talhoes, Plantio, Anotacoes
-- Execute TODO este arquivo no SQL Editor do Supabase
-- (pode rodar multiplas vezes -- usa IF NOT EXISTS / ON CONFLICT)
-- ============================================================

-- ============================================================
-- 1. Expandir tabela fazendas
-- ============================================================
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS produtor_nome   TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS produtor_phone  TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS produtor_email  TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS latitude        DOUBLE PRECISION;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS longitude       DOUBLE PRECISION;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS endereco        TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS observacoes     TEXT;

-- Fix: coluna 'estado' era character(1), nao comporta siglas de 2 chars como "PR"
ALTER TABLE fazendas ALTER COLUMN estado TYPE TEXT;

-- ============================================================
-- 2. culturas_fazenda
-- ============================================================
CREATE TABLE IF NOT EXISTS culturas_fazenda (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id  UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE culturas_fazenda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "culturas_fazenda_consultor" ON culturas_fazenda;
CREATE POLICY "culturas_fazenda_consultor" ON culturas_fazenda
  FOR ALL USING (
    EXISTS (SELECT 1 FROM fazendas f WHERE f.id = fazenda_id AND f.consultor_id = auth.uid())
  );

-- ============================================================
-- 3. talhoes
-- ============================================================
CREATE TABLE IF NOT EXISTS talhoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL,
  area_ha          NUMERIC(10,2),
  cultura          TEXT,
  sistema_plantio  TEXT,
  coordenadas      JSONB,
  cor              TEXT DEFAULT '#2E7D32',
  obs              TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE talhoes ENABLE ROW LEVEL SECURITY;

-- Adiciona coluna caso tabela ja exista sem ela
ALTER TABLE talhoes ADD COLUMN IF NOT EXISTS sistema_plantio TEXT;

DROP POLICY IF EXISTS "talhoes_consultor" ON talhoes;
CREATE POLICY "talhoes_consultor" ON talhoes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM fazendas f WHERE f.id = fazenda_id AND f.consultor_id = auth.uid())
  );

-- ============================================================
-- 4. sistema_plantio (historico de plantios por talhao)
-- ============================================================
CREATE TABLE IF NOT EXISTS sistema_plantio (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  talhao_id      UUID REFERENCES talhoes(id) ON DELETE CASCADE,
  fazenda_id     UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  cultura        TEXT NOT NULL,
  safra          TEXT,
  data_plantio   DATE,
  data_colheita  DATE,
  variedade      TEXT,
  populacao_ha   INTEGER,
  produtividade  NUMERIC(10,2),
  obs            TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE sistema_plantio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plantio_consultor" ON sistema_plantio;
CREATE POLICY "plantio_consultor" ON sistema_plantio
  FOR ALL USING (
    EXISTS (SELECT 1 FROM fazendas f WHERE f.id = fazenda_id AND f.consultor_id = auth.uid())
  );

-- ============================================================
-- 5. anotacoes
-- ============================================================
CREATE TABLE IF NOT EXISTS anotacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id    UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  consultor_id  UUID NOT NULL REFERENCES profiles(id),
  titulo        TEXT NOT NULL DEFAULT 'Nova anotacao',
  cor           TEXT DEFAULT '#FFF9C4',
  pinned        BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE anotacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anotacoes_consultor" ON anotacoes;
CREATE POLICY "anotacoes_consultor" ON anotacoes
  FOR ALL USING (consultor_id = auth.uid());

-- ============================================================
-- 6. anotacao_blocos
-- ============================================================
CREATE TABLE IF NOT EXISTS anotacao_blocos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anotacao_id  UUID NOT NULL REFERENCES anotacoes(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('texto', 'foto')),
  conteudo     TEXT,
  ordem        INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE anotacao_blocos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocos_consultor" ON anotacao_blocos;
CREATE POLICY "blocos_consultor" ON anotacao_blocos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM anotacoes a
      WHERE a.id = anotacao_id AND a.consultor_id = auth.uid()
    )
  );

-- ============================================================
-- 7. Bucket para fotos das anotacoes
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('anotacoes-fotos', 'anotacoes-fotos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anotacoes_fotos_insert" ON storage.objects;
CREATE POLICY "anotacoes_fotos_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'anotacoes-fotos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "anotacoes_fotos_select" ON storage.objects;
CREATE POLICY "anotacoes_fotos_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'anotacoes-fotos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "anotacoes_fotos_delete" ON storage.objects;
CREATE POLICY "anotacoes_fotos_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'anotacoes-fotos' AND auth.role() = 'authenticated');
