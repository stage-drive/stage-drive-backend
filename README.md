# Stage Drive Backend

Бекенд-сервіс платформи для управління автошколами.

Проєкт побудований на фреймворку NestJS, використовує PostgreSQL як основну базу даних, Prisma ORM для роботи з даними та Docker Compose для запуску локального середовища. На поточному етапі це базова каркасна структура проєкту: є підключення Prisma, стартові модулі auth та users, але бізнес-логіка і API ще не завершені.

---

##  Технологічний стек

- Framework: NestJS (Node.js + TypeScript)
- Database: PostgreSQL 16
- ORM: Prisma
- Database migrations: Liquibase
- Containerization: Docker Compose
- Testing: Jest

> Swagger / OpenAPI наразі не налаштований у проєкті, тому маршрут документації не доступний за замовчуванням.

---

##  Запуск проєкту

### 1. Попередні вимоги

Переконайтеся, що у вас встановлено:

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

### 3. Встановлення залежностей

```bash
npm install
```

### 4. Налаштування змінних оточення

Створіть файл `.env` у корені проєкту:

```env
PORT=3000
DATABASE_URL="postgresql://postgres:postgres_password@localhost:5432/stage_drive?schema=public"
```

### 5. Запуск PostgreSQL через Docker

```bash
docker compose up -d
```

### 6. Генерація Prisma Client

```bash
npx prisma generate
```

### 7. Запуск NestJS у режимі розробки

```bash
npm run start:dev
```

Якщо запуск успішний, сервер буде доступний за адресою:

- http://localhost:3000

---
*Перегляд таблиць бази даних у браузері*: 
виконайте в іншому вікні термінала

```bash
npx prisma studio 
```


##  Робота з базою даних

У цьому проєкті логіка роботи з БД розподілена так:

- Liquibase: відповідає за структуру БД та міграції через XML-чанжлоги в папці `liquibase/`
- Prisma: використовується як типобезпечний ORM для CRUD-операцій з коду NestJS

Корисні команди:

```bash
npx prisma generate
npx prisma studio
```

`prisma studio` відкриває веб-інтерфейс для перегляду даних локальної БД.

> На поточному етапі у `prisma/schema.prisma` ще не описано моделей бази даних, тому для реальної роботи з таблицями потрібно спочатку визначити схему та виконати міграції.

---

##  Структура проєкту

```text
stage-drive-backend/
├── generated/            # Згенерований Prisma Client
├── liquibase/            # XML-міграції Liquibase
├── prisma/               # Prisma schema та конфігурація ORM
├── src/
│   ├── app.controller.ts
│   ├── app.module.ts
│   ├── app.service.ts
│   ├── main.ts
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.module.ts
│   │   │   └── auth.service.ts
│   │   └── users/
│   │       ├── users.controller.ts
│   │       ├── users.module.ts
│   │       └── users.service.ts
│   └── prisma/
│       ├── prisma.module.ts
│       └── prisma.service.ts
├── docker-compose.yml    # Конфігурація PostgreSQL
├── package.json
├── prisma.config.ts
├── tsconfig.json
├── .env.example          # приклад змінних оточення (якщо додається)
├── README.md
└── ...
```

---

##  Поточний статус проєкту

На даний момент проєкт знаходиться на етапі базової інтеграції:

- налаштований NestJS
- підключений Prisma
- визначено Docker Compose для PostgreSQL
- є стартові модулі `auth` та `users`
- повноцінний функціонал платформи ще розробляється

---

##  Git workflow та правила розробки

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

##  Git cheat sheet

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