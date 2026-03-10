-- Adiciona tipo de safra (safra principal ou safrinha) nas cotações
ALTER TABLE cotacoes
  ADD COLUMN IF NOT EXISTS tipo_safra TEXT DEFAULT 'safra'
  CHECK (tipo_safra IN ('safra', 'safrinha'));
