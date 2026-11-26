-- Skebob Username core schema snapshot
create extension if not exists pgcrypto;
create table public.profiles (
 telegram_id bigint primary key, telegram_username text, first_name text, last_name text, language_code text,
 referral_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
 referred_by bigint references public.profiles(telegram_id) on delete set null, premium_until timestamptz,
 is_blocked boolean not null default false, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint profiles_not_self_referred check (referred_by is null or referred_by <> telegram_id)
,
 search_mode text not null default 'readable' check (search_mode in ('readable','random'))
, bonus_searches integer not null default 0 check (bonus_searches >= 0),
 premium_referral_days integer not null default 0 check (premium_referral_days >= 0)
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
 state text not null check (state in ('await_word','await_mask','await_trap_username','await_premium_days')),
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

-- Referral reward: one-time +3 search credits per newly referred Telegram user.
create or replace function public.credit_referral_bonus(p_referrer_id bigint, p_referred_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_referral_id bigint;
  v_referral_count integer;
  v_days_earned integer;
  v_premium_day boolean := false;
begin
  if p_referrer_id = p_referred_id then return jsonb_build_object('credited', false, 'reason', 'self_referral'); end if;
  if not exists (select 1 from public.profiles where telegram_id = p_referred_id and referred_by = p_referrer_id) then
    return jsonb_build_object('credited', false, 'reason', 'not_attributed');
  end if;
  select premium_referral_days into v_days_earned
  from public.profiles where telegram_id = p_referrer_id for update;
  if not found then return jsonb_build_object('credited', false, 'reason', 'referrer_missing'); end if;
  insert into public.referrals (referrer_id, referred_id, reward_status)
  values (p_referrer_id, p_referred_id, 'credited')
  on conflict (referred_id) do nothing returning id into v_referral_id;
  if v_referral_id is null then return jsonb_build_object('credited', false, 'reason', 'already_rewarded'); end if;
  select count(*)::integer into v_referral_count
  from public.referrals where referrer_id = p_referrer_id and reward_status = 'credited';
  if v_referral_count >= (v_days_earned + 1) * 5 then
    v_premium_day := true;
    update public.profiles
    set bonus_searches = bonus_searches + 3,
        premium_referral_days = premium_referral_days + 1,
        premium_until = greatest(coalesce(premium_until, now()), now()) + interval '1 day',
        updated_at = now()
    where telegram_id = p_referrer_id;
  else
    update public.profiles set bonus_searches = bonus_searches + 3, updated_at = now()
    where telegram_id = p_referrer_id;
  end if;
  update public.referrals set reward_status = 'credited', credited_at = now() where id = v_referral_id;
  return jsonb_build_object('credited', true, 'bonus', 3, 'premium_day', v_premium_day,
    'referral_count', v_referral_count,
    'premium_days_earned', v_days_earned + case when v_premium_day then 1 else 0 end);
end; $$;
revoke all on function public.credit_referral_bonus(bigint, bigint) from public, anon, authenticated;
grant execute on function public.credit_referral_bonus(bigint, bigint) to service_role;

-- Daily quota consumes five standard searches first, then one referral credit per extra search.


-- GRAM wallet payments
create table public.gram_payments (
 id uuid primary key default gen_random_uuid(),
 telegram_id bigint not null references public.profiles(telegram_id) on delete cascade,
 days integer not null check (days between 1 and 365),
 usd_amount numeric(12,2) not null check (usd_amount > 0),
 gram_amount numeric(24,9) not null check (gram_amount > 0),
 nano_amount bigint not null unique check (nano_amount > 0),
 payment_comment text not null unique,
 status text not null default 'pending' check (status in ('pending','paid','expired')),
 tx_hash text unique,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 paid_at timestamptz
);
create index gram_payments_user_created_idx on public.gram_payments(telegram_id, created_at desc);
alter table public.gram_payments enable row level security;
revoke all on public.gram_payments from anon, authenticated;
grant select, insert, update on public.gram_payments to service_role;

create or replace function public.credit_gram_payment(p_payment_id uuid, p_tx_hash text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_payment public.gram_payments%rowtype;
begin
 select * into v_payment from public.gram_payments where id = p_payment_id for update;
 if not found then return jsonb_build_object('credited', false, 'reason', 'payment_not_found'); end if;
 if v_payment.status = 'paid' then return jsonb_build_object('credited', false, 'reason', 'already_paid'); end if;
 if v_payment.status <> 'pending' or v_payment.expires_at < now() then return jsonb_build_object('credited', false, 'reason', 'payment_expired'); end if;
 if exists (select 1 from public.gram_payments where tx_hash = p_tx_hash and id <> p_payment_id) then
   return jsonb_build_object('credited', false, 'reason', 'transaction_already_used');
 end if;
 update public.profiles
 set premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => v_payment.days), updated_at = now()
 where telegram_id = v_payment.telegram_id;
 if not found then return jsonb_build_object('credited', false, 'reason', 'profile_not_found'); end if;
 update public.gram_payments set status = 'paid', tx_hash = p_tx_hash, paid_at = now() where id = p_payment_id;
 return jsonb_build_object('credited', true, 'days', v_payment.days);
end; $$;
revoke all on function public.credit_gram_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.credit_gram_payment(uuid, text) to service_role;


-- Telegram Stars payments
create table if not exists public.star_payments (
 id uuid primary key default gen_random_uuid(),
 telegram_id bigint not null references public.profiles(telegram_id) on delete cascade,
 days integer not null check (days between 1 and 365),
 stars integer not null check (stars > 0),
 payload text not null unique,
 status text not null default 'pending' check (status in ('pending','paid','expired')),
 telegram_payment_charge_id text unique,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create index if not exists star_payments_user_created_idx on public.star_payments(telegram_id, created_at desc);
alter table public.star_payments enable row level security;
revoke all on public.star_payments from anon, authenticated;
grant select, insert, update on public.star_payments to service_role;

create or replace function public.credit_star_payment(p_payload text, p_charge_id text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_payment public.star_payments%rowtype;
begin
 select * into v_payment from public.star_payments where payload = p_payload for update;
 if not found then return jsonb_build_object('credited', false, 'reason', 'payment_not_found'); end if;
 if v_payment.status = 'paid' then return jsonb_build_object('credited', false, 'reason', 'already_paid'); end if;
 if v_payment.status <> 'pending' then return jsonb_build_object('credited', false, 'reason', 'payment_not_pending'); end if;
 if exists (select 1 from public.star_payments where telegram_payment_charge_id = p_charge_id and payload <> p_payload) then
   return jsonb_build_object('credited', false, 'reason', 'charge_already_used');
 end if;
 update public.profiles
 set premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => v_payment.days), updated_at = now()
 where telegram_id = v_payment.telegram_id;
 if not found then return jsonb_build_object('credited', false, 'reason', 'profile_not_found'); end if;
 update public.star_payments set status = 'paid', telegram_payment_charge_id = p_charge_id, paid_at = now()
 where id = v_payment.id;
 return jsonb_build_object('credited', true, 'days', v_payment.days);
end; $$;
revoke all on function public.credit_star_payment(text, text) from public, anon, authenticated;
grant execute on function public.credit_star_payment(text, text) to service_role;

 
-- Username traps (up to 3 active per Telegram user, 7-day lifetime)
create table if not exists public.username_traps (
 id uuid primary key default gen_random_uuid(),
 telegram_id bigint not null references public.profiles(telegram_id) on delete cascade,
 username text not null check (username ~ '^[a-z][a-z0-9_]{4,31}$'),
 status text not null default 'waiting' check (status in ('waiting','released','expired','cancelled')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '7 days'),
 unique (telegram_id, username)
);
create index if not exists username_traps_user_active_idx
 on public.username_traps (telegram_id, expires_at desc) where status = 'waiting';
alter table public.username_traps enable row level security;
revoke all on public.username_traps from anon, authenticated;
grant all on public.username_traps to service_role;

create or replace function public.create_username_trap(p_telegram_id bigint, p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count integer; v_row public.username_traps;
begin
 if p_username !~ '^[a-z][a-z0-9_]{4,31}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
 perform 1 from public.profiles where telegram_id = p_telegram_id for update;
 update public.username_traps set status = 'expired'
  where telegram_id = p_telegram_id and status = 'waiting' and expires_at <= now();
 select count(*) into v_count from public.username_traps
  where telegram_id = p_telegram_id and status = 'waiting' and expires_at > now();
 if v_count >= 3 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
 if exists (select 1 from public.username_traps where telegram_id = p_telegram_id and username = p_username and status = 'waiting' and expires_at > now()) then
  return jsonb_build_object('ok', false, 'reason', 'duplicate');
 end if;
 insert into public.username_traps (telegram_id, username) values (p_telegram_id, p_username) returning * into v_row;
 return jsonb_build_object('ok', true, 'id', v_row.id, 'username', v_row.username, 'expires_at', v_row.expires_at);
end;
$$;
revoke all on function public.create_username_trap(bigint,text) from public, anon, authenticated;
grant execute on function public.create_username_trap(bigint,text) to service_role;
