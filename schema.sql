-- ============================================================
-- Планер: таблиці для фонових нагадувань
-- Виконати у Supabase → SQL Editor
-- ============================================================

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  device_id    text unique not null,
  subscription jsonb not null,
  created_at   timestamptz default now()
);

create table if not exists reminders (
  id         text primary key,          -- "<device_id>:<task_id>"
  device_id  text not null,
  title      text not null,
  body       text default '',
  fire_at    timestamptz not null,
  sent_at    timestamptz,
  created_at timestamptz default now()
);

create index if not exists reminders_due_idx on reminders (fire_at) where sent_at is null;

-- ------------------------------------------------------------
-- RLS. Для особистого застосунку без логіну — доступ по anon key.
-- Коли додасте Supabase Auth, замініть true на (auth.uid() = user_id).
-- ------------------------------------------------------------
alter table push_subscriptions enable row level security;
alter table reminders          enable row level security;

drop policy if exists anon_subs on push_subscriptions;
create policy anon_subs on push_subscriptions
  for all to anon using (true) with check (true);

drop policy if exists anon_reminders on reminders;
create policy anon_reminders on reminders
  for all to anon using (true) with check (true);

-- ------------------------------------------------------------
-- Прибирання старих записів
-- ------------------------------------------------------------
create or replace function cleanup_reminders() returns void language sql as $$
  delete from reminders where sent_at is not null and sent_at < now() - interval '7 days';
$$;

-- ------------------------------------------------------------
-- Cron: щохвилини смикає Edge Function.
-- Підставте свій PROJECT_REF і SERVICE_ROLE_KEY.
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('send-reminders') where exists (
  select 1 from cron.job where jobname = 'send-reminders'
);

select cron.schedule('send-reminders', '* * * * *', $$
  select net.http_post(
    url     := 'https://PROJECT_REF.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer SERVICE_ROLE_KEY'
               ),
    body    := '{}'::jsonb
  );
$$);

select cron.schedule('cleanup-reminders', '17 4 * * *', $$ select cleanup_reminders(); $$);
