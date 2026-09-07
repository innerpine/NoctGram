# Совместная разработка Noctgram

Репозиторий: https://github.com/innerpine/NoctGram

## Доступ друга

Владелец открывает **Settings → Collaborators → Add people**, вводит GitHub-ник друга и отправляет приглашение. Друг принимает его из GitHub или письма. Для работы с приватным репозиторием каждый входит в собственный аккаунт GitHub.

## Первый запуск

Нужны Git и Node.js 22.13 или новее. Команды ниже — для PowerShell:

```powershell
git clone https://github.com/innerpine/NoctGram.git
cd NoctGram
npm ci
Copy-Item .env.example .env
```

Для **новой пустой локальной базы** один раз применить миграции:

```powershell
Get-ChildItem -Path drizzle -Filter *.sql | Sort-Object Name | ForEach-Object {
  npx wrangler d1 execute DB --local --config wrangler.local.json --file $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Не удалось применить $($_.Name)" }
}
npm run dev
```

Откройте http://localhost:3000. Сначала можно пользоваться локальным входом Sites. Почтовый вход настраивается отдельно по [AUTH_SETUP.md](AUTH_SETUP.md): значения находятся в личном `.env` каждого разработчика. Реальные ключи нельзя добавлять в коммиты, задачи или Pull Requests.

Каждая копия проекта использует собственную локальную D1-базу и R2-хранилище в `.wrangler/`. Пользователи, письма, сессии, загруженные медиа и локальные посты через Git не синхронизируются. Данные на одном компьютере не появятся автоматически на другом. Файлы в `tests/fixtures/` — искусственные тестовые данные; их нельзя применять к рабочей базе.

## Работа над изменениями

Начинайте с актуального `main` и отдельной ветки:

```powershell
git switch main
git pull --ff-only
git switch -c feature/chat-improvements
```

После изменений:

```powershell
npx tsc --noEmit
npm run lint
npm run build
git add <изменённые-файлы>
git commit -m "Improve chat interactions"
git push -u origin feature/chat-improvements
```

На GitHub создайте **Pull Request в main**. Второй разработчик проверяет изменения и объединяет их. Для своей задачи выбирайте свободное имя ветки. Перед переключением веток сохраните или закоммитьте текущие изменения.

После получения чужих изменений запустите `npm ci`, если изменился `package-lock.json`. Новые SQL-миграции применяйте по порядку, **только ещё не выполненные**. Уже применённые миграции не редактируйте и не запускайте повторно. Проверки API описаны в [README.md](README.md); для них используется отдельная тестовая база.

## Что сохранять

- Исходный код, пользовательские графические ассеты, миграции и `package-lock.json` входят в Git.
- `.env`, `.dev.vars`, `.wrangler`, `node_modules`, `dist`, `work` и `outputs` исключены через `.gitignore`.
- Актуальный стиль и ограничения маскота описаны в [DESIGN.md](DESIGN.md); будущие функции — в [TODO.md](TODO.md).
- Загрузка кода на GitHub не публикует приложение. Общий адрес приложения и рабочая база настраиваются отдельно.

## Новые функции общения

После миграции 0007 выполнить `npm run setup:realtime`, затем держать отдельно `npm run dev` и `npm run dev:jobs`. Настройка общего сервера, TURN, push и проверка устройств описаны в [REALTIME_SETUP.md](REALTIME_SETUP.md). Локальные базы двух разработчиков остаются независимыми.
