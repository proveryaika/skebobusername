import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const mainKeyboard = { inline_keyboard: [
  [{ text: "🔍 Поиск", callback_data: "menu:search" }],
  [{ text: "👤 Профиль", callback_data: "menu:profile" }, { text: "👥 Рефералы", callback_data: "menu:referrals" }],
  [{ text: "👑 Премиум", callback_data: "menu:premium" }, { text: "💬 Поддержка", callback_data: "menu:support" }],
]};
const backMain = [[{ text: "Главное меню", callback_data: "menu:home" }]];
const searchKeyboard = { inline_keyboard: [
  [{ text: "5 букв", callback_data: "mode:five" }, { text: "6 букв", callback_data: "mode:six" }],
  [{ text: "По маске", callback_data: "mode:mask" }, { text: "По слову", callback_data: "mode:word" }],
  [{ text: "Ловушка", callback_data: "mode:trap" }, { text: "Настройки", callback_data: "menu:settings" }],
  ...backMain,
]};

async function telegram(method: string, body: Record<string, unknown>) {
  const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error("Telegram API " + method + ": " + JSON.stringify(data));
  return data.result;
}

async function db(path: string, method = "GET", body?: unknown) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: SERVICE_KEY, authorization: "Bearer " + SERVICE_KEY,
      "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Database request failed: " + response.status + " " + await response.text());
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function screen(text: string, reply_markup: unknown = { inline_keyboard: backMain }) {
  return { text, reply_markup };
}
async function show(chatId: number, text: string, reply_markup: unknown) {
  return await telegram("sendMessage", { chat_id: chatId, text, reply_markup });
}
function pick(chars: string) { return chars[Math.floor(Math.random() * chars.length)]; }
function randomTail(length: number, chars: string) {
  let out = "";
  for (let i = 0; i < length; i++) out += pick(chars);
  return out;
}
function unique(items: string[]) { return [...new Set(items)]; }

function generateByLength(length: number, digits: boolean, count = 10): string[] {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const rest = digits ? letters + "0123456789" : letters;
  const results: string[] = [];
  while (results.length < count) results.push(pick(letters) + randomTail(length - 1, rest));
  return unique(results).slice(0, count);
}
function generateFromWord(input: string, count = 10): string[] {
  const word = input.toLowerCase().replace(/[^a-z0-9_]/g, "").replace(/^\d+/, "").slice(0, 20);
  if (word.length < 2) throw new Error("Введи слово минимум из 2 латинских букв или цифр.");
  const suffixes = ["_", "x", "tv", "hub", "pro", "one", "777", "01", "hq", "go", "it", "lab"];
  const results: string[] = [];
  for (const suffix of suffixes) {
    const candidate = (word + suffix).slice(0, 32);
    if (candidate.length >= 5 && /^[a-z]/.test(candidate)) results.push(candidate);
  }
  while (results.length < count) {
    results.push((word.slice(0, Math.min(word.length, 8)) + randomTail(5, "abcdefghijklmnopqrstuvwxyz0123456789")).slice(0, 32));
  }
  return unique(results).slice(0, count);
}
function generateFromMask(maskInput: string, count = 10): string[] {
  const mask = maskInput.toLowerCase().replace(/\s/g, "");
  if (mask.length < 5 || mask.length > 32 || !/^[a-z][a-z0-9_?]*$/.test(mask)) {
    throw new Error("Маска должна быть длиной 5–32 символа, начинаться с буквы и содержать только a-z, 0-9, _ и ?.");
  }
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const results: string[] = [];
  for (let i = 0; i < count * 4 && results.length < count; i++) {
    let value = "";
    for (const ch of mask) value += ch === "?" ? pick(chars) : ch;
    results.push(value);
  }
  return unique(results).slice(0, count);
}
function generateTrap(count = 10): string[] {
  const parts = ["ghost", "vibe", "dark", "wave", "flex", "nova", "byte", "zero", "void", "echo", "rare", "moon"];
  const results: string[] = [];
  for (const part of parts) {
    const suffix = pick("abcdefghijklmnopqrstuvwxyz") + pick("0123456789");
    results.push((part + suffix).slice(0, 7));
  }
  return unique(results).slice(0, count);
}

async function setSession(userId: number, state: string, payload: Record<string, unknown> = {}) {
  await db("bot_sessions?on_conflict=telegram_id", "POST", { telegram_id: userId, state, payload, updated_at: new Date().toISOString() });
}
async function getSession(userId: number) {
  const rows = await db("bot_sessions?select=state,payload&telegram_id=eq." + userId + "&limit=1");
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function clearSession(userId: number) {
  await db("bot_sessions?telegram_id=eq." + userId, "DELETE");
}

async function handleStart(message: any) {
  const user = message.from;
  const chatId = message.chat.id;
  const parts = (message.text ?? "").trim().split(/\s+/);
  const referralCode = parts.length > 1 ? parts[1] : null;
  let referredBy: number | null = null;
  if (referralCode) {
    const found = await db("profiles?select=telegram_id&referral_code=eq." + encodeURIComponent(referralCode));
    if (Array.isArray(found) && found.length && Number(found[0].telegram_id) !== user.id) referredBy = Number(found[0].telegram_id);
  }
  await db("profiles?on_conflict=telegram_id", "POST", {
    telegram_id: user.id, telegram_username: user.username ?? null,
    first_name: user.first_name ?? null, last_name: user.last_name ?? null,
    language_code: user.language_code ?? null, ...(referredBy ? { referred_by: referredBy } : {}),
  });
  if (referredBy) await db("referrals?on_conflict=referred_id", "POST", { referrer_id: referredBy, referred_id: user.id });
  await clearSession(user.id);
  await show(chatId, "👋 Привет, " + (user.first_name ?? "друг") + "!\n\nДобро пожаловать в Skebob Username.\nВыбери раздел 👇", mainKeyboard);
}

async function runSearch(userId: number, chatId: number, mode: string, options: { digits?: boolean; query?: string } = {}) {
  let candidates: string[];
  if (mode === "length_5") candidates = generateByLength(5, options.digits ?? false);
  else if (mode === "length_6") candidates = generateByLength(6, options.digits ?? false);
  else if (mode === "word") candidates = generateFromWord(options.query ?? "");
  else if (mode === "mask") candidates = generateFromMask(options.query ?? "");
  else candidates = generateTrap();

  const quota = await db("rpc/consume_daily_search", "POST", {
    p_telegram_id: userId, p_mode: mode, p_include_digits: options.digits ?? null,
  });
  if (!quota?.allowed) {
    await clearSession(userId);
    await show(chatId, "⛔ Дневной лимит исчерпан.\n\nБесплатно доступно 5 поисковых запросов в сутки. Завтра лимит обновится.", {
      inline_keyboard: [[{ text: "К режимам поиска", callback_data: "menu:search" }], ...backMain],
    });
    return;
  }



  const queryText = options.query ?? (mode === "length_5" || mode === "length_6" ? (options.digits ? "с цифрами" : "только буквы") : mode);
  await db("search_history?telegram_id=eq." + userId + "&order=created_at.desc&limit=1", "PATCH", {
    query_text: queryText, results_count: candidates.length,
  });
  await clearSession(userId);

  const rows = candidates.map((name) => [
    { text: "@" + name, url: "https://t.me/" + name },
    { text: "⭐", callback_data: "fav:add:" + name },
  ]);
  const remaining = quota.premium ? "👑 Премиум: без дневного лимита." : "🎟 Осталось запросов сегодня: " + quota.remaining + " из 5.";
  await show(chatId,
    "🔎 Подборка готова: " + candidates.length + " вариантов\n\n" +
    candidates.map((name, i) => (i + 1) + ". @" + name).join("\n") +
    "\n\n" + remaining +
    "\n\n⚠️ Это сгенерированные варианты, а не подтверждение свободности. Telegram Bot API не позволяет достоверно проверить, свободен ли произвольный личный username. Нажми на имя, чтобы проверить его вручную.",
    { inline_keyboard: [...rows, [{ text: "🔄 Ещё варианты", callback_data: "search:again:" + mode + ":" + (options.digits ? "1" : "0") }], [{ text: "К режимам поиска", callback_data: "menu:search" }], ...backMain] }
  );
}

async function profileScreen(userId: number, chatId: number) {
  const [profiles, history, favorites, referrals] = await Promise.all([
    db("profiles?select=telegram_username,first_name,created_at,premium_until,referral_code&telegram_id=eq." + userId + "&limit=1"),
    db("search_history?select=mode,query_text,results_count,created_at&telegram_id=eq." + userId + "&order=created_at.desc&limit=500"),
    db("favorites?select=id&telegram_id=eq." + userId),
    db("referrals?select=id,reward_status&referrer_id=eq." + userId),
  ]);
  const p = profiles?.[0] ?? {};
  const h = Array.isArray(history) ? history : [];
  const favCount = Array.isArray(favorites) ? favorites.length : 0;
  const refCount = Array.isArray(referrals) ? referrals.length : 0;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = h.filter((x: any) => String(x.created_at ?? "").slice(0, 10) === today).length;
  const premium = p.premium_until && new Date(p.premium_until).getTime() > Date.now();
  const premiumText = premium ? "Активен до " + new Date(p.premium_until).toLocaleDateString("ru-RU") : "Не активен";
  const name = p.first_name ?? p.telegram_username ?? "Пользователь";
  const text = "👤 МОЙ ПРОФИЛЬ\n━━━━━━━━━━━━━━\n\n" +
    "Имя: " + name + (p.telegram_username ? " (@" + p.telegram_username + ")" : "") + "\n" +
    "Telegram ID: " + userId + "\n" +
    "Дата регистрации: " + (p.created_at ? new Date(p.created_at).toLocaleDateString("ru-RU") : "—") + "\n\n" +
    "📊 СТАТИСТИКА\nВсего запросов: " + h.length + "\nСегодня: " + todayCount + " / " + (premium ? "∞" : "5") + "\nИзбранное: " + favCount + "\nПриглашено друзей: " + refCount + "\n\n" +
    "👑 Премиум: " + premiumText + "\n" +
    "🎟 Реферальный код: " + (p.referral_code ?? "—");
  await show(chatId, text, { inline_keyboard: [
    [{ text: "📜 История поиска", callback_data: "profile:history" }, { text: "⭐ Избранное", callback_data: "profile:favorites" }],
    [{ text: "👥 Мои рефералы", callback_data: "menu:referrals" }],
    ...backMain,
  ]});
}

async function showHistory(userId: number, chatId: number) {
  const rows = await db("search_history?select=mode,query_text,results_count,created_at&telegram_id=eq." + userId + "&order=created_at.desc&limit=10");
  const lines = (Array.isArray(rows) ? rows : []).map((x: any, i: number) =>
    (i + 1) + ". " + (x.mode ?? "поиск") + " — " + (x.results_count ?? 0) + " вариантов — " + new Date(x.created_at).toLocaleString("ru-RU")
  );
  await show(chatId, "📜 ПОСЛЕДНИЕ ПОИСКИ\n\n" + (lines.length ? lines.join("\n") : "Пока поисков не было."), {
    inline_keyboard: [[{ text: "⬅️ В профиль", callback_data: "menu:profile" }], ...backMain],
  });
}

async function showFavorites(userId: number, chatId: number) {
  const rows = await db("favorites?select=username,created_at&telegram_id=eq." + userId + "&order=created_at.desc&limit=20");
  const list = Array.isArray(rows) ? rows : [];
  const buttons = list.map((x: any) => [
    { text: "@" + x.username, url: "https://t.me/" + x.username },
    { text: "✖", callback_data: "fav:remove:" + x.username },
  ]);
  await show(chatId, "⭐ ИЗБРАННОЕ\n\n" + (list.length ? "Сохранённые юзернеймы:" : "Пока ничего не сохранено."), {
    inline_keyboard: [...buttons, [{ text: "⬅️ В профиль", callback_data: "menu:profile" }], ...backMain],
  });
}

async function showReferrals(userId: number, chatId: number) {
  const [profiles, referrals] = await Promise.all([
    db("profiles?select=referral_code&telegram_id=eq." + userId + "&limit=1"),
    db("referrals?select=referred_id,reward_status,created_at&referrer_id=eq." + userId + "&order=created_at.desc&limit=30"),
  ]);
  const code = profiles?.[0]?.referral_code;
  const link = code ? "https://t.me/usernamehunt1_bot?start=" + code : "Ссылка появится после /start";
  const list = Array.isArray(referrals) ? referrals : [];
  await show(chatId, "👥 РЕФЕРАЛЬНАЯ ПРОГРАММА\n━━━━━━━━━━━━━━\n\nТвоя ссылка:\n" + link +
    "\n\nПриглашено: " + list.length +
    "\nНачислено наград: " + list.filter((x: any) => x.reward_status === "credited").length +
    "\n\nОтправь ссылку друзьям. Начисление бонусов пока не подключено.", {
    inline_keyboard: [[{ text: "📋 Скопировать ссылку", callback_data: "ref:copy" }], [{ text: "⬅️ В профиль", callback_data: "menu:profile" }], ...backMain],
  });
}

async function handleMessage(message: any) {
  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = String(message.text ?? "").trim();
  if (text.startsWith("/start")) return await handleStart(message);
  const session = await getSession(userId);
  if (!session) {
    await show(chatId, "Выбери режим в меню поиска, чтобы начать 👇", mainKeyboard);
    return;
  }
  try {
    if (session.state === "await_word") await runSearch(userId, chatId, "word", { query: text });
    else if (session.state === "await_mask") await runSearch(userId, chatId, "mask", { query: text });
  } catch (error) {
    await show(chatId, (error as Error).message + "\n\nПопробуй ещё раз или вернись в меню.", {
      inline_keyboard: [[{ text: "Повторить ввод", callback_data: session.state === "await_word" ? "mode:word" : "mode:mask" }], ...backMain],
    });
  }
}

async function handleCallback(callback: any) {
  const data = String(callback.data ?? "");
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  const userId = callback.from.id;
  if (!chatId || !messageId) return;
  await telegram("answerCallbackQuery", { callback_query_id: callback.id });

  if (data === "menu:premium" || data === "menu:support") return;
  if (data.startsWith("fav:add:")) {
    const username = data.slice("fav:add:".length);
    await db("favorites?on_conflict=telegram_id,username", "POST", { telegram_id: userId, username, source: "search" });
    await show(chatId, "⭐ @" + username + " добавлен в избранное.", { inline_keyboard: [[{ text: "Открыть избранное", callback_data: "profile:favorites" }], ...backMain] });
    return;
  }
  if (data.startsWith("fav:remove:")) {
    const username = data.slice("fav:remove:".length);
    await db("favorites?telegram_id=eq." + userId + "&username=eq." + encodeURIComponent(username), "DELETE");
    await showFavorites(userId, chatId);
    return;
  }
  if (data === "ref:copy") {
    const rows = await db("profiles?select=referral_code&telegram_id=eq." + userId + "&limit=1");
    const code = rows?.[0]?.referral_code;
    const link = code ? "https://t.me/usernamehunt1_bot?start=" + code : "Ссылка пока недоступна";
    await show(chatId, "Твоя реферальная ссылка:\\n" + link, {
      inline_keyboard: code ? [[{ text: "Открыть бота", url: link }], ...backMain] : backMain,
    });
    return;
  }

  let view: { text: string; reply_markup: unknown } | null = null;
  switch (data) {
    case "menu:home":
      view = screen("Skebob Username — главное меню\n\nВыбери раздел 👇", mainKeyboard); break;
    case "menu:search":
      view = screen("🔍 ПОИСК ЮЗЕРНЕЙМОВ\n\nВыбери способ подбора:", searchKeyboard); break;
    case "mode:five":
      view = screen("📝 Юзернейм из 5 символов\nВыбери формат:", { inline_keyboard: [
        [{ text: "🔢 С цифрами", callback_data: "format:five:digits" }, { text: "🔤 Только буквы", callback_data: "format:five:letters" }],
        [{ text: "Назад", callback_data: "menu:search" }], ...backMain,
      ]}); break;
    case "mode:six":
      view = screen("📝 Юзернейм из 6 символов\nВыбери формат:", { inline_keyboard: [
        [{ text: "🔢 С цифрами", callback_data: "format:six:digits" }, { text: "🔤 Только буквы", callback_data: "format:six:letters" }],
        [{ text: "Назад", callback_data: "menu:search" }], ...backMain,
      ]}); break;
    case "format:five:digits":
    case "format:five:letters":
      await telegram("editMessageText", { chat_id: chatId, message_id: messageId, text: "⏳ Подбираю варианты..." });
      return await runSearch(userId, chatId, "length_5", { digits: data.endsWith("digits") });
    case "format:six:digits":
    case "format:six:letters":
      await telegram("editMessageText", { chat_id: chatId, message_id: messageId, text: "⏳ Подбираю варианты..." });
      return await runSearch(userId, chatId, "length_6", { digits: data.endsWith("digits") });
    case "mode:word":
      await setSession(userId, "await_word");
      view = screen("✍️ Отправь слово или основу юзернейма латиницей. Я предложу варианты с окончаниями.", { inline_keyboard: [[{ text: "Отмена", callback_data: "menu:search" }], ...backMain]}); break;
    case "mode:mask":
      await setSession(userId, "await_mask");
      view = screen("🎭 Отправь маску длиной от 5 до 32 символов. Символ ? означает любую букву или цифру.\nПример: ab??_ или ?cool7", { inline_keyboard: [[{ text: "Отмена", callback_data: "menu:search" }], ...backMain]}); break;
    case "mode:trap":
      await telegram("editMessageText", { chat_id: chatId, message_id: messageId, text: "⏳ Подбираю необычные варианты..." });
      return await runSearch(userId, chatId, "trap");
    case "search:again:length_5:1":
    case "search:again:length_5:0":
      return await runSearch(userId, chatId, "length_5", { digits: data.endsWith(":1") });
    case "search:again:length_6:1":
    case "search:again:length_6:0":
      return await runSearch(userId, chatId, "length_6", { digits: data.endsWith(":1") });
    case "search:again:trap:0":
      return await runSearch(userId, chatId, "trap");
    case "search:again:word:0":
      await setSession(userId, "await_word");
      return await show(chatId, "Отправь новое слово латиницей:", { inline_keyboard: [[{ text: "Отмена", callback_data: "menu:search" }], ...backMain] });
    case "search:again:mask:0":
      await setSession(userId, "await_mask");
      return await show(chatId, "Отправь новую маску (например ab??_):", { inline_keyboard: [[{ text: "Отмена", callback_data: "menu:search" }], ...backMain] });
    case "menu:profile":
      await profileScreen(userId, chatId); return;
    case "profile:history":
      await showHistory(userId, chatId); return;
    case "profile:favorites":
      await showFavorites(userId, chatId); return;
    case "menu:referrals":
      await showReferrals(userId, chatId); return;
    case "menu:settings":
      view = screen("⚙️ Настройки\n\nСейчас поиск использует стандартные настройки генерации.", { inline_keyboard: [[{ text: "Назад к поиску", callback_data: "menu:search" }], ...backMain]}); break;
    default:
      view = screen("Неизвестная команда. Вернись в меню.", mainKeyboard);
  }
  if (view) await telegram("editMessageText", { chat_id: chatId, message_id: messageId, text: view.text, reply_markup: view.reply_markup });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  if (!BOT_TOKEN || !WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_KEY) return new Response("Function secrets are not configured", { status: 500 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });

  if (new URL(req.url).searchParams.get("setup") === "1") {
    const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/setWebhook", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: SUPABASE_URL + "/functions/v1/telegram-webhook", secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"], drop_pending_updates: false,
      }),
    });
    const result = await response.json();
    return Response.json(result, { status: response.ok ? 200 : 502 });
  }

  try {
    const update = await req.json();
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
});
