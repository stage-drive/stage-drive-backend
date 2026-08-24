# Stage Drive Backend

Бекенд-сервіс платформи для управління автошколами.

Проєкт побудований на NestJS, використовує PostgreSQL як основну базу даних і Prisma ORM. Застосунок пакується в Docker-образ і запускається контейнером. У продакшені база даних працює на окремій віртуальній машині (VM); локально PostgreSQL можна підняти через Docker Compose.

---

## Технологічний стек

- Framework: NestJS (Node.js + TypeScript)
- Database: PostgreSQL 16
- ORM: Prisma
- Database migrations: Prisma Migrate
- Containerization: Docker, Docker Compose
- Testing: Jest

Swagger UI доступний за адресою http://localhost:3000/api/docs після запуску сервера.

---

## Змінні середовища

Скопіюйте приклад і за потреби змініть значення:

```bash
cp .env.example .env
```

| Змінна | Призначення |
| --- | --- |
| `PORT` | Порт HTTP-сервера (за замовчуванням `3000`) |
| `NODE_ENV` | `development` або `production` |
| `AUTH_SECRET` | Секрет підпису access/refresh токенів |
| `DATABASE_URL` | Підключення до PostgreSQL для команд на хості (`npm run start:dev`, Prisma CLI) |
| `DOCKER_DATABASE_URL` | Підключення для контейнерів `backend` і `migrate` (хост — ім'я сервісу `postgres`) |
| `POSTGRES_USER` | Користувач локального контейнера PostgreSQL |
| `POSTGRES_PASSWORD` | Пароль локального контейнера PostgreSQL |
| `POSTGRES_DB` | Назва локальної бази |
| `POSTGRES_PORT` | Порт локального PostgreSQL на хості |

Для віддаленої БД на VM замість localhost вкажіть хост віртуальної машини, наприклад:

```env
DATABASE_URL=postgresql://USER:PASSWORD@VM_HOST:5432/stage_drive
DOCKER_DATABASE_URL=postgresql://USER:PASSWORD@VM_HOST:5432/stage_drive
```

Файл `.env` не комітиться в git.

---

## Запуск проєкту

### 1. Попередні вимоги

1. Node.js 18+
2. npm
3. Docker Desktop
4. Git

---

### 2. Клонування репозиторію

```bash
git clone https://github.com/stage-drive/stage-drive-backend.git
cd stage-drive-backend
```

### 3. Локальний запуск через Docker Compose (рекомендовано)

Піднімає PostgreSQL, застосовує Prisma-міграції і стартує backend:

```bash
cp .env.example .env
docker compose up --build
```

Сервіси:

- `postgres` — локальна PostgreSQL (для розробки; у продакшені БД на VM)
- `migrate` — одноразове застосування `prisma migrate deploy`
- `backend` — NestJS API з образу `Dockerfile`

Після старту:

- http://localhost:3000
- http://localhost:3000/api/docs (Swagger UI)

Зупинити:

```bash
docker compose down
```

Дані БД зберігаються у volume `pgdata`, файли завантажень — у volume `uploads`.

---

### 4. Запуск NestJS на хості (без контейнера backend)

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npx prisma generate
npm run db:migrate:deploy
npm run start:dev
```

У цьому режимі `DATABASE_URL` має вказувати на `localhost`, бо Prisma і Nest працюють поза Docker-мережею.

Перегляд таблиць:

```bash
npx prisma studio
```

---

## Робота з базою даних і міграції

Структура схеми описана в `prisma/schema.prisma`. SQL-міграції лежать у `prisma/migrations/` і застосовуються командою `prisma migrate deploy`. Вона ідемпотентна: накатує лише ще не застосовані міграції і підходить для CI/CD та віддаленої БД.

Корисні команди (потрібен `DATABASE_URL`):

```bash
npm run db:generate         # згенерувати Prisma Client
npm run db:migrate          # нова міграція під час розробки
npm run db:migrate:deploy   # застосувати наявні міграції
npm run db:migrate:status   # статус міграцій
npm run db:seed             # демо-дані
npx prisma studio
```

### Міграції до PostgreSQL на віддаленій VM

Prisma застосовує міграції з машини, де запущено CLI або контейнер `migrate`. База на VM не повинна стояти в Docker: достатньо мережевого доступу за `DATABASE_URL`.

1. На VM встановіть PostgreSQL, створіть користувача і базу (`stage_drive`).
2. Відкрийте порт `5432` лише з мережі, де крутиться backend (приватна мережа / VPN / security group), а не з усього інтернету.
3. У `.env` (або в змінних CI) вкажіть URL віддаленої БД.
4. Застосуйте міграції одним із способів:

З хоста розробки або з CI:

```bash
npm run db:migrate:deploy
```

З Docker-образу, без локального контейнера `postgres` (`--no-deps`):

```bash
docker compose run --rm --no-deps \
  -e DATABASE_URL="postgresql://USER:PASSWORD@VM_HOST:5432/stage_drive" \
  migrate
```

Або в одному контейнері backend разом із стартом:

```bash
docker run --rm \
  -e DATABASE_URL="postgresql://USER:PASSWORD@VM_HOST:5432/stage_drive" \
  -e AUTH_SECRET="your-secret" \
  -e RUN_MIGRATIONS=true \
  -p 3000:3000 \
  stage-drive-backend
```

`RUN_MIGRATIONS=true` змушує entrypoint виконати `prisma migrate deploy` перед `node dist/main.js`. У Compose міграції винесені в окремий сервіс `migrate`, тому для `backend` цей прапорець не потрібен.

Порядок деплою: спочатку міграції, потім (або одразу після успішного `migrate`) запуск backend. Не застосовуйте `prisma migrate dev` до продакшен-БД — ця команда для локальної розробки.

Якщо база вже не порожня, а історія Prisma ще не велася, `migrate deploy` поверне помилку `P3005`. Для нової VM створюйте порожню базу і накатуйте міграції з нуля. Для вже існуючої схеми спочатку зафіксуйте baseline (`prisma migrate resolve`), щоб Prisma вважала поточний стан застосованим, і лише тоді використовуйте `migrate deploy` для наступних змін.

---

## Docker-образ backend

```bash
docker build -t stage-drive-backend .
```

Образ збирається multi-stage: встановлення залежностей, `prisma generate`, `nest build`, далі runtime на Node 22 Alpine. Точка входу — `docker-entrypoint.sh`.

---

## Структура проєкту

```text
stage-drive-backend/
├── prisma/
│   ├── migrations/       # SQL-міграції Prisma
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── app.controller.ts
│   ├── app.module.ts
│   ├── app.service.ts
│   ├── main.ts
│   ├── modules/
│   └── prisma/
├── docker-compose.yml    # postgres, migrate, backend
├── Dockerfile
├── docker-entrypoint.sh
├── .env.example
├── package.json
├── prisma.config.ts
├── tsconfig.json
└── README.md
```

---

## Поточний статус проєкту

- налаштований NestJS
- підключений Prisma
- Docker-образ і Compose для локального запуску
- міграції Prisma можна накатувати на локальну або віддалену PostgreSQL
- є модулі `auth`, `users`, `organization`

---

## Git workflow та правила розробки

Основні гілки:

- `main` — стабільна релізна версія
- `develop` — основна гілка розробки

Робочі гілки:

- `feature/*` — новий функціонал
- `fix/*` — виправлення помилок
- `refactor/*` — рефакторинг
- `chore/*` — технічні зміни

Правила:

1. Не працювати напряму в `main` або `develop`.
2. Створювати гілку від `develop`.
3. Після завершення задачі перевіряти локально `npm run lint` і `npm run build`.
4. Відкрити Pull Request у `develop`.
5. Отримати підтвердження від іншого розробника перед merge.

Формат назви гілки:

```text
feature/AUTH-01-login
fix/SCH-05-create-lesson
```

---

## Git cheat sheet

```bash
# Перейти на develop
git checkout develop
git pull origin develop

# Створити нову feature-гілку
git checkout -b feature/AUTH-01-login

# Перевірити статус
git status

# Додати зміни
git add .

# Зробити коміт
git commit -m "feat(auth): add login endpoint with jwt"

# Вивантажити гілку
git push -u origin feature/AUTH-01-login
```

Перед PR обов'язково виконайте:

```bash
npm run lint
```
