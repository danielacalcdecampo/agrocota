-- Corrige ambiente antigo onde a coluna de compra ainda não existe
ALTER TABLE public.cotacao_aceites
ADD COLUMN IF NOT EXISTS compra_realizada_em TIMESTAMPTZ;
