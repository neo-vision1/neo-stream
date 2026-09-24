-- Permite 11 câmeras + 1 drone na mesma grade.
alter table public.profiles
  drop constraint if exists profiles_multicamera_limit_check;
alter table public.profiles
  add constraint profiles_multicamera_limit_check
  check (multicamera_limit in (1,2,4,6,9,11,12));

alter table public.viewer_preferences
  drop constraint if exists viewer_preferences_grid_camera_ids_check;
alter table public.viewer_preferences
  add constraint viewer_preferences_grid_camera_ids_check
  check (cardinality(grid_camera_ids) <= 12);

alter table public.app_settings
  drop constraint if exists app_settings_max_multicamera_check;
alter table public.app_settings
  add constraint app_settings_max_multicamera_check
  check (max_multicamera in (1,2,4,6,9,11,12));
