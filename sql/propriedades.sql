-- ============================================================
-- AGROCOTA — PROPRIEDADES, TALHÕES, PLANTIO, ANOTAÇÕES
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ============================================================
-- 1. EXPANDIR tabela fazendas (produtor, contato, localização)
-- ============================================================
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS produtor_nome    TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS produtor_phone   TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS produtor_email   TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS latitude         DOUBLE PRECISION;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS longitude        DOUBLE PRECISION;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS endereco         TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS observacoes      TEXT;

-- ============================================================
-- 2. TABELA: culturas_fazenda (múltiplas culturas por fazenda)
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
-- 3. TABELA: talhoes (polígonos GeoJSON)
-- ============================================================
CREATE TABLE IF NOT EXISTS talhoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id      UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  area_ha         NUMERIC(10,2),
  cultura         TEXT,
  -- GeoJSON polygon como JSON: {"coordinates": [[{lat,lng},...]], "type":"Polygon"}
  coordenadas     JSONB,
  cor             TEXT DEFAULT '#2E7D32',
  obs             TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE talhoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "talhoes_consultor" ON talhoes;
CREATE POLICY "talhoes_consultor" ON talhoes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM fazendas f WHERE f.id = fazenda_id AND f.consultor_id = auth.uid())
  );

-- ============================================================
-- 4. TABELA: sistema_plantio
-- ============================================================
CREATE TABLE IF NOT EXISTS sistema_plantio (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  talhao_id       UUID REFERENCES talhoes(id) ON DELETE CASCADE,
  fazenda_id      UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  cultura         TEXT NOT NULL,
  safra           TEXT,           -- ex: 2024/2025
  data_plantio    DATE,
  data_colheita   DATE,
  variedade       TEXT,
  populacao_ha    INTEGER,        -- plantas por ha
  produtividade   NUMERIC(10,2),  -- sacas/ha estimadas
  obs             TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE sistema_plantio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plantio_consultor" ON sistema_plantio;
CREATE POLICY "plantio_consultor" ON sistema_plantio
  FOR ALL USING (
    EXISTS (SELECT 1 FROM fazendas f WHERE f.id = fazenda_id AND f.consultor_id = auth.uid())
  );

-- ============================================================
-- 5. TABELA: anotacoes (blocos de notas por fazenda)
-- ============================================================
CREATE TABLE IF NOT EXISTS anotacoes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id  UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  consultor_id UUID NOT NULL REFERENCES profiles(id),
  titulo      TEXT NOT NULL DEFAULT 'Nova anotação',
  cor         TEXT DEFAULT '#FFF9C4',    -- cor do card (como ColorNote)
  pinned      BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE anotacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anotacoes_consultor" ON anotacoes;
CREATE POLICY "anotacoes_consultor" ON anotacoes
  FOR ALL USING (consultor_id = auth.uid());

-- ============================================================
-- 6. TABELA: anotacao_blocos (blocos de texto e foto dentro da nota)
-- ============================================================
CREATE TABLE IF NOT EXISTS anotacao_blocos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anotacao_id  UUID NOT NULL REFERENCES anotacoes(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('texto', 'foto')),
  conteudo     TEXT,   -- texto ou URL da foto no Storage
  ordem        INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE anotacao_blocos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocos_consultor" ON anotacao_blocos;
CREATE POLICY "blocos_consultor" ON anotacao_blocos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM anotacoes a WHERE a.id = anotacao_id AND a.consultor_id = auth.uid()
    )
  );

-- ============================================================
-- 7. BUCKET para fotos das anotações
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('anotacoes-fotos', 'anotacoes-fotos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anotacoes_fotos_insert" ON storage.objects;
CREATE POLICY "anotacoes_fotos_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'anotacoes-fotos' AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "anotacoes_fotos_select" ON storage.objects;
CREATE POLICY "anotacoes_fotos_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'anotacoes-fotos' AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "anotacoes_fotos_delete" ON storage.objects;
CREATE POLICY "anotacoes_fotos_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'anotacoes-fotos' AND auth.role() = 'authenticated'
  );
