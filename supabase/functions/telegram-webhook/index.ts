import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TONCENTER_API_KEY = Deno.env.get("TONCENTER_API_KEY") ?? "";
const GRAM_RECEIVE_ADDRESS = "UQDVnyA5v_uLgb7lh_JRe5RfPVhj0MebqrRt0LdlJkavsQuP";

const BOT_OWNER_ID = 8032877285;
const baseMainKeyboard = [
  [{ text: "🔍 Поиск", callback_data: "menu:search" }],
  [{ text: "👤 Профиль", callback_data: "menu:profile" }, { text: "👥 Рефералы", callback_data: "menu:referrals" }],
  [{ text: "👑 Премиум", callback_data: "menu:premium" }, { text: "💬 Поддержка", callback_data: "menu:support" }],
];
function mainKeyboardFor(userId: number) {
  return { inline_keyboard: [
    ...baseMainKeyboard,
    ...(userId === BOT_OWNER_ID ? [[{ text: "🛠 Выдать премиум по ID", callback_data: "admin:premium" }]] : []),
  ] };
}
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
  if (!response.ok || !data.ok) {
    const description = String(data?.description ?? "");
    if (method === "answerCallbackQuery" && (description.includes("query is too old") || description.includes("query ID is invalid"))) return null;
    throw new Error("Telegram API " + method + ": " + JSON.stringify(data));
  }
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

function generateReadable(length: number): string {
  const consonants = "bcdfghjklmnpqrstvwxz", vowels = "aeiou";
  let value = pick("abcdefghijklmnopqrstuvwxyz");
  for (let i = 1; i < length; i++) value += pick(vowels.includes(value[value.length - 1]) ? consonants : vowels);
  return value;
}
async function getSearchMode(userId: number): Promise<"readable" | "random"> {
  const rows = await db("profiles?select=search_mode&telegram_id=eq." + userId + "&limit=1");
  return rows?.[0]?.search_mode === "random" ? "random" : "readable";
}
async function setSearchMode(userId: number, mode: "readable" | "random") {
  await db("profiles?telegram_id=eq." + userId, "PATCH", { search_mode: mode });
}
async function showSearchSettings(userId: number, chatId: number, messageId?: number) {
  const mode = await getSearchMode(userId), readable = mode === "readable";
  const text = "⚙️ Настройки поиска\n━━━━━━━━━━━━━━\n\n📋 Режим · " + (readable ? "Читабельный" : "Рандомный") +
    "\n\n" + (readable ? "✅ Читабельный — ищет произносимые ники\nРандомный — любые случайные комбинации" : "Читабельный — ищет произносимые ники\n✅ Рандомный — любые случайные комбинации") +
    "\n\n💡 Нажми на режим, чтобы переключить";
  const markup = { inline_keyboard: [
    [{ text: (readable ? "✅ " : "") + "Читабельный", callback_data: "settings:mode:readable" }],
    [{ text: (!readable ? "✅ " : "") + "Рандомный", callback_data: "settings:mode:random" }],
    [{ text: "⬅️ В меню поиска", callback_data: "menu:search" }], ...backMain
  ]};
  if (messageId) await telegram("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: markup });
  else await show(chatId, text, markup);
}

function generateByLength(length: number, digits: boolean, count = 1): string[] {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const rest = digits ? letters + "0123456789" : letters;
  const results: string[] = [];
  while (results.length < count) results.push(pick(letters) + randomTail(length - 1, rest));
  return unique(results).slice(0, count);
}
function generateFromWord(input: string, count = 1): string[] {
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
function generateFromMask(maskInput: string, count = 1): string[] {
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
function generateTrap(count = 1): string[] {
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

async function grantPremiumMinutes(targetUserId: number, minutes: number) {
  const rows = await db("profiles?select=premium_until&telegram_id=eq." + targetUserId + "&limit=1");
  if (!Array.isArray(rows) || !rows.length) throw new Error("Профиль с таким ID не найден. Проверь ID и отправь его ещё раз.");
  const now = Date.now();
  const current = rows[0].premium_until ? new Date(rows[0].premium_until).getTime() : 0;
  const base = Number.isFinite(current) ? Math.max(now, current) : now;
  const until = new Date(base + minutes * 60_000).toISOString();
  await db("profiles?telegram_id=eq." + targetUserId, "PATCH", { premium_until: until, updated_at: new Date().toISOString() });
  return until;
}

async function handleStart(message: any) {
  const user = message.from;
  const chatId = message.chat.id;
  const parts = (message.text ?? "").trim().split(/\s+/);
  const referralCode = parts.length > 1 ? parts[1] : null;
  let referredBy: number | null = null;
  const existingProfile = await db("profiles?select=telegram_id&telegram_id=eq." + user.id + "&limit=1");
  if ((!Array.isArray(existingProfile) || existingProfile.length === 0) && referralCode) {
    const found = await db("profiles?select=telegram_id&referral_code=eq." + encodeURIComponent(referralCode));
    if (Array.isArray(found) && found.length && Number(found[0].telegram_id) !== user.id) referredBy = Number(found[0].telegram_id);
  }
  await db("profiles?on_conflict=telegram_id", "POST", {
    telegram_id: user.id, telegram_username: user.username ?? null,
    first_name: user.first_name ?? null, last_name: user.last_name ?? null,
    language_code: user.language_code ?? null, ...(referredBy ? { referred_by: referredBy } : {}),
  });
  if (referredBy) {
    const reward = await db("rpc/credit_referral_bonus", "POST", {
      p_referrer_id: referredBy, p_referred_id: user.id,
    });
    if (reward?.credited === true) {
      const bonusText = "🎉 По твоей ссылке пришёл новый пользователь!\nТебе начислено +3 бонусных поисковых запроса. 💎";
      const premiumText = reward.premium_day === true
        ? "\n\n👑 Поздравляем! За 5 приглашённых пользователей тебе начислен 1 день Премиума!"
        : "";
      await show(referredBy, bonusText + premiumText, mainKeyboardFor(referredBy));
    }
  }
  await clearSession(user.id);
  await show(chatId, "👋 Привет, " + (user.first_name ?? "друг") + "!\n\nДобро пожаловать в Skebob Username.\nВыбери раздел 👇", mainKeyboardFor(user.id));
}

async function checkPublicUsernameAvailability(username: string): Promise<boolean> {
  const name = username.toLowerCase();
  if (!/^[a-z][a-z0-9_]{4,31}$/.test(name) || name.endsWith("_") || name.includes("__")) return false;
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; UsernameAvailabilityCheck/1.0)" };
  try {
    const [tgResponse, fragmentResponse] = await Promise.all([
      fetch("https://t.me/" + encodeURIComponent(name), { headers, signal: AbortSignal.timeout(7000) }),
      fetch("https://fragment.com/username/" + encodeURIComponent(name), { headers, signal: AbortSignal.timeout(7000) }),
    ]);
    if (!tgResponse.ok || !fragmentResponse.ok) return false;
    const [tgHtml, fragmentHtml] = await Promise.all([tgResponse.text(), fragmentResponse.text()]);
    if (/captcha|cloudflare|just a moment|too many requests/i.test(tgHtml + fragmentHtml)) return false;
    if (/tgme_page_title|tgme_page_extra/.test(tgHtml)) return false;
    const titleMatch = fragmentHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) return false;
    const title = titleMatch[1].replace(/&[^;]+;/g, " ").toLowerCase();
    if (title.includes(name)) return false;
    return true;
  } catch {
    return false;
  }
}

async function runSearch(userId: number, chatId: number, mode: string, options: { digits?: boolean; query?: string } = {}) {
  let candidates: string[];
  const searchMode = await getSearchMode(userId);
  if (mode === "length_5") candidates = searchMode === "readable" && !options.digits
    ? unique(Array.from({ length: 60 }, () => generateReadable(5))) : generateByLength(5, options.digits ?? false, 60);
  else if (mode === "length_6") candidates = searchMode === "readable" && !options.digits
    ? unique(Array.from({ length: 60 }, () => generateReadable(6))) : generateByLength(6, options.digits ?? false, 60);
  else if (mode === "word") candidates = generateFromWord(options.query ?? "", 60);
  else if (mode === "mask") candidates = generateFromMask(options.query ?? "", 60);
  else candidates = searchMode === "readable"
    ? unique(Array.from({ length: 60 }, () => generateReadable(6))) : generateTrap(30);

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

  await show(chatId, "🔎 Проверяю кандидатов в Telegram и Fragment. Покажу только прошедшие обе проверки…", {
    inline_keyboard: [[{ text: "Отмена", callback_data: "menu:search" }], ...backMain],
  });
  const checked: string[] = [];
  for (let i = 0; i < candidates.length && checked.length < 1; i++) {
    const name = candidates[i];
    if (await checkPublicUsernameAvailability(name)) checked.push(name);
    if (i + 1 < candidates.length && checked.length < 1) await new Promise((resolve) => setTimeout(resolve, 350));
  }

  const queryText = options.query ?? (mode === "length_5" || mode === "length_6" ? (options.digits ? "с цифрами" : "только буквы") : mode);
  const latestSearch = await db("search_history?select=id&telegram_id=eq." + userId + "&order=created_at.desc&limit=1");
  if (Array.isArray(latestSearch) && latestSearch.length) {
    await db("search_history?id=eq." + latestSearch[0].id, "PATCH", {
      query_text: queryText, results_count: checked.length,
    });
  }
  await clearSession(userId);

  const remaining = quota.premium
    ? "👑 Премиум · без дневного лимита"
    : "🎟 Осталось сегодня · " + quota.remaining + " из 5" +
      (quota.bonus_remaining > 0 ? "\n🎁 Бонусных запросов · " + quota.bonus_remaining : "");
  const againCallback = mode === "word" ? "search:again:word:0" : mode === "mask" ? "search:again:mask:0" : "search:again:" + mode + ":" + (options.digits ? "1" : "0");
  if (!checked.length) {
    await show(chatId,
      "😕 Сейчас не удалось найти ни одного имени, прошедшего обе проверки.\n\nЯ не буду показывать непроверенные варианты как свободные. Попробуй ещё раз чуть позже.\n\n" + remaining,
      { inline_keyboard: [[{ text: "🔄 Проверить ещё", callback_data: againCallback }], [{ text: "🔎 В меню поиска", callback_data: "menu:search" }], ...backMain] }
    );
    return;
  }
  const username = checked[0];
  const score = Math.min(10, Math.max(5, 6 + (/[0-9]/.test(username) ? 0 : 1) + (username.length <= 6 ? 1 : 0)));
  const keyboard: any[] = [[
    { text: "@" + username, url: "https://t.me/" + username },
    { text: "⭐ В избранное", callback_data: "fav:add:" + username },
  ]];
  keyboard.push([{ text: "🔄 Найти ещё", callback_data: againCallback }], [{ text: "🔎 В меню поиска", callback_data: "menu:search" }], ...backMain);
  await show(chatId,
    "✅ КАНДИДАТЫ, ПРОШЕДШИЕ ПРОВЕРКУ\n━━━━━━━━━━━━━━\n\n" +
    rows.join("\n") +
    "\n\n🔍 Проверены по публичным страницам Telegram и Fragment. Это не официальный метод Telegram; статус может измениться, поэтому попробуй сразу установить выбранное имя.\n\n" +
    remaining,
    { inline_keyboard: keyboard }
  );
}
async function profileScreen(userId: number, chatId: number) {
  const [profiles, history, favorites, referrals] = await Promise.all([
    db("profiles?select=telegram_username,first_name,created_at,premium_until,premium_referral_days,referral_code,bonus_searches&telegram_id=eq." + userId + "&limit=1"),
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
    "🆔 ID профиля: " + userId + "\n" +
    "Дата регистрации: " + (p.created_at ? new Date(p.created_at).toLocaleDateString("ru-RU") : "—") + "\n\n" +
    "📊 СТАТИСТИКА\nВсего запросов: " + h.length + "\nСегодня: " + todayCount + " / " + (premium ? "∞" : String(5 + Number(p.bonus_searches ?? 0))) + "\nБонусных запросов: " + Number(p.bonus_searches ?? 0) + "\nБонусных запросов: " + Number(p.bonus_searches ?? 0) + "\nИзбранное: " + favCount + "\nПриглашено друзей: " + refCount + "\n\n" +
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

async function editScreen(chatId: number, messageId: number, text: string, reply_markup: unknown) {
  await telegram("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup });
}

async function showPremium(userId: number, chatId: number, messageId: number) {
  const rows = await db("profiles?select=premium_until&telegram_id=eq." + userId + "&limit=1");
  const until = rows?.[0]?.premium_until;
  const active = until && new Date(until).getTime() > Date.now();
  const status = active ? "✅ Активен до " + new Date(until).toLocaleDateString("ru-RU") : "❌ Не активен";
  const text = "⭐ Премиум\n━━━━━━━━━━━━━━\n\n" +
    "💡 Статус · " + status + "\n\n" +
    "💎 Что даёт Премиум\n" +
    "▫️ Безлимит — без лимита 5/день\n" +
    "▫️ Без ожиданий — не ждёшь завтрашнего сброса\n" +
    "▫️ Любые режимы — слово и фильтр без остановки\n\n" +
    "💰 Стоимость за 1 день\n⭐ Звёзды · 25\n💵 Криптовалюта · $0.35\n\n👇 Выбери способ оплаты";
  await editScreen(chatId, messageId, text, { inline_keyboard: [
    [{ text: "⭐ Звёзды", callback_data: "premium:stars" }, { text: "💵 Криптовалюта", callback_data: "premium:crypto" }],
    [{ text: "🎁 Подарить другу", callback_data: "premium:gift" }],
    [{ text: "🆓 Получить бесплатно", callback_data: "premium:free" }],
    ...backMain,
  ]});
}

async function showStars(userId: number, chatId: number, messageId: number) {
  await telegram("setWebhook", {
    url: SUPABASE_URL + "/functions/v1/telegram-webhook",
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query", "pre_checkout_query"],
    drop_pending_updates: false,
  });
  await editScreen(chatId, messageId,
    "⭐ ОПЛАТА ЗВЁЗДАМИ\n━━━━━━━━━━━━━━\n\n" +
    "⭐ 25 звёзд = 1 день Премиума\n" +
    "Чем больше звёзд — тем дольше срок.\n\n" +
    "Выбери пакет:",
    { inline_keyboard: [
      [{ text: "25 ⭐ · 1 день", callback_data: "stars:plan:1" }, { text: "50 ⭐ · 2 дня", callback_data: "stars:plan:2" }],
      [{ text: "100 ⭐ · 4 дня", callback_data: "stars:plan:4" }],
      [{ text: "⬅️ Назад", callback_data: "menu:premium" }],
      ...backMain,
    ]}
  );
}

async function createStarsInvoice(userId: number, chatId: number, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Некорректный срок Premium.");
  const stars = days * 25;
  const payload = "skb-stars-" + crypto.randomUUID();
  await db("star_payments", "POST", {
    telegram_id: userId, days, stars, payload, status: "pending",
  });
  await telegram("sendInvoice", {
    chat_id: chatId,
    title: "Skebob Username · Premium",
    description: days + " дн. Premium без дневного лимита",
    payload,
    currency: "XTR",
    prices: [{ label: "Premium · " + days + " дн.", amount: stars }],
  });
}

async function handlePreCheckout(query: any) {
  const payload = String(query.invoice_payload ?? "");
  const rows = await db("star_payments?select=telegram_id,stars,status&payload=eq." + encodeURIComponent(payload) + "&limit=1");
  const payment = rows?.[0];
  const valid = payment &&
    Number(payment.telegram_id) === Number(query.from?.id) &&
    Number(payment.stars) === Number(query.total_amount) &&
    query.currency === "XTR" &&
    payment.status === "pending";
  await telegram("answerPreCheckoutQuery", {
    pre_checkout_query_id: query.id,
    ok: Boolean(valid),
    ...(!valid ? { error_message: "Счёт не найден или устарел. Вернись в Premium и создай новый." } : {}),
  });
}

async function handleSuccessfulStarsPayment(message: any) {
  const payment = message.successful_payment;
  if (!payment || payment.currency !== "XTR") return;
  const payload = String(payment.invoice_payload ?? "");
  const rows = await db("star_payments?select=telegram_id,stars,days,status&payload=eq." + encodeURIComponent(payload) + "&limit=1");
  const order = rows?.[0];
  if (!order || Number(order.telegram_id) !== Number(message.from?.id) ||
      Number(order.stars) !== Number(payment.total_amount)) {
    console.error("Unmatched Telegram Stars payment", { payload, userId: message.from?.id, amount: payment.total_amount });
    await show(message.chat.id, "⚠️ Платёж получен, но заказ не удалось сопоставить автоматически. Не оплачивай повторно — напиши в поддержку.", mainKeyboardFor(Number(message.from?.id)));
    return;
  }
  const result = await db("rpc/credit_star_payment", "POST", {
    p_payload: payload,
    p_charge_id: payment.telegram_payment_charge_id,
  });
  if (result?.credited) {
    await show(message.chat.id, "🎉 Оплата получена!\n\n⭐ Списано · " + payment.total_amount + " Stars\n👑 Начислено · " + result.days + " дн. Premium\n\nСпасибо за поддержку!", mainKeyboardFor(Number(message.from?.id)));
  } else if (result?.reason === "already_paid") {
    await show(message.chat.id, "✅ Этот платёж уже обработан. Premium активен.", mainKeyboardFor(Number(message.from?.id)));
  } else {
    await show(message.chat.id, "⚠️ Telegram подтвердил оплату, но Premium не начислен автоматически. Не оплачивай повторно — напиши в поддержку.", mainKeyboardFor(Number(message.from?.id)));
    console.error("Stars credit failed", result);
  }
}

async function showCrypto(userId: number, chatId: number, messageId: number) {
  await editScreen(chatId, messageId,
    "💵 ОПЛАТА КРИПТОВАЛЮТОЙ\n━━━━━━━━━━━━━━\n\n" +
    "💵 $0.35 = 1 день Премиума\n\n" +
    "1️⃣ Выбери срок\n2️⃣ После подключения оплаты получишь счёт\n3️⃣ Премиум включится после подтверждения платежа\n\nНа сколько дней?",
    { inline_keyboard: [
      [{ text: "1 день · $0.35", callback_data: "crypto:plan:1" }, { text: "3 дня · $1.05", callback_data: "crypto:plan:3" }],
      [{ text: "7 дней · $2.45", callback_data: "crypto:plan:7" }, { text: "30 дней · $10.50", callback_data: "crypto:plan:30" }],
      [{ text: "✍️ Своё число дней", callback_data: "crypto:custom" }],
      [{ text: "⬅️ Назад", callback_data: "menu:premium" }],
      ...backMain,
    ]}
  );
}

async function showPaymentPending(chatId: number, messageId: number, title: string, detail: string, back: string) {
  await editScreen(chatId, messageId,
    title + "\n━━━━━━━━━━━━━━\n\n" + detail +
    "\n\n🔧 Экран и выбор тарифа готовы. Подключение реального приёма платежей сделаем следующим этапом. Сейчас оплата не списывается, Премиум не начисляется.",
    { inline_keyboard: [
      [{ text: "⬅️ Назад", callback_data: back }],
      ...backMain,
    ]}
  );
}

async function showGift(userId: number, chatId: number, messageId: number) {
  await editScreen(chatId, messageId,
    "🎁 ПОДАРИТЬ ПРЕМИУМ ДРУГУ\n━━━━━━━━━━━━━━\n\n" +
    "1️⃣ Выбери срок и способ оплаты\n" +
    "2️⃣ После оплаты получишь ссылку-подарок\n" +
    "3️⃣ Отправь её другу — он откроет бота и получит Премиум\n\n" +
    "🎁 Другу не нужно заранее знать бота. Если он новый пользователь, переход по ссылке также засчитается как приглашение.",
    { inline_keyboard: [
      [{ text: "3 дня · $1.05", callback_data: "gift:plan:3" }, { text: "7 дней · $2.45", callback_data: "gift:plan:7" }],
      [{ text: "30 дней · $10.50", callback_data: "gift:plan:30" }],
      [{ text: "⭐ Оплатить звёздами", callback_data: "gift:stars" }],
      [{ text: "🎁 Мои подарки", callback_data: "gift:list" }],
      [{ text: "⬅️ Назад", callback_data: "menu:premium" }],
      ...backMain,
    ]}
  );
}

async function showGiftStars(chatId: number, messageId: number) {
  await editScreen(chatId, messageId,
    "⭐ ПОДАРОК ЗВЁЗДАМИ\n━━━━━━━━━━━━━━\n\n" +
    "Выбери количество звёзд для подарка.\n" +
    "25 ⭐ = 1 день Премиума. Подарок будет предназначен другу, а не твоему аккаунту.",
    { inline_keyboard: [
      [{ text: "25 ⭐ · 1 день", callback_data: "gift:stars:25" }, { text: "50 ⭐ · 2 дня", callback_data: "gift:stars:50" }],
      [{ text: "100 ⭐ · 4 дня", callback_data: "gift:stars:100" }],
      [{ text: "⬅️ Назад", callback_data: "premium:gift" }],
      ...backMain,
    ]}
  );
}

async function showMyGifts(chatId: number, messageId: number) {
  await editScreen(chatId, messageId,
    "🎁 МОИ ПОДАРКИ\n━━━━━━━━━━━━━━\n\n" +
    "Пока подарков нет. После подключения оплаты здесь будут отображаться созданные подарки, их статус и ссылки для отправки друзьям.",
    { inline_keyboard: [
      [{ text: "🎁 Создать подарок", callback_data: "premium:gift" }],
      [{ text: "⬅️ Назад", callback_data: "premium:gift" }],
      ...backMain,
    ]}
  );
}



async function createGramPayment(userId: number, days: number, chatId: number, messageId?: number) {
  if (!TONCENTER_API_KEY) {
    await show(chatId, "⚠️ Проверка платежей пока не настроена. Напиши в поддержку.", { inline_keyboard: [[{ text: "⬅️ К крипто-тарифам", callback_data: "premium:crypto" }], ...backMain] });
    return;
  }
  const usdAmount = Number((days * 0.35).toFixed(2));
  const priceResponse = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd&include_last_updated_at=true");
  if (!priceResponse.ok) throw new Error("Не удалось получить актуальный курс GRAM. Попробуй позже.");
  const priceData = await priceResponse.json();
  const gramUsd = Number(priceData?.["the-open-network"]?.usd);
  const updatedAt = Number(priceData?.["the-open-network"]?.last_updated_at ?? 0);
  if (!Number.isFinite(gramUsd) || gramUsd <= 0 || !updatedAt || Date.now() / 1000 - updatedAt > 600) {
    throw new Error("Курс GRAM сейчас недоступен или устарел. Попробуй позже.");
  }
  const nanoAmount = Math.round((usdAmount / gramUsd) * 1e9);
  const gramAmount = nanoAmount / 1e9;
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  const paymentComment = "SKB-" + suffix;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const response = await fetch(SUPABASE_URL + "/rest/v1/gram_payments", {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY, authorization: "Bearer " + SERVICE_KEY,
      "content-type": "application/json", prefer: "return=representation",
    },
    body: JSON.stringify({
      telegram_id: userId, days, usd_amount: usdAmount, gram_amount: gramAmount,
      nano_amount: String(nanoAmount), payment_comment: paymentComment, expires_at: expiresAt,
    }),
  });
  if (!response.ok) throw new Error("Не удалось создать платёж: " + await response.text());
  const rows = await response.json();
  const paymentId = rows?.[0]?.id;
  if (!paymentId) throw new Error("Не удалось сохранить платёж. Попробуй ещё раз.");
  const text = "💎 ОПЛАТА GRAM\n━━━━━━━━━━━━━━\n\n" +
    "👑 Премиум · " + days + " дн.\n" +
    "💵 Стоимость · $" + usdAmount.toFixed(2) + "\n" +
    "💎 К оплате · " + gramAmount.toFixed(9) + " GRAM\n\n" +
    "📥 Адрес получения:\n" + GRAM_RECEIVE_ADDRESS + "\n\n" +
    "📝 Комментарий к переводу (обязательно):\n" + paymentComment + "\n\n" +
    "⏳ Счёт действует 30 минут. Переведи точную сумму и обязательно добавь комментарий. Premium начислится только после проверки подтверждённой транзакции.";
  const markup = { inline_keyboard: [
    [{ text: "🔄 Проверить оплату", callback_data: "gram:check:" + paymentId }],
    [{ text: "⬅️ К тарифам", callback_data: "premium:crypto" }],
    ...backMain,
  ]};
  if (messageId) await editScreen(chatId, messageId, text, markup);
  else await show(chatId, text, markup);
}

async function checkGramPayment(userId: number, paymentId: string, chatId: number) {
  const rows = await db("gram_payments?select=id,days,nano_amount,payment_comment,status,expires_at,telegram_id&id=eq." + encodeURIComponent(paymentId) + "&limit=1");
  const payment = rows?.[0];
  if (!payment || Number(payment.telegram_id) !== userId) {
    await show(chatId, "Платёж не найден.", mainKeyboardFor(userId));
    return;
  }
  if (payment.status === "paid") {
    await show(chatId, "✅ Этот платёж уже подтверждён. Premium начислен.", mainKeyboardFor(userId));
    return;
  }
  if (payment.status !== "pending" || new Date(payment.expires_at).getTime() < Date.now()) {
    await db("gram_payments?id=eq." + encodeURIComponent(paymentId), "PATCH", { status: "expired" });
    await show(chatId, "⌛ Срок счёта истёк. Создай новый платёж в разделе Premium.", { inline_keyboard: [[{ text: "Новый счёт", callback_data: "premium:crypto" }], ...backMain] });
    return;
  }
  const params = new URLSearchParams({ account: GRAM_RECEIVE_ADDRESS, limit: "100", sort: "desc" });
  const response = await fetch("https://toncenter.com/api/v3/transactions?" + params.toString(), {
    headers: { "X-API-Key": TONCENTER_API_KEY },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("TON Center отклонил API-ключ (ошибка " + response.status + "). Проверь секрет TONCENTER_API_KEY в Supabase: нужен действующий API key из личного кабинета TON Center, без пробелов и без кавычек.");
  }
  if (!response.ok) throw new Error("TON Center временно недоступен (" + response.status + "). Попробуй проверить ещё раз.");
  const data = await response.json();
  const txs = Array.isArray(data?.transactions) ? data.transactions : [];
  const expectedNano = BigInt(String(payment.nano_amount));
  const expectedComment = String(payment.payment_comment);
  const found = txs.find((tx: any) => {
    const msg = tx?.in_msg;
    const decoded = msg?.message_content?.decoded;
    const comment = decoded?.comment ?? decoded?.text ?? msg?.decoded_comment ?? "";
    const value = BigInt(String(msg?.value ?? "0"));
    value === expectedNano && String(comment) === expectedComment &&
      tx?.description?.aborted === false && tx?.description?.compute_ph?.success === true;
  });
  if (!found) {
    await show(chatId, "⏳ Пока не вижу подтверждённый перевод с нужной суммой и комментарием. Если ты уже оплатил, подожди немного и проверь снова.", {
      inline_keyboard: [[{ text: "🔄 Проверить ещё раз", callback_data: "gram:check:" + paymentId }], ...backMain],
    });
    return;
  }
  const txHash = String(found.hash ?? "");
  if (!txHash) throw new Error("В транзакции отсутствует hash. Обратись в поддержку.");
  const result = await db("rpc/credit_gram_payment", "POST", { p_payment_id: paymentId, p_tx_hash: txHash });
  if (result?.credited) {
    await show(chatId, "🎉 Оплата подтверждена!\n\n👑 Тебе начислено " + result.days + " дн. Premium. Спасибо за поддержку!", mainKeyboardFor(userId));
  } else if (result?.reason === "already_paid") {
    await show(chatId, "✅ Этот платёж уже был обработан. Premium начислен.", mainKeyboardFor(userId));
  } else {
    await show(chatId, "⚠️ Не удалось начислить Premium автоматически. Не отправляй повторный платёж — обратись в поддержку.", mainKeyboardFor(userId));
  }
}

async function showReferrals(userId: number, chatId: number) {
  const [profiles, referrals] = await Promise.all([
    db("profiles?select=referral_code,premium_referral_days,premium_until&telegram_id=eq." + userId + "&limit=1"),
    db("referrals?select=referred_id,reward_status,created_at&referrer_id=eq." + userId + "&order=created_at.asc&limit=1000"),
  ]);
  const p = profiles?.[0] ?? {};
  const code = p.referral_code;
  const link = code ? "https://t.me/usernamehunt1_bot?start=" + code : "Ссылка появится после /start";
  const list = Array.isArray(referrals) ? referrals : [];
  const invited = list.filter((x: any) => x.reward_status === "credited").length;
  const earnedDays = Number(p.premium_referral_days ?? 0);
  const progress = invited % 5;
  const left = progress === 0 ? 5 : 5 - progress;
  const premiumUntil = p.premium_until && new Date(p.premium_until).getTime() > Date.now()
    ? "\nТекущий Премиум действует до: " + new Date(p.premium_until).toLocaleDateString("ru-RU")
    : "";
  await show(chatId,
    "🎁 ПОЛУЧИТЬ ПРЕМИУМ БЕСПЛАТНО\n━━━━━━━━━━━━━━\n\n" +
    "Твоя реферальная ссылка:\n" + link +
    "\n\n👥 Приглашено друзей: " + invited +
    "\n👑 Дней Премиума получено: " + earnedDays +
    "\n\n🎯 Пригласи ещё " + left + " человек" + (left === 1 ? "а" : "") + " — получишь 1 день Премиума!" +
    "\nПрогресс: " + progress + "/5" +
    "\n\n💎 Дополнительно за каждого нового приглашённого — +3 поисковых запроса." +
    premiumUntil,
    {
      inline_keyboard: [
        [{ text: "📋 Скопировать ссылку", callback_data: "ref:copy" }],
        [{ text: "⬅️ Назад к Премиуму", callback_data: "menu:premium" }],
        ...backMain,
      ],
    }
  );
}


async function showTrapMenu(chatId: number, messageId?: number) {
  const text = "🎯 Ловушка\n━━━━━━━━━━━━━━\n\n💡 Понравился ник, но он занят?\nПоставь ловушку — я сохраню его и покажу в твоём списке.\n\n⏳ До 3 активных ловушек · срок 7 дней";
  const markup = { inline_keyboard: [
    [{ text: "🎯 Поставить ловушку", callback_data: "trap:add" }],
    [{ text: "📋 Мои ловушки", callback_data: "trap:list" }],
    [{ text: "⬅️ В меню поиска", callback_data: "menu:search" }],
    ...backMain,
  ]};
  if (messageId) await editScreen(chatId, messageId, text, markup);
  else await show(chatId, text, markup);
}

async function showMyTraps(userId: number, chatId: number) {
  await db("username_traps?status=eq.waiting&expires_at=lte." + encodeURIComponent(new Date().toISOString()) + "&telegram_id=eq." + userId, "PATCH", { status: "expired" });
  const rows = await db("username_traps?select=id,username,created_at,expires_at,status&telegram_id=eq." + userId + "&status=eq.waiting&expires_at=gt." + encodeURIComponent(new Date().toISOString()) + "&order=created_at.desc&limit=3");
  const traps = Array.isArray(rows) ? rows : [];
  if (!traps.length) {
    await show(chatId, "🎯 Мои ловушки\n━━━━━━━━━━━━━━\n\nℹ️ Пока пусто. Поставь первую ловушку на занятый ник.", {
      inline_keyboard: [[{ text: "🎯 Поставить ловушку", callback_data: "trap:add" }], [{ text: "⬅️ Назад", callback_data: "mode:trap" }], ...backMain],
    });
    return;
  }
  const lines = traps.map((t: any) => "🟢 @" + t.username + " · ждёт");
  const buttons = traps.map((t: any) => [{ text: "✖️ Удалить @" + t.username, callback_data: "trap:delete:" + t.id }]);
  await show(chatId, "🎯 Мои ловушки\n━━━━━━━━━━━━━━\n\n" + lines.join("\n") +
    "\n\n⏳ Ловушка действует 7 дней с момента создания.", {
    inline_keyboard: [...buttons, [{ text: "🎯 Поставить ещё", callback_data: "trap:add" }], [{ text: "⬅️ Назад", callback_data: "mode:trap" }], ...backMain],
  });
}

async function createTrapFromInput(userId: number, chatId: number, raw: string) {
  const username = raw.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) {
    await show(chatId, "⚠️ Неверный формат. Введи ник от 5 до 32 символов: английские буквы, цифры и _. Ник должен начинаться с буквы.", {
      inline_keyboard: [[{ text: "Отмена", callback_data: "mode:trap" }], ...backMain],
    });
    return;
  }
  const result = await db("rpc/create_username_trap", "POST", { p_telegram_id: userId, p_username: username });
  await clearSession(userId);
  if (result?.ok) {
    await show(chatId, "🎯 Ловушка поставлена!\n━━━━━━━━━━━━━━\n\n🟢 @" + username + " · ждёт\n⏳ Срок · 7 дней\n\nПосмотреть список можно в разделе «Мои ловушки».", {
      inline_keyboard: [[{ text: "📋 Мои ловушки", callback_data: "trap:list" }], [{ text: "🎯 Поставить ещё", callback_data: "trap:add" }], ...backMain],
    });
  } else if (result?.reason === "limit") {
    await show(chatId, "⛔ Уже есть 3 активные ловушки. Удали одну из списка или дождись окончания срока.", {
      inline_keyboard: [[{ text: "📋 Мои ловушки", callback_data: "trap:list" }], ...backMain],
    });
  } else if (result?.reason === "duplicate") {
    await show(chatId, "ℹ️ Ловушка на @" + username + " уже активна.", {
      inline_keyboard: [[{ text: "📋 Мои ловушки", callback_data: "trap:list" }], ...backMain],
    });
  } else {
    await show(chatId, "⚠️ Не удалось поставить ловушку. Проверь ник и попробуй ещё раз.", {
      inline_keyboard: [[{ text: "🎯 Повторить", callback_data: "trap:add" }], ...backMain],
    });
  }
}

async function handleMessage(message: any) {
  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = String(message.text ?? "").trim();
  if (message.successful_payment) return await handleSuccessfulStarsPayment(message);
  if (text.startsWith("/start")) return await handleStart(message);
  const session = await getSession(userId);
  if (!session) {
    await show(chatId, "Выбери режим в меню поиска, чтобы начать 👇", mainKeyboardFor(userId));
    return;
  }
  if (session.state.startsWith("await_admin_") && userId !== BOT_OWNER_ID) {
    await clearSession(userId);
    await show(chatId, "⛔ Нет доступа.", mainKeyboardFor(userId));
    return;
  }
  try {
    if (session.state === "await_admin_premium_user_id") {
      const targetId = Number(text);
      if (!/^\d+$/.test(text) || !Number.isSafeInteger(targetId) || targetId <= 0) {
        await show(chatId, "Введи корректный числовой ID профиля.", { inline_keyboard: [[{ text: "Отмена", callback_data: "admin:cancel" }], ...backMain] });
        return;
      }
      const target = await db("profiles?select=telegram_id&telegram_id=eq." + targetId + "&limit=1");
      if (!Array.isArray(target) || !target.length) {
        await show(chatId, "Профиль с ID " + targetId + " не найден. Отправь другой ID.", { inline_keyboard: [[{ text: "Отмена", callback_data: "admin:cancel" }], ...backMain] });
        return;
      }
      await setSession(userId, "await_admin_premium_minutes", { target_telegram_id: targetId });
      await show(chatId, "⏱ На сколько минут выдать Premium профилю " + targetId + "?\nВведи целое число от 1 до 525600 (до 1 года).", {
        inline_keyboard: [[{ text: "Отмена", callback_data: "admin:cancel" }], ...backMain],
      });
      return;
    }
    else if (session.state === "await_admin_premium_minutes") {
      const minutes = Number(text);
      const targetId = Number(session.payload?.target_telegram_id);
      if (!/^\d+$/.test(text) || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 525600) {
        await show(chatId, "Введи целое число минут от 1 до 525600.", { inline_keyboard: [[{ text: "Отмена", callback_data: "admin:cancel" }], ...backMain] });
        return;
      }
      if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new Error("Сессия выдачи Premium повреждена. Начни заново.");
      const until = await grantPremiumMinutes(targetId, minutes);
      await clearSession(userId);
      await show(chatId, "✅ Premium выдан!\n\n🆔 ID профиля · " + targetId + "\n⏱ Добавлено · " + minutes + " мин.\n👑 Действует до · " + new Date(until).toLocaleString("ru-RU"), {
        inline_keyboard: [[{ text: "Выдать ещё", callback_data: "admin:premium" }], ...backMain],
      });
      return;
    }
    else if (session.state === "await_trap_username") {
      await createTrapFromInput(userId, chatId, text);
    }
    else if (session.state === "await_premium_days") {
      const days = Number(text);
      await clearSession(userId);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        await show(chatId, "Введи целое число от 1 до 365.", {
          inline_keyboard: [[{ text: "⬅️ К тарифам", callback_data: "premium:crypto" }], ...backMain],
        });
        return;
      }
      await createGramPayment(userId, days, chatId);
    }
    else if (session.state === "await_word") await runSearch(userId, chatId, "word", { query: text });
    else if (session.state === "await_mask") await runSearch(userId, chatId, "mask", { query: text });
  } catch (error) {
    const retryCallback = session.state === "await_word" ? "mode:word"
      : session.state === "await_mask" ? "mode:mask"
      : session.state === "await_trap_username" ? "trap:add"
      : session.state.startsWith("await_admin_") ? "admin:premium"
      : "premium:crypto";
    await show(chatId, (error as Error).message + "\n\nПопробуй ещё раз или вернись в меню.", {
      inline_keyboard: [[{ text: "Повторить ввод", callback_data: retryCallback }], ...backMain],
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

  if (data === "admin:premium") {
    if (userId !== BOT_OWNER_ID) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Нет доступа", show_alert: true });
      return;
    }
    await setSession(userId, "await_admin_premium_user_id");
    await editScreen(chatId, messageId, "🛠 Выдача Premium по ID\n━━━━━━━━━━━━━━\n\nОтправь Telegram ID профиля, которому нужно выдать Premium.", {
      inline_keyboard: [[{ text: "Отмена", callback_data: "admin:cancel" }], ...backMain],
    });
    return;
  }
  if (data === "admin:cancel") {
    if (userId !== BOT_OWNER_ID) return;
    await clearSession(userId);
    await editScreen(chatId, messageId, "Выдача Premium отменена.", { inline_keyboard: [[{ text: "В меню", callback_data: "menu:home" }], ...backMain] });
    return;
  }

  if (data === "trap:add") {
    await setSession(userId, "await_trap_username");
    await editScreen(chatId, messageId, "📝 Какой ник ловим?\n━━━━━━━━━━━━━━\n\n✍️ Отправь юзернейм с @ или без — только английские буквы, цифры и _.", {
      inline_keyboard: [[{ text: "Отмена", callback_data: "mode:trap" }], ...backMain],
    });
    return;
  }
  if (data === "trap:list") { await showMyTraps(userId, chatId); return; }
  if (data.startsWith("trap:delete:")) {
    const trapId = data.slice("trap:delete:".length);
    await db("username_traps?id=eq." + encodeURIComponent(trapId) + "&telegram_id=eq." + userId, "PATCH", { status: "cancelled" });
    await showMyTraps(userId, chatId);
    return;
  }
  if (data === "menu:support") {
    await editScreen(chatId, messageId,
      "💬 ПОДДЕРЖКА\n━━━━━━━━━━━━━━\n\nЕсли возник вопрос или нужна помощь — напиши напрямую:",
      { inline_keyboard: [
        [{ text: "✉️ Написать в поддержку", url: "https://t.me/zdyet" }],
        [{ text: "⬅️ В главное меню", callback_data: "menu:main" }],
      ]}
    );
    return;
  }
  if (data === "premium:stars") { await showStars(userId, chatId, messageId); return; }
  if (data === "premium:crypto") { await showCrypto(userId, chatId, messageId); return; }
  if (data === "premium:gift") { await showGift(userId, chatId, messageId); return; }
  if (data === "premium:free") { await showReferrals(userId, chatId); return; }
  if (data === "gift:stars") { await showGiftStars(chatId, messageId); return; }
  if (data === "gift:list") { await showMyGifts(chatId, messageId); return; }
  if (data.startsWith("stars:plan:")) {
    const days = Number(data.split(":")[2]);
    if ([1,2,4].includes(days)) await createStarsInvoice(userId, chatId, days);
    return;
  }
  if (data.startsWith("crypto:plan:")) {
    const days = Number(data.split(":")[2]);
    if ([1,3,7,30].includes(days)) await createGramPayment(userId, days, chatId, messageId);
    return;
  }
  if (data.startsWith("gram:check:")) {
    try {
      await checkGramPayment(userId, data.slice("gram:check:".length), chatId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось проверить платёж.";
      await editScreen(chatId, messageId, "⚠️ ПРОВЕРКА ОПЛАТЫ\n━━━━━━━━━━━━━━\n\n" + message, {
        inline_keyboard: [[{ text: "🔄 Повторить проверку", callback_data: data }], [{ text: "⬅️ К тарифам", callback_data: "premium:crypto" }], ...backMain],
      });
    }
    return;
  }
  if (data === "crypto:custom") {
    await setSession(userId, "await_premium_days", { kind: "crypto_custom_days" });
    await editScreen(chatId, messageId, "✍️ Введи количество дней Премиума числом (от 1 до 365).\n\nПокажу стоимость. Оплата будет подключена следующим этапом.", {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "premium:crypto" }], ...backMain],
    });
    return;
  }
  if (data.startsWith("gift:plan:")) {
    const days = Number(data.split(":")[2]);
    if ([3,7,30].includes(days)) await showPaymentPending(chatId, messageId, "🎁 Подарок выбран", days + " дн. Премиума · $" + (0.35 * days).toFixed(2), "premium:gift");
    return;
  }
  if (data.startsWith("gift:stars:")) {
    const stars = Number(data.split(":")[2]);
    if ([25,50,100].includes(stars)) await showPaymentPending(chatId, messageId, "🎁 Подарок звёздами выбран", stars + " ⭐ · " + (stars/25) + " дн. Премиума", "gift:stars");
    return;
  }
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
    await show(chatId, "Твоя реферальная ссылка:\n" + link, {
      inline_keyboard: code ? [[{ text: "Открыть бота", url: link }], ...backMain] : backMain,
    });
    return;
  }

  let view: { text: string; reply_markup: unknown } | null = null;
  switch (data) {
    case "menu:home":
      view = screen("Skebob Username — главное меню\n\nВыбери раздел 👇", mainKeyboardFor(userId)); break;
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
      await showTrapMenu(chatId, messageId); return;
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
    case "menu:premium":
      await showPremium(userId, chatId, messageId); return;
    case "menu:profile":
      await profileScreen(userId, chatId); return;
    case "profile:history":
      await showHistory(userId, chatId); return;
    case "profile:favorites":
      await showFavorites(userId, chatId); return;
    case "menu:referrals":
      await showReferrals(userId, chatId); return;
    case "menu:settings":
      await showSearchSettings(userId, chatId, messageId); return;
    case "settings:mode:readable":
      await setSearchMode(userId, "readable");
      await showSearchSettings(userId, chatId, messageId); return;
    case "settings:mode:random":
      await setSearchMode(userId, "random");
      await showSearchSettings(userId, chatId, messageId); return;
    default:
      view = screen("Неизвестная команда. Вернись в меню.", mainKeyboardFor(userId));
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
        allowed_updates: ["message", "callback_query", "pre_checkout_query"], drop_pending_updates: false,
      }),
    });
    const result = await response.json();
    return Response.json(result, { status: response.ok ? 200 : 502 });
  }

  try {
    const update = await req.json();
    if (update.pre_checkout_query) await handlePreCheckout(update.pre_checkout_query);
    else if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
});
