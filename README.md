# Skebob Username Bot

Telegram bot: [@usernamehunt1_bot](https://t.me/usernamehunt1_bot)

## Architecture

- **GitHub** stores the bot source and database schema snapshot.
- **Supabase Postgres** stores profiles, search history, favorites, referrals, and queued search jobs.
- **Supabase Edge Function** receives Telegram webhook updates. No separate Render/Railway server is required.

## Implemented

- `/start` creates or updates a Telegram profile and opens the main menu.
- Main menu: Search, Profile, Referral program, Premium, Support.
- Search menu with 5-letter, 6-letter, mask, word, trap, and settings buttons.
- Five-character search format selection (with digits / letters only) is stored in `search_history`.
- Referral start parameters are attributed to profiles.
- Webhook requests are protected by Telegram's webhook secret header.
- Database tables have RLS enabled and direct access for `anon` / `authenticated` revoked. The Edge Function uses the server-side service-role key.

Search generation, username availability checks, payment processing, and full profile/referral statistics are not implemented yet.

## Supabase setup

Project: `TopGram`

Deployable function source: `supabase/functions/telegram-webhook/index.ts`

Add these secrets in **Supabase Dashboard → Edge Functions → Secrets**:

- `BOT_TOKEN` — token from BotFather. Never commit it or send it in chat.
- `TELEGRAM_WEBHOOK_SECRET` — a private random string (5–256 characters, using letters, numbers, underscores, or hyphens).

The function URL is:

`https://azfmkeccmactyoneotpk.supabase.co/functions/v1/telegram-webhook`

After adding secrets, register the Telegram webhook with Bot API `setWebhook`, using the function URL and the exact same value for `secret_token`. Set `allowed_updates` to `message,callback_query`. The function has JWT verification disabled because Telegram authenticates requests with the webhook secret header.

## Database

`database/schema.sql` is a schema snapshot for reference. The live project schema is managed in Supabase.

## Legacy local prototype

`bot.py` is the original polling prototype. The active architecture is the Supabase Edge Function webhook; do not run both at once.

## Security

- Never commit `.env`, bot tokens, Supabase secret keys, or webhook secrets.
- Never put the Supabase service-role key in a client app.


## Current bot features

- Inline menu for search, profile, referrals, premium, and support (premium/support buttons are intentionally inactive).
- Candidate generation for 5- and 6-character usernames, word-based suggestions, masks using `?`, and a short-name/trap mode.
- Search history, saved favorites, referral link/statistics, and profile summary.
- Free tier: 5 search runs per day; active premium profiles are exempt.
- Important limitation: candidates are generated suggestions only. Telegram Bot API does not expose a reliable method to check whether arbitrary personal usernames are available. The bot labels this clearly and opens each candidate in Telegram for manual checking; no candidate is represented as confirmed available.
