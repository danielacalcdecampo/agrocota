-- Cache para API própria de cotações físicas agro
create table if not exists public.agro_quotes_cache (
  id text primary key,
  source text not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agro_quotes_cache_expires_at
  on public.agro_quotes_cache (expires_at desc);

create or replace function public.set_updated_at_agro_quotes_cache()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_agro_quotes_cache on public.agro_quotes_cache;
create trigger trg_set_updated_at_agro_quotes_cache
before update on public.agro_quotes_cache
for each row execute function public.set_updated_at_agro_quotes_cache();

alter table public.agro_quotes_cache enable row level security;

-- Somente service_role (Edge Function) manipula essa tabela.
-- Nenhuma policy pública é criada propositalmente.
