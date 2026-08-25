# Sqawe v0.1

Минимальная Telegram Mini App — фотолента внутри Telegram.

## Что уже есть

- Telegram Mini App frontend
- Проверка Telegram `initData` на backend
- Автоматическое создание профиля пользователя
- Лента фотографий
- Загрузка фото + подпись
- Лайки
- Профиль пользователя
- SQLite
- Простая адаптивная тёмная стилистика Sqawe

## Требования

- Python 3.10+
- Telegram Bot Token
- Публичный HTTPS-адрес для Mini App при работе внутри Telegram

## Запуск локально

```bash
python -m venv .venv
```

Windows:
```bash
.venv\Scripts\activate
```

macOS/Linux:
```bash
source .venv/bin/activate
```

Установка:

```bash
pip install -r requirements.txt
```

Создай `.env` на основе `.env.example`:

```env
BOT_TOKEN=токен_бота
```

Запуск:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Открой:

http://127.0.0.1:8000

## Подключение к Telegram

1. Создай/используй бота через BotFather.
2. Размести приложение на сервере с HTTPS.
3. В BotFather укажи URL Mini App.
4. В PuzzleBot добавь кнопку/ссылку на URL Mini App или используй inline/web-app кнопку, если она доступна в твоей конфигурации.

Важно: Telegram Mini App внутри Telegram должен открываться по HTTPS.

## Структура

```text
app/
  main.py
  db.py
  telegram_auth.py
  static/
    index.html
    app.js
    styles.css
uploads/
requirements.txt
.env.example
```

Это именно v0.1: без подписок, комментариев, модерации, облачного хранения и продвинутой защиты от спама.
