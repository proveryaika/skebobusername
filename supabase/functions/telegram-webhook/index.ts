import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const mainKeyboard = {
  inline_keyboard: [
    [{ text: "🔍 Поиск", callback_data: "menu:search" }],
    [
      { text: "👤 Профиль", callback_data: "menu:profile" },
      { text: "👥 Рефералы", callback_data: "menu:referrals" },
    ],
    [
      { text: "👑 Премиум", callback_data: "menu:premium" },
      { text: "💬 Поддержка", callback_data: "menu:support" },
    ],
  ],
};
const backMain = [[{ text: "главное меню", callback_data: "menu:home" }]];
const searchKeyboard = {
  inline_keyboard: [
    [{ text: "5 букв", callback_data: "mode:five" }, { text: "6 букв", callback_data: "mode:six" }],
    [{ text: "по маске", callback_data: "mode:mask" }, { text: "по слову", callback_data: "mode:word" }],
    [{ text: "ловушка", callback_data: "mode:trap" }, { text: "настройки", callback_data: "menu:settings" }],
    ...backMain,
  ],
};

async function telegram(method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram API ${method}: ${JSON.stringify(data)}`);
  return data.result;
}

async function db(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Database request failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function screen(text: string, reply_markup: unknown = { inline_keyboard: backMain }) {
  return { text, reply_markup };
}

async function show(chatId: number, text: string, reply_markup: unknown) {
  return await telegram("sendMessage", { chat_id: chatId, text, reply_markup });
}

async function handleStart(message: any) {
  const user = message.from;
  const chatId = message.chat.id;
  const parts = (message.text ?? "").trim().split(/\s+/);
  const referralCode = parts.length > 1 ? parts[1] : null;
  let referredBy: number | null = null;

  if (referralCode) {
    const found = await db(`profiles?select=telegram_id&referral_code=eq.${encodeURIComponent(referralCode)}`);
    if (Array.isArray(found) && found.length && Number(found[0].telegram_id) !== user.id) {
      referredBy = Number(found[0].telegram_id);
    }
  }

  await db("profiles?on_conflict=telegram_id", "POST", {
    telegram_id: user.id,
    telegram_username: user.username ?? null,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    language_code: user.language_code ?? null,
    ...(referredBy ? { referred_by: referredBy } : {}),
  });

  if (referredBy) {
    await db("referrals?on_conflict=referred_id", "POST", {
      referrer_id: referredBy,
      referred_id: user.id,
    });
  }

  await show(chatId, "Skebob Username - главное меню\n\nвыберите раздел 👇", mainKeyboard);
}

async function handleCallback(callback: any) {
  const data = String(callback.data ?? "");
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  await telegram("answerCallbackQuery", { callback_query_id: callback.id });

  if (!chatId || !messageId) return;

  // These buttons are intentionally visible but inactive for now.
  if (data === "menu:premium" || data === "menu:support") return;

  let view: { text: string; reply_markup: unknown };

  switch (data) {
    case "menu:home":
      view = screen("Skebob Username - главное меню\n\nвыберите раздел 👇", mainKeyboard);
      break;
    case "menu:search":
      view = screen("🔍 Поиск юзернеймов\n━━━━━━━━━━━━━━\n\n🚀 Твой юзернейм уже ждёт.\n🎯 Выбери, как его искать.\n\n👇 Режимы поиска", searchKeyboard);
      break;
    case "mode:five":
      view = screen("📝 Ник из 5 символов\n━━━━━━━━━━━━━━\n\n🔢 С цифрами — например ab1cd\n🔤 Без цифр — только буквы\n\n👇 Выбери формат", {
        inline_keyboard: [
          [{ text: "с цифрами", callback_data: "format:five:digits" }, { text: "без цифр", callback_data: "format:five:letters" }],
          [{ text: "назад", callback_data: "menu:search" }],
        ],
      });
      break;
    case "format:five:digits":
    case "format:five:letters": {
      const userId = callback.from.id;
      const includeDigits = data.endsWith("digits");
      const quota = await db("rpc/consume_daily_search", "POST", {
        p_telegram_id: userId,
        p_mode: "length_5",
        p_include_digits: includeDigits,
      });
      if (!quota?.allowed) {
        view = screen(
          "⛔ Дневной лимит исчерпан.\n\nБесплатно доступно 5 поисковых запросов в сутки. Попробуй снова после ежедневного сброса лимита.",
          {
            inline_keyboard: [
              [{ text: "к режимам поиска", callback_data: "menu:search" }],
              ...backMain,
            ],
          },
        );
      } else {
        const quotaLine = quota.premium
          ? "👑 Премиум: без дневного лимита."
          : `🎟 Осталось бесплатных запросов сегодня: ${quota.remaining} из 5.`;
        view = screen(
          `✅ Запрос принят: ${includeDigits ? "с цифрами" : "без цифр"}\n\n${quotaLine}\n\nМодуль подбора и проверки доступности юзернеймов подключим следующим этапом.`,
          {
            inline_keyboard: [
              [{ text: "к режимам поиска", callback_data: "menu:search" }],
              ...backMain,
            ],
          },
        );
      }
      break;
    }
    case "mode:six":
    case "mode:mask":
    case "mode:word":
    case "mode:trap":
      view = screen("Этот режим добавим следующим этапом. Сейчас готовим основу поиска и хранения настроек.", {
        inline_keyboard: [
          [{ text: "назад к поиску", callback_data: "menu:search" }],
          ...backMain,
        ],
      });
      break;
    case "menu:profile":
      view = screen("👤 Профиль\n\nТвой профиль будет отображать статистику поиска, избранное и статус премиума.", mainKeyboard);
      break;
    case "menu:referrals":
      view = screen("👥 Реферальная программа\n\nПриглашения и начисления будут отображаться здесь. Персональную ссылку добавим после настройки бота.", mainKeyboard);
      break;
    case "menu:premium":
      view = screen("👑 Премиум\n\nРаздел подписки подготовлен. Оплату и тарифы подключим отдельно.", mainKeyboard);
      break;
    case "menu:support":
      view = screen("💬 Поддержка\n\nНапиши в поддержку: @usernamehunt1_bot", mainKeyboard);
      break;
    case "menu:settings":
      view = screen("⚙️ Настройки\n\nНастройки поиска появятся здесь.", {
        inline_keyboard: [
          [{ text: "назад к поиску", callback_data: "menu:search" }],
          ...backMain,
        ],
      });
      break;
    default:
      view = screen("Неизвестная команда. Вернись в главное меню.", mainKeyboard);
  }

  await telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: view.text,
    reply_markup: view.reply_markup,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  if (!BOT_TOKEN || !WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    return new Response("Function secrets are not configured", { status: 500 });
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  // One-time setup call: registers this Edge Function as the Telegram webhook.
  if (new URL(req.url).searchParams.get("setup") === "1") {
    const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-webhook`;
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false
      })
    });
    const result = await response.json();
    return Response.json(result, { status: response.ok ? 200 : 502 });
  }

  try {
    const update = await req.json();
    if (update.message?.text?.startsWith("/start")) {
      await handleStart(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false }, { status: 500 });
  }
});
