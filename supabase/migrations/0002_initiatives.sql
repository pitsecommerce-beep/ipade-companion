-- IPADE Companion — Iniciativas y recordatorios por correo
-- Migración 0002: initiative_reports, initiatives, email_reminders

-- ============================================================
-- Reportes de plan de acción (generados por IA)
-- ============================================================
create table if not exists public.initiative_reports (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  content    text        not null,   -- reporte completo en markdown
  created_at timestamptz not null default now()
);
create index if not exists initiative_reports_user_idx
  on public.initiative_reports (user_id, created_at desc);

-- ============================================================
-- Iniciativas clasificadas (extraídas del reporte)
-- ============================================================
create table if not exists public.initiatives (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  report_id   uuid        references public.initiative_reports (id) on delete set null,
  title       text        not null,
  description text        not null default '',
  category    text        not null
                check (category in ('inmediata', 'portafolio')),
  source      text        not null default 'passport'
                check (source in ('passport', 'bitacora', 'manual')),
  -- Borrador de email precreado por el agente
  email_subject text      not null default '',
  email_body    text      not null default '',
  status      text        not null default 'pendiente'
                check (status in ('pendiente', 'en_progreso', 'completada', 'diferida')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists initiatives_user_idx
  on public.initiatives (user_id, category);
create index if not exists initiatives_report_idx
  on public.initiatives (report_id);

-- ============================================================
-- Recordatorios por correo
-- ============================================================
create table if not exists public.email_reminders (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users (id) on delete cascade,
  initiative_id  uuid        references public.initiatives (id) on delete set null,
  email_to       text        not null,
  subject        text        not null,
  body           text        not null,
  send_at        timestamptz,          -- null = envío inmediato
  sent_at        timestamptz,
  status         text        not null default 'pendiente'
                   check (status in ('pendiente', 'enviado', 'fallido')),
  error_msg      text,
  created_at     timestamptz not null default now()
);
create index if not exists email_reminders_user_idx
  on public.email_reminders (user_id, status);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.initiative_reports enable row level security;
alter table public.initiatives         enable row level security;
alter table public.email_reminders     enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'initiative_reports',
    'initiatives',
    'email_reminders'
  ]
  loop
    execute format('drop policy if exists "owner_all" on public.%I;', t);
    execute format(
      'create policy "owner_all" on public.%I
         for all
         using (auth.uid() = user_id)
         with check (auth.uid() = user_id);', t);
  end loop;
end $$;
