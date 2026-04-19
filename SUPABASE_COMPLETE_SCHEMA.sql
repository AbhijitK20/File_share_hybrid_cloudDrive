-- FileShare Supabase schema
-- Run this in Supabase SQL Editor.
-- Safe to re-run because it uses IF NOT EXISTS / guarded operations.

-- 1) Extensions
create extension if not exists pgcrypto;

-- 2) Common trigger for updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 3) Users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password text not null,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  storage_used bigint not null default 0 check (storage_used >= 0),
  master_key text,
  master_key_salt text,
  encryption_enabled boolean not null default true,
  is_email_verified boolean not null default false,
  email_verification jsonb,
  password_reset jsonb,
  subscription_status text not null default 'inactive'
    check (subscription_status in ('inactive', 'active', 'canceled', 'expired')),
  subscription_end_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_plan on public.users(plan);
create index if not exists idx_users_subscription_status on public.users(subscription_status);

-- 4) Files
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  filename text not null unique,
  original_name text not null,
  size bigint not null check (size > 0),
  compressed_size bigint,
  is_compressed boolean not null default false,
  mimetype text not null,
  group_code text not null check (group_code ~ '^\d{6}$'),
  expires_at timestamptz not null,
  uploaded_by_id uuid references public.users(id) on delete set null,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  access_mode text not null default 'public' check (access_mode in ('public', 'allowlist', 'blocklist')),
  encryption jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_files_group_code on public.files(group_code);
create index if not exists idx_files_expires_at on public.files(expires_at);
create index if not exists idx_files_uploaded_by_id on public.files(uploaded_by_id);
create index if not exists idx_files_visibility on public.files(visibility);
create index if not exists idx_files_access_mode on public.files(access_mode);

-- 5) File permissions (allowlist/blocklist)
create table if not exists public.file_permissions (
  id bigserial primary key,
  file_id uuid not null references public.files(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  permission_type text not null check (permission_type in ('allow', 'block')),
  permissions jsonb not null default '["view"]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(file_id, user_id),
  check (jsonb_typeof(permissions) = 'array')
);

create index if not exists idx_file_permissions_file_id on public.file_permissions(file_id);
create index if not exists idx_file_permissions_user_id on public.file_permissions(user_id);
create index if not exists idx_file_permissions_type on public.file_permissions(permission_type);

-- 6) File activity/audit
create table if not exists public.file_activity (
  id bigserial primary key,
  file_id uuid not null references public.files(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  actor_email text,
  action text not null,
  details text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists idx_file_activity_file_id on public.file_activity(file_id);
create index if not exists idx_file_activity_actor_user_id on public.file_activity(actor_user_id);
create index if not exists idx_file_activity_created_at on public.file_activity(created_at desc);

-- 7) Payments
create table if not exists public.payments (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  provider text not null default 'razorpay',
  order_id text,
  payment_id text,
  amount bigint,
  currency text not null default 'INR',
  status text not null check (status in ('created', 'paid', 'failed', 'canceled', 'refunded')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_payments_provider_order_payment
  on public.payments(provider, order_id, payment_id);

create index if not exists idx_payments_user_id on public.payments(user_id);
create index if not exists idx_payments_order_id on public.payments(order_id);
create index if not exists idx_payments_payment_id on public.payments(payment_id);
create index if not exists idx_payments_status on public.payments(status);

-- 8) Apply updated_at triggers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at'
  ) THEN
    CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_files_updated_at'
  ) THEN
    CREATE TRIGGER trg_files_updated_at
    BEFORE UPDATE ON public.files
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_file_permissions_updated_at'
  ) THEN
    CREATE TRIGGER trg_file_permissions_updated_at
    BEFORE UPDATE ON public.file_permissions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payments_updated_at'
  ) THEN
    CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- 9) Create storage bucket used by backend
insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 5368709120)
on conflict (id) do nothing;

-- Optional hard reset helper (manual use only):
-- truncate table public.file_activity, public.file_permissions, public.payments, public.files, public.users restart identity cascade;
