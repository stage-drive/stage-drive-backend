# Auth/Prisma аудит — що виправлено, видалено і чому

Точковий прохід по [Auth-модулю](../CLAUDE.md) після рев'ю `prisma/schema.prisma` + `src/modules/auth/`. Це не нова фіча — набір виправлень багів і прибирання мертвого коду, знайдених під час аналізу. Список пунктів навмисно пронумерований так, як обговорювались.

> **Неузгодженість із документацією:** [sessions.md](sessions.md) описує `POST /auth/refresh`, `POST /auth/logout`, refresh-токен формату `id.secret` з bcrypt-хешем у БД та `JwtStrategy`, що перевіряє `JWT_ACCESS_SECRET`. У поточному коді нічого з цього немає: `token.ts` видає й `access`, і `refresh` як самопідписані HMAC-токени без запису в БД, ендпоінтів `/refresh` і `/logout` не існує, а `JwtStrategy` була мертвим кодом (див. пункт 5 нижче — видалена). `sessions.md` описує або інший бранч, або відкочену реалізацію — його не варто вважати актуальним джерелом істини для поточного стану `main`/`develop`.

## Виправлено

### 1. `requireEnv` — крах замість читабельної помилки — [env.ts](../src/common/config/env.ts)

Було: `process.env[key].trim()`. Якщо змінна оточення не задана, `process.env[key]` — `undefined`, і виклик `.trim()` кидає сирий `TypeError: Cannot read properties of undefined`, а не задумане `Missing required environment variable: X`.

**Чому важливо:** це був незакомічений регрес у робочій копії — будь-яка відсутня обов'язкова змінна (`DATABASE_URL`, `GOOGLE_CLIENT_ID` тощо) валила застосунок незрозумілим стектрейсом замість чіткого повідомлення про причину.

**Фікс:** `(process.env[key] ?? '').trim()`.

### 2. `GoogleOAuthConfig` — гілка «Google не налаштовано» була недосяжна — [google-oauth.config.ts](../src/modules/auth/google-oauth.config.ts)

Було: `clientId`/`clientSecret`/`redirectUri` читались через `requireEnv()`, який кидає виняток ще до того, як код доходив до перевірки `if (!hasCredentials)`. Тобто `this.enabled = false` і `DEFAULT_REDIRECT_URI` — мертвий код: застосунок або мав усі три змінні Google, або взагалі не стартував.

**Чому важливо:** контролер явно документує (`ApiServiceUnavailableResponse`) поведінку «503, якщо Google не налаштовано» — тобто вхід через Google мав бути опційним. Реальна поведінка суперечила документації: без `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` падав увесь бекенд, а не лише Google-ендпоінти.

**Фікс:** змінні читаються напряму (`process.env[key] ?? ''`) без кидання винятку; `enabled = false` тепер реально спрацьовує, коли жодної з credential-змінних нема, і кидає помилку лише при частковій конфігурації (задано одну, без іншої).

### 3. `login()` і Google-вхід не перевіряли `UserStatus` — [auth.service.ts](../src/modules/auth/auth.service.ts), [google-auth.service.ts](../src/modules/auth/google-auth.service.ts)

Було: жодна з гілок автентифікації не звіряла `user.status`. Користувач у статусі `BLOCKED`/`ARCHIVED` міг залогінитись паролем або через Google так само, як `ACTIVE`.

**Чому важливо:** CLAUDE.md прямо називає «Forced revocation of active sessions» частиною відповідальності модуля. `UserStatus.BLOCKED` до цього фіксу ніде в коді не перевірявся — блокування користувача в БД не мало жодного ефекту на його здатність увійти.

**Фікс:** доданий `AuthService.assertActiveUser()`, підключений у всіх точках, де видається сесія:
- `AuthService.login()` — після звірки пароля;
- `GoogleAuthService.complete()` — у всіх чотирьох гілках (вже прив'язаний акаунт, лінкування до автентифікованого користувача, збіг по email, відновлення після race при створенні);
- `GoogleAuthService.start(userId)` — тепер підвантажує користувача і перевіряє статус ще до генерації Google-URL, а не лише на callback (щоб заблокований користувач не міг навіть ініціювати лінкування).

### 4. `isUniqueConstraintOn` — неузгоджений регістр полів у fallback-гілці — [unique-constraint.ts](../src/common/prisma/unique-constraint.ts)

Було: основний шлях (`meta.target`) повертає camelCase-назви полів Prisma (`providerAccountId`), а fallback (`meta.driverAdapterError.cause.constraint.fields`, специфіка `@prisma/adapter-pg`) повертає сирі назви колонок Postgres у snake_case (`provider_account_id`).

**Чому важливо:** `GoogleAuthService.linkAccount()` перевіряє `isUniqueConstraintOn(error, 'providerAccountId')` для обробки race condition при паралельному лінкуванні одного Google-акаунта. Якщо помилка приходила через fallback-гілку, порівняння `'provider_account_id' === 'providerAccountId'` було хибним, і замість коректного відновлення (повернути існуючий лінк) код завжди падав у generic `fail()`.

**Фікс:** додано `toCamelCase()`, яка нормалізує snake_case-колонки з fallback-гілки перед порівнянням.

## Видалено

### 5. `JwtStrategy` (passport-jwt) — мертвий паралельний auth-стек — [jwt.strategy.ts](../src/modules/auth/strategies/jwt.strategy.ts) (видалено повністю)

Файл існував, але ніде не був зареєстрований як provider — ні в `AuthModule`, ні через `PassportModule`/`JwtModule`. Реальна автентифікація в усьому проєкті йде через власний HMAC-токен (`token.ts`) + `AuthGuard`.

**Чому видалено, а не доопрацьовано:** доопрацювання означало б переписати `AuthGuard`/`RolesGuard` і всі контролери, які на них зав'язані (`UsersController`, `OrganizationController`) — це окрема задача з власним рев'ю, а не bug-fix. Залишати непідключений код, що дублює логіку іншої, реально працюючої системи автентифікації, — джерело плутанини (наприклад, `JWT_ACCESS_SECRET` через `requireEnv` у класі, який Nest ніколи не інстанціює, — відсутність цієї змінної оточення взагалі ніяк не проявлялась).

Разом з файлом прибрані невикористані залежності: `@nestjs/jwt`, `passport`, `passport-jwt`, `@types/passport-jwt` (`npm uninstall`).

## Ще не зроблено (свідомо поза цим проходом)

- **`RefreshToken` / `PasswordResetToken`** — обидві таблиці повністю змодельовані в `schema.prisma`, але жодна не використовується: немає `/auth/refresh`, немає forgot/reset-password. `token.ts` видає `refreshToken`, який ніде не приймається назад.
- **Access-токен живе 7 днів без можливості відкликання** — короткий від compromised-токена захист є лише через видалення/блокування користувача (і то тільки тепер, після пункту 3 — раніше й це не працювало).
- **`AuthGuard` глушить причину помилки** — «user not found» і «invalid signature» повертають однаковий generic 401 (не проблема безпеки, лише незручність при діагностиці).
- **Міграція на `Organization.email @unique`** — зміна в `schema.prisma` є, але міграція під неї ще не згенерована/застосована (`prisma migrate dev` вимагає інтерактивного режиму, якого нема в поточному середовищі).
