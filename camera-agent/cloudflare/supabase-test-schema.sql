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

create table if not exists public.camera_settings (
  site_id text not null,
  camera_id text not null check (camera_id ~ '^CAM[0-9]{2}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  updated_at timestamptz not null default now(),
  primary key (site_id, camera_id)
);

create table if not exists public.profile_camera_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  camera_id text not null check (camera_id ~ '^CAM(0[1-9]|1[01])$'),
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

-- Trata o drone como uma fonte com nome e acesso próprios.
alter table public.camera_settings drop constraint if exists camera_settings_camera_id_check;
alter table public.camera_settings add constraint camera_settings_camera_id_check
  check (camera_id ~ '^CAM[0-9]{2}$' or camera_id = 'DRONE01');
alter table public.profile_camera_access drop constraint if exists profile_camera_access_camera_id_check;
alter table public.profile_camera_access add constraint profile_camera_access_camera_id_check
  check (camera_id ~ '^CAM(0[1-9]|1[01])$' or camera_id = 'DRONE01');

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.camera_preferences enable row level security;
alter table public.camera_settings enable row level security;
alter table public.profile_camera_access enable row level security;
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
drop policy if exists "camera_settings_read" on public.camera_settings;
create policy "camera_settings_read" on public.camera_settings for select using (auth.uid() is not null);
drop policy if exists "camera_settings_admin" on public.camera_settings;
create policy "camera_settings_admin" on public.camera_settings for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "camera_access_self_or_admin" on public.profile_camera_access;
create policy "camera_access_self_or_admin" on public.profile_camera_access for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "camera_access_admin_insert" on public.profile_camera_access;
create policy "camera_access_admin_insert" on public.profile_camera_access for insert with check (public.is_admin());
drop policy if exists "camera_access_admin_update" on public.profile_camera_access;
create policy "camera_access_admin_update" on public.profile_camera_access for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "camera_access_admin_delete" on public.profile_camera_access;
create policy "camera_access_admin_delete" on public.profile_camera_access for delete using (public.is_admin());
drop policy if exists "viewer_preferences_own" on public.viewer_preferences;
create policy "viewer_preferences_own" on public.viewer_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "settings_read" on public.app_settings;
create policy "settings_read" on public.app_settings for select using (auth.uid() is not null);
drop policy if exists "settings_admin" on public.app_settings;
create policy "settings_admin" on public.app_settings for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email) values(new.id, new.email) on conflict (id) do nothing;
  insert into public.profile_camera_access(user_id, camera_id)
    select new.id, 'CAM' || lpad(number::text, 2, '0') from generate_series(1, 11) as number
    on conflict (user_id, camera_id) do nothing;
  insert into public.profile_camera_access(user_id, camera_id) values(new.id, 'DRONE01')
    on conflict (user_id, camera_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.profiles(id, email) select id, email from auth.users on conflict (id) do nothing;
insert into public.profile_camera_access(user_id, camera_id)
  select users.id, 'CAM' || lpad(number::text, 2, '0')
  from auth.users as users cross join generate_series(1, 11) as number
  on conflict (user_id, camera_id) do nothing;
insert into public.profile_camera_access(user_id, camera_id)
  select id, 'DRONE01' from auth.users
  on conflict (user_id, camera_id) do nothing;
insert into public.camera_settings(site_id, camera_id, display_name)
  select 'OBRA_001', 'CAM' || lpad(number::text, 2, '0'), 'Câmera ' || lpad(number::text, 2, '0')
  from generate_series(1, 11) as number
  on conflict (site_id, camera_id) do nothing;
insert into public.camera_settings(site_id, camera_id, display_name)
  values('OBRA_001', 'DRONE01', 'Drone')
  on conflict (site_id, camera_id) do nothing;
insert into public.camera_settings(site_id, camera_id, display_name, updated_at)
  select distinct on (preferences.camera_id) 'OBRA_001', preferences.camera_id, preferences.custom_name, now()
  from public.camera_preferences as preferences
  join public.profiles as profile on profile.id = preferences.user_id and profile.role = 'admin'
  where preferences.custom_name <> ''
  order by preferences.camera_id
  on conflict (site_id, camera_id) do update set display_name = excluded.display_name, updated_at = excluded.updated_at;
update public.profiles set can_ptz = false, can_talk = false where role = 'viewer';
insert into public.app_settings(site_id) values('OBRA_001') on conflict (site_id) do nothing;

-- Depois, promova somente a conta responsável:
-- update public.profiles set role = 'admin' where email = 'administrador@empresa.com.br';
