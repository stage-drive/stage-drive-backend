# Сесії (login/refresh/logout) та відновлення пароля — що реалізовано

Продовжує [registration.md](registration.md) — покриває решту Module: Auth з [CLAUDE.md](../CLAUDE.md) («session lifecycle, token management, password recovery»): `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/forgot-password`, `POST /auth/reset-password`. Код — [auth.service.ts](../src/modules/auth/auth.service.ts) / [auth.controller.ts](../src/modules/auth/auth.controller.ts).

## Два різні типи токенів

- **`accessToken`** — звичайний JWT (`jwtService.signAsync({ sub: userId })`), підписаний `JWT_ACCESS_SECRET`, TTL 7 днів ([auth.module.ts](../src/modules/auth/auth.module.ts)). На кожному захищеному запиті [`JwtStrategy`](../src/modules/auth/strategies/jwt.strategy.ts) підвантажує користувача з БД заново за `payload.sub` — сам JWT не несе нічого, крім `sub`.
- **`refreshToken`** — **не JWT**. Формат `id.secret`: `id` — рядок таблиці `RefreshToken`, `secret` — випадкові 32 байти, у БД зберігається лише bcrypt-хеш секрету (`issueTokens()`). Той самий підхід повторно використано для `PasswordResetToken` (нижче) — в обох випадках токен має `expiresAt` і одноразовість (`revokedAt` / `usedAt`).

Чому не обидва JWT: `refreshToken` живе 30 днів і мусить бути миттєво відкличним (logout, зміна пароля). JWT без окремого чорного списку відкликати не можна, тому для довгоживучих токенів обрано зберігання хеша в БД, а не підпис.

## `login`

Звіряє bcrypt-хеш пароля з `user.passwordHash`, при збігу видає нову пару токенів (`issueTokens`).

**Відомий пробіл:** `login()` не перевіряє `user.status`. Користувач у статусі `BLOCKED`/`ARCHIVED` (енум із CLAUDE.md) зараз усе одно може залогінитись і отримати токени — перевірки статусу немає ні в `login`, ні в `refresh`, ні в `JwtStrategy.validate()`. Це поза межами задачі, яку я робив, але варто мати на увазі як наступний крок для RBAC/tenant isolation з CLAUDE.md.

## `refresh` — ротація refresh-токена

`refresh(refreshToken)`:
1. `validateRefreshToken()` — знаходить рядок за `id`, перевіряє, що не відкликаний і не протух, звіряє `secret` з хешем.
2. Якщо валідний — одразу відкликає (`revokedAt`) саме цей рядок і видає **нову** пару access+refresh.

Це повна ротація (rotate-on-use), а не повторне використання одного refresh-токена. Якщо вже відкликаний токен спробують використати повторно — `validateRefreshToken` поверне `null` → `401`, але **каскадного відкликання всієї "сім'ї" токенів при виявленні повторного використання немає** (типова додаткова абсорбція крадіжки токена в rotation-схемах) — цього захисту зараз нема.

## `logout`

Відкликає (`revokedAt`) конкретний переданий `refreshToken`. Якщо токен уже невалідний/не знайдений — тихо повертає `void` без помилки: логаут з точки зору клієнта завжди «успішний».

## `forgot-password`

- Шукає користувача за email.
- **Якщо не знайдено — відповідь однаково `204`, без токена.** Навмисно: інакше різниця у відповіді (є токен / немає) дозволяла б перевіряти, які email зареєстровані (user enumeration).
- Якщо знайдено — генерує секрет (`randomBytes(32)`), зберігає bcrypt-хеш у `PasswordResetToken` з TTL 1 година (`RESET_TOKEN_TTL_MS`), токен у форматі `id.secret` — як і `refreshToken`.
- **Лист не надсилається.** У проєкті ще немає поштового провайдера (ні `nodemailer`, ні SMTP env-змінних), тому токен зараз виводиться в `console.log`. Це тимчасовий стаб — рядок з `console.log` буде єдиним місцем, яке треба замінити на виклик реального mail-сервісу.

## `reset-password`

- Розбирає токен на `id` + `secret`, шукає `PasswordResetToken`.
- Відхиляє (`400`) в усіх випадках **однаковим повідомленням** «Посилання для скидання пароля недійсне або застаріле.» — токен не знайдено, вже використаний, протух чи секрет не збігається. Одне повідомлення на всі причини, щоб відповідь не підказувала зловмиснику причину відмови.
- Якщо валідний — в одній `prisma.$transaction`:
  1. оновлює `passwordHash`;
  2. позначає `PasswordResetToken.usedAt` (одноразовість);
  3. відкликає **всі** активні `refreshToken` користувача — це «Forced revocation of active sessions» з CLAUDE.md: зміна пароля примусово завершує всі раніше залогінені сесії.

## Ендпоінти

Усі, крім `login`/`register`, повертають `204 No Content` без тіла:

```
POST /auth/login              { email, password }        → { accessToken, tokenType }
POST /auth/refresh             { refreshToken }            → 204 (нова пара токенів, HttpCode стоїть як 204 — існуюча неузгодженість, не чіпав)
POST /auth/logout              { refreshToken }            → 204
POST /auth/forgot-password     { email }                   → 204
POST /auth/reset-password      { token, newPassword, newPasswordConfirmation } → 204
```

## Що свідомо не зроблено

- **`UserStatus` не перевіряється** при `login`/`refresh` (див. вище) — `BLOCKED`/`ARCHIVED` користувачі досі мають доступ.
- **Реальна відправка листа** для `forgot-password` — немає mail-провайдера в проєкті.
- **Rate limiting** на `forgot-password` — ендпоінт можна викликати без обмежень для одного email.
- **Каскадне відкликання сім'ї refresh-токенів** при повторному використанні вже відкликаного токена.
- **Очищення прострочених токенів** (`RefreshToken`, `PasswordResetToken`) — прострочені рядки не видаляються, лише ігноруються при перевірці.
