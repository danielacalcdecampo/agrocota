-- ============================================================
-- AGROCOTA — FIX: Categoria completamente livre
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Remove o CHECK (categoria nao precisa mais estar em lista fechada)
ALTER TABLE itens_cotacao
  DROP CONSTRAINT IF EXISTS itens_cotacao_categoria_check;

-- 2. Garante que a coluna existe
ALTER TABLE itens_cotacao
  ADD COLUMN IF NOT EXISTS categoria TEXT;

-- 3. Padrao para quem ja tem NULL no banco
UPDATE itens_cotacao
  SET categoria = 'Insumo'
  WHERE categoria IS NULL;

-- 4. Verifica
SELECT categoria, COUNT(*) AS total
FROM itens_cotacao
GROUP BY categoria
ORDER BY total DESC;
