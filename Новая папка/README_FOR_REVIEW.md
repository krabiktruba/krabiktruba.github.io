# COMIND SOON — проект для проверки

## Назначение

Кроссплатформенное приложение игрового сообщества:
- Windows Desktop — Electron;
- Android — Capacitor;
- Backend — FastAPI;
- Database — SQLite;
- Frontend — React, TypeScript, Vite.

## 1. Первый запуск Windows

Открой PowerShell в корне проекта:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\START_WINDOWS.ps1
```

Сценарий подготовит Python-окружение, установит зависимости,
установит npm-пакеты, запустит Backend и Desktop-приложение.

Необходимы Python 3.14, Node.js и npm.

Если в проекте используется другой поддерживаемый Python,
измени версию в START_WINDOWS.ps1.

## 2. Ручной запуск Backend

```powershell
cd backend
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

API:
http://127.0.0.1:8000

Документация API:
http://127.0.0.1:8000/docs

Проверка:
http://127.0.0.1:8000/api/health

## 3. Запуск Frontend и Desktop

Во втором терминале:

```powershell
cd frontend
npm ci
npm run desktop
```

Если package-lock.json отсутствует, вместо npm ci используй npm install.

## 4. Android

После установки npm-зависимостей:

```powershell
cd frontend
npm run android:sync
npm run android:open
```

Далее проект можно открыть и запустить через Android Studio.

## 5. Структура проекта

backend/
  app/
    api/routes/       API-маршруты
    core/             Конфигурация, безопасность, БД
    schemas/          Модели запросов и ответов
    main.py           Точка входа FastAPI
  comind_soon.db      SQLite-база

frontend/
  src/
    App.tsx            Авторизация и вход
    MainWindow.tsx     Основной интерфейс приложения
    MainWindow.css     Основные стили
    DirectMessages.tsx Личные сообщения
    VoiceRoom.tsx      Голосовые комнаты
  android/             Android-проект Capacitor
  package.json         Зависимости и команды
  package-lock.json    Зафиксированные npm-зависимости

## 6. Данные

База данных находится в backend/comind_soon.db.
Backend использует SQLite и создаёт необходимые таблицы при запуске.

База перенесена из исходного проекта. Она может содержать
пользовательские данные и тестовые учётные записи.
Перед публичной передачей проверь, какие данные в ней находятся.

## 7. Важное

Папки виртуальных окружений, node_modules, кэши и результаты
сборки не включены. Они создаются заново при подготовке проекта.

Файлы .env с секретами не переносятся.
Шаблоны переменных окружения имеют суффикс .env.example.

Для работы необходимы доступ к npm и Python package index
при первой установке зависимостей.