-- Skebob Username core schema snapshot
create extension if not exists pgcrypto;
create table public.profiles (
 telegram_id bigint primary key, telegram_username text, first_name text, last_name text, language_code text,
 referral_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
 referred_by bigint references public.profiles(telegram_id) on delete set null, premium_until timestamptz,
 is_blocked boolean not null default false, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint profiles_not_self_referred check (referred_by is null or referred_by <> telegram_id)
);
create table public.search_history (
 id bigint generated always as identity primary key,
 telegram_id bigint not null references public.profiles(telegram_id) on delete cascade,
 mode text not null check (mode in ('length_5','length_6','mask','word','trap')),
 query_text text, include_digits boolean,
 results_count integer not null default 0 check (results_count >= 0), created_at timestamptz not null default now()
);
create table public.favorites (
 id bigint generated always as identity primary key,
 telegram_id bigint not null references public.profiles(telegram_id) on delete cascade,
 username text not null, source text, created_at timestamptz not null default now(),
 unique (telegram_id, username)
);
create table public.referrals (
 id bigint generated always as identity primary key,
 referrer_id bigint not null references public.profiles(telegram_id) on delete cascade,
 referred_id bigint not null unique references public.profiles(telegram_id) on delete cascade,
 reward_status text not null default 'pending' check (reward_status in ('pending','credited','rejected')),
 created_at timestamptz not null default now(), credited_at timestamptz,
 constraint referrals_not_self check (referrer_id <> referred_id)
);
create table public.bot_sessions (
 telegram_id bigint primary key references public.profiles(telegram_id) on delete cascade,
 state text not null check (state in ('await_word','await_mask')),
 payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table public.search_jobs (
 id uuid primary key default gen_random_uuid(),
 telegram_id bigint not null references public.profiles(telegram_id) on delete cascade,
 mode text not null check (mode in ('length_5','length_6','mask','word','trap')),
 parameters jsonb not null default '{}'::jsonb,
 status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
 results jsonb not null default '[]'::jsonb, error_message text,
 created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz
);
create index search_history_user_created_idx on public.search_history (telegram_id, created_at desc);
create index favorites_user_created_idx on public.favorites (telegram_id, created_at desc);
create index referrals_referrer_idx on public.referrals (referrer_id, created_at desc);
create index search_jobs_queue_idx on public.search_jobs (status, created_at) where status in ('queued','running');
create index profiles_referral_code_idx on public.profiles (referral_code);
create index profiles_referred_by_idx on public.profiles (referred_by);
create index search_jobs_telegram_id_idx on public.search_jobs (telegram_id);
alter table public.profiles enable row level security;
alter table public.search_history enable row level security;
alter table public.favorites enable row level security;
alter table public.referrals enable row level security;
alter table public.search_jobs enable row level security;
alter table public.bot_sessions enable row level security;
revoke all on public.profiles, public.search_history, public.favorites, public.referrals, public.search_jobs, public.bot_sessions from anon, authenticated;
revoke all on sequence public.search_history_id_seq, public.favorites_id_seq, public.referrals_id_seq from anon, authenticated;
