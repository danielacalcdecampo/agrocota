-- ============================================================
-- AGROCOTA — FIX: Cotação vinculada a talhão (cálculo por área)
-- Execute no SQL Editor do Supabase
-- ============================================================

ALTER TABLE public.cotacoes
  ADD COLUMN IF NOT EXISTS talhao_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cotacoes_talhao_id_fkey'
      AND conrelid = 'public.cotacoes'::regclass
  ) THEN
    ALTER TABLE public.cotacoes
      ADD CONSTRAINT cotacoes_talhao_id_fkey
      FOREIGN KEY (talhao_id) REFERENCES public.talhoes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cotacoes_talhao_id_idx ON public.cotacoes(talhao_id);
