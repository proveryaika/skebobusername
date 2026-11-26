import asyncio
import logging
import os

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN is not set. Add it to your environment variables.")


def main_menu_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="🔍 поиск", callback_data="menu:search"),
            InlineKeyboardButton(text="👤 профиль", callback_data="menu:profile"),
        ],
        [
            InlineKeyboardButton(text="👥 реферальная программа", callback_data="menu:referrals"),
        ],
        [
            InlineKeyboardButton(text="👑 премиум", callback_data="menu:premium"),
            InlineKeyboardButton(text="💬 поддержка", callback_data="menu:support"),
        ],
    ])


def search_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="5 букв", callback_data="search:5"),
            InlineKeyboardButton(text="6 букв", callback_data="search:6"),
        ],
        [
            InlineKeyboardButton(text="по маске", callback_data="search:mask"),
            InlineKeyboardButton(text="по слову", callback_data="search:word"),
        ],
        [
            InlineKeyboardButton(text="ловушка", callback_data="search:trap"),
            InlineKeyboardButton(text="настройки", callback_data="search:settings"),
        ],
        [InlineKeyboardButton(text="главное меню", callback_data="menu:home")],
    ])


def five_chars_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="с цифрами", callback_data="format:5:digits"),
            InlineKeyboardButton(text="без цифр", callback_data="format:5:letters"),
        ],
        [InlineKeyboardButton(text="назад", callback_data="menu:search")],
    ])


def home_text() -> str:
    return "Skebob Username - главное меню\n\nвыберите раздел 👇"


SEARCH_TEXT = (
    "🔍 Поиск юзернеймов\n"
    "━━━━━━━━━━━━━━\n\n"
    "🚀 Твой юзернейм уже ждёт.\n"
    "🎯 Выбери, как его искать.\n\n"
    "👇 Режимы поиска"
)

FIVE_TEXT = (
    "📝 Ник из 5 символов\n"
    "━━━━━━━━━━━━━━\n\n"
    "🔢 С цифрами — например ab1cd\n"
    "🔤 Без цифр — только буквы\n\n"
    "👇 Выбери формат"
)


async def show_home(target: Message | CallbackQuery) -> None:
    if isinstance(target, CallbackQuery):
        await target.message.edit_text(home_text(), reply_markup=main_menu_keyboard())
        await target.answer()
    else:
        await target.answer(home_text(), reply_markup=main_menu_keyboard())


async def main() -> None:
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()

    @dp.message(CommandStart())
    async def start(message: Message) -> None:
        await message.answer(home_text(), reply_markup=main_menu_keyboard())

    @dp.callback_query(F.data == "menu:home")
    async def go_home(callback: CallbackQuery) -> None:
        await show_home(callback)

    @dp.callback_query(F.data == "menu:search")
    async def open_search(callback: CallbackQuery) -> None:
        await callback.message.edit_text(SEARCH_TEXT, reply_markup=search_keyboard())
        await callback.answer()

    @dp.callback_query(F.data == "search:5")
    async def open_five_chars(callback: CallbackQuery) -> None:
        await callback.message.edit_text(FIVE_TEXT, reply_markup=five_chars_keyboard())
        await callback.answer()

    @dp.callback_query(F.data.startswith("format:5:"))
    async def choose_five_format(callback: CallbackQuery) -> None:
        selected = callback.data.rsplit(":", 1)[-1]
        label = "с цифрами" if selected == "digits" else "без цифр"
        await callback.message.edit_text(
            f"✅ Формат выбран: {label}\n\nСледующий шаг настройки поиска скоро появится.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="назад", callback_data="search:5")],
                [InlineKeyboardButton(text="главное меню", callback_data="menu:home")],
            ]),
        )
        await callback.answer()

    @dp.callback_query(F.data.startswith("search:"))
    async def other_search_modes(callback: CallbackQuery) -> None:
        await callback.answer("Этот режим пока в разработке.", show_alert=True)

    @dp.callback_query(F.data.startswith("menu:"))
    async def other_menu_sections(callback: CallbackQuery) -> None:
        await callback.answer("Этот раздел пока в разработке.", show_alert=True)

    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
