# Skebob Username Bot

Telegram bot: [@usernamehunt1_bot](https://t.me/usernamehunt1_bot)

## Current MVP

- `/start` opens the main menu.
- Main menu has Search, Profile, Referral program, Premium, and Support buttons.
- Search opens the search mode menu.
- `5 букв` opens the five-character format screen.
- Choosing digits / letters confirms the selected format.

Other menu sections and search modes are currently placeholders. Search data collection and database integration will be added in later steps.

## Run locally

1. Install Python 3.10+.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Set the bot token as an environment variable. Do not commit your real token:

   - macOS / Linux: `export BOT_TOKEN="your-token"`
   - PowerShell: `$env:BOT_TOKEN="your-token"`

4. Start the bot:

   ```bash
   python bot.py
   ```

## GitHub Actions / deployment

Store the token as a secret named `BOT_TOKEN` in the hosting platform. Never put the token directly in source code or send it in chat.
