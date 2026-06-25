-- IPADE Companion — esquema inicial
-- Tablas: passports, study_sessions, bitacoras, documents, agent_messages
-- Todas con Row Level Security: cada participante sólo ve/edita sus propios datos.

-- ============================================================
-- Pasaporte IPADE (1 por usuario)
-- ============================================================
create table if not exists public.passports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade unique,
  full_name text not null default '',
  role text not null default '',
  seniority text not null default '',
  personal_context text not null default '',
  company_name text not null default '',
  industry text not null default '',
  company_size text not null default '',
  company_role text not null default '',
  industry_context text not null default '',
  company_context text not null default '',
  objectives text not null default '',
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Sesiones de estudio (casos, módulos, temas)
-- ============================================================
create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists study_sessions_user_idx on public.study_sessions (user_id);

-- ============================================================
-- Bitácoras (varias por sesión)
-- ============================================================
create table if not exists public.bitacoras (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bitacoras_session_idx on public.bitacoras (session_id);

-- ============================================================
-- Documentos / materiales (metadatos + texto extraído)
-- ============================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  content_text text,
  created_at timestamptz not null default now()
);
create index if not exists documents_session_idx on public.documents (session_id);

-- ============================================================
-- Mensajes con el agente (historial de chat por sesión)
-- ============================================================
create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.study_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists agent_messages_session_idx on public.agent_messages (session_id, created_at);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.passports enable row level security;
alter table public.study_sessions enable row level security;
alter table public.bitacoras enable row level security;
alter table public.documents enable row level security;
alter table public.agent_messages enable row level security;

-- Política genérica "el dueño puede todo" para cada tabla.
do $$
declare
  t text;
begin
  foreach t in array array['passports', 'study_sessions', 'bitacoras', 'documents', 'agent_messages']
  loop
    execute format('drop policy if exists "owner_all" on public.%I;', t);
    execute format(
      'create policy "owner_all" on public.%I
         for all
         using (auth.uid() = user_id)
         with check (auth.uid() = user_id);', t);
  end loop;
end $$;

-- ============================================================
-- Storage: bucket privado de materiales
-- ============================================================
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

-- Cada usuario sólo accede a archivos bajo su carpeta: materials/<uid>/...
drop policy if exists "materials_owner_read" on storage.objects;
create policy "materials_owner_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "materials_owner_insert" on storage.objects;
create policy "materials_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "materials_owner_delete" on storage.objects;
create policy "materials_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
