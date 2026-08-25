# Сесії (login/refresh/logout) — що реалізовано

Продовжує [registration.md](registration.md) — покриває частину session lifecycle з Module: Auth ([CLAUDE.md](../CLAUDE.md)): `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`. Код — [auth.service.ts](../src/modules/auth/auth.service.ts) / [auth.controller.ts](../src/modules/auth/auth.controller.ts).

> Password recovery (`forgot-password` / `reset-password`) свідомо не в цьому переліку — реалізацію відкотили, бо без поштового провайдера ендпоінт нефункціональний (нема кому доставити токен), а нефункціональний ендпоінт у Swagger вводить фронтенд в оману. Повна реалізація збережена на гілці `feat/password-reset` і буде домержена разом із додаванням mail-провайдера.

## Два різні типи токенів

- **`accessToken`** — звичайний JWT (`jwtService.signAsync({ sub: userId })`), підписаний `JWT_ACCESS_SECRET`, TTL 7 днів ([auth.module.ts](../src/modules/auth/auth.module.ts)). На кожному захищеному запиті [`JwtStrategy`](../src/modules/auth/strategies/jwt.strategy.ts) підвантажує користувача з БД заново за `payload.sub` — сам JWT не несе нічого, крім `sub`.
- **`refreshToken`** — **не JWT**. Формат `id.secret`: `id` — рядок таблиці `RefreshToken`, `secret` — випадкові 32 байти, у БД зберігається лише bcrypt-хеш секрету (`issueTokens()`).

Чому не обидва JWT: `refreshToken` живе 30 днів і мусить бути миттєво відкличним (logout). JWT без окремого чорного списку відкликати не можна, тому для довгоживучого токена обрано зберігання хеша в БД, а не підпис.

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

## Ендпоінти

Усі, крім `login`/`register`, повертають `204 No Content` без тіла:

```
POST /auth/login    { email, password }  → { accessToken, tokenType }
POST /auth/refresh  { refreshToken }     → 204 (нова пара токенів, HttpCode стоїть як 204 — існуюча неузгодженість, не чіпав)
POST /auth/logout   { refreshToken }     → 204
```

## Що свідомо не зроблено

- **`UserStatus` не перевіряється** при `login`/`refresh` (див. вище) — `BLOCKED`/`ARCHIVED` користувачі досі мають доступ.
- **Каскадне відкликання сім'ї refresh-токенів** при повторному використанні вже відкликаного токена.
- **Очищення прострочених `RefreshToken`** — прострочені рядки не видаляються, лише ігноруються при перевірці.
- **Password recovery** — див. примітку на початку файлу.
