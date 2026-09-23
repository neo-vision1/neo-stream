-- Execute primeiro no projeto Supabase usado pelo ambiente de teste.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'viewer' check (role in ('admin', 'operator', 'viewer')),
  can_ptz boolean not null default false,
  can_talk boolean not null default false,
  multicamera_limit smallint not null default 4 check (multicamera_limit in (1,2,4,6,9,11)),
  created_at timestamptz not null default now()
);

create table if not exists public.camera_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  camera_id text not null check (camera_id ~ '^CAM[0-9]{2}$'),
  custom_name text not null default '' check (char_length(custom_name) <= 60),
  primary key (user_id, camera_id)
);

create table if not exists public.viewer_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  grid_camera_ids text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (cardinality(grid_camera_ids) <= 11)
);

create table if not exists public.app_settings (
  site_id text primary key,
  multicamera_enabled boolean not null default true,
  max_multicamera smallint not null default 4 check (max_multicamera in (1,2,4,6,9,11)),
  auto_pause_hidden boolean not null default true,
  idle_minutes smallint not null default 10 check (idle_minutes between 1 and 120),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.camera_preferences enable row level security;
alter table public.viewer_preferences enable row level security;
alter table public.app_settings enable row level security;

alter table public.profiles alter column can_ptz set default false;
alter table public.profiles alter column can_talk set default false;

drop policy if exists "profiles_self_or_admin" on public.profiles;
create policy "profiles_self_or_admin" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "preferences_own" on public.camera_preferences;
create policy "preferences_own" on public.camera_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "viewer_preferences_own" on public.viewer_preferences;
create policy "viewer_preferences_own" on public.viewer_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "settings_read" on public.app_settings;
create policy "settings_read" on public.app_settings for select using (auth.uid() is not null);
drop policy if exists "settings_admin" on public.app_settings;
create policy "settings_admin" on public.app_settings for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles(id, email) values(new.id, new.email) on conflict (id) do nothing; return new; end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.profiles(id, email) select id, email from auth.users on conflict (id) do nothing;
update public.profiles set can_ptz = false, can_talk = false where role = 'viewer';
insert into public.app_settings(site_id) values('OBRA_001') on conflict (site_id) do nothing;

-- Depois, promova somente a conta responsável:
-- update public.profiles set role = 'admin' where email = 'administrador@empresa.com.br';
