# Перевірка статусу User/Organization під час authentication — план реалізації

Читати після [CLAUDE.md](../CLAUDE.md) і [auth-hardening.md](auth-hardening.md) (пункт 3 там — це та сама тема,
частково вже закрита) перед тим, як імплементувати або рев'ювати цю задачу.
`sessions.md` для цієї теми **не використовувати** — сам `auth-hardening.md` (рядок 5) позначає його як застарілий
опис іншої/відкоченої гілки.

## Це не greenfield-фіча — це три конкретні діри в уже частково зробленій роботі

`auth-hardening.md` §3 вже додав перевірку `UserStatus`/organization-статусу через
[assertSignInAllowed](../src/modules/auth/auth-access.ts#L10) і підключив її до `login()`. Проблема: **ця
перевірка підключена лише в одному з чотирьох місць, де видається чи продовжується сесія**, і в одному з
чотирьох місць, де вона підключена, вона мовчки не працює через відсутній Prisma `include`. Перевірено напряму
по коду (не з документації):

| Місце | User-статус (BLOCKED/ARCHIVED) | Organization-статус (BLOCKED) |
|---|---|---|
| `AuthService.login()` | ✅ працює (`assertSignInAllowed`) | ✅ працює — `include: { organization: true }` є |
| `GoogleAuthService` (start/complete/completeWithIdToken) | ✅ працює (`assertSignInAllowed` викликається у 4 гілках) | ❌ **мовчки не працює** — жоден із 3 Prisma-запитів на `User` не робить `include: { organization: true }`, тож `user.organization` завжди `undefined`, і `user.organization?.status === 'BLOCKED'` завжди `false` |
| `RefreshTokenService.rotate()` | ✅ працює (`assertActiveUser`, ACTIVE-only) | ❌ **відсутня повністю** — `assertActiveUser` навіть не приймає `organization` як параметр |
| `AuthGuard.canActivate()` (усі захищені ендпоінти) | ✅ працює (`assertActiveUser`) | ❌ **відсутня повністю** — та сама причина |

Тестове покриття підтверджує цю картину: `grep` по `*.spec.ts` для org-blocked сценаріїв знаходить **лише один**
тест, у `auth.service.spec.ts` (для `login()`). У `google-auth.service.spec.ts`, `refresh-token.service.spec.ts`,
`auth.guard.spec.ts` — жодного.

**Наслідок для AC:** якщо адмін блокує автошколу (`Organization.status = BLOCKED`), її користувачі досі можуть:
- увійти через Google (organization-check пропускається мовчки);
- отримати нову пару токенів через `POST /auth/refresh`, маючи вже видний `refreshToken`;
- продовжувати ходити на будь-який захищений ендпоінт (`AuthGuard`), доки не спливе природний TTL access-токена
  (7 днів, `ACCESS_TOKEN_TTL_MS` у [token.ts](../src/modules/auth/token.ts)).

Це прямо суперечить AC "User з blocked Organization обробляється відповідно до flow" для трьох із чотирьох
шляхів.

## Дизайн

### 1. Розширити `assertActiveUser` в [auth-access.ts](../src/modules/auth/auth-access.ts#L25)

Зараз перевіряє лише `deletedAt`/`status`. Додати той самий organization-check, що вже є в
`assertSignInAllowed` — але не дублювати логіку окремою функцією, а розширити цю саму, оскільки і `refresh`,
і `AuthGuard` вже викликають саме її:

```ts
export function assertActiveUser(user: {
  status: UserStatus;
  deletedAt?: Date | null;
  organization?: { status: OrganizationStatus } | null;
}): void {
  if (
    user.deletedAt ||
    user.status !== UserStatus.ACTIVE ||
    user.organization?.status === OrganizationStatus.BLOCKED
  ) {
    throw new UnauthorizedException(ACCOUNT_NOT_ACTIVE_MESSAGE);
  }
}
```

Свідомо **не** чіпати `UserStatus`-частину цієї функції (залишається строго `ACTIVE`-only, як і зараз) — це
поза межами цієї задачі й змінило б поведінку для `INVITED`-юзерів у refresh/guard, що ніхто не просив.
Код-виклику (`RefreshTokenService.rotate`, `AuthGuard.canActivate`) міняти не треба — вони вже викликають
`assertActiveUser(user)`, просто `user.organization` після наступного пункту перестане бути `undefined`.

### 2. Додати `include: { organization: true }` у 4 Prisma-запити

- [refresh-token.service.ts](../src/modules/auth/refresh-token.service.ts#L50) — `rotate()`:
  `prisma.user.findUnique({ where: { id: record.userId } })` → додати `include: { organization: true }`.
- [auth.guard.ts](../src/modules/auth/auth.guard.ts#L32) — `canActivate()`:
  `prisma.user.findUnique({ where: { id: payload.sub } })` → те саме.
- [google-auth.service.ts](../src/modules/auth/google-auth.service.ts) — три місця:
  - `start()` [рядок 52](../src/modules/auth/google-auth.service.ts#L52) — `findUnique({ where: { id: userId } })`;
  - `sessionFromProfile()` [рядок 180](../src/modules/auth/google-auth.service.ts#L180) —
    `findUnique({ where: { id: linkingUserId } })`;
  - `findUserByGoogleEmail()` [рядок 207](../src/modules/auth/google-auth.service.ts#L207) — `findFirst(...)`;
  - і окремо `oAuthAccount.findUnique({ include: { user: true } })` [рядок 168](../src/modules/auth/google-auth.service.ts#L168) —
    тут `include` вкладений: `include: { user: { include: { organization: true } } }`, бо це шлях "акаунт вже
    прив'язаний" (`authorizeUser(oauthAccount.user)` на рядку 203).

Усі чотири — це вже існуючі запити, куди просто додається `include`, без зміни сигнатур функцій.

## Що НЕ входить у цю задачу (свідомо)

- **Активні сесії, видані до блокування організації, не завершуються миттєво.** `AuthGuard`-фікс блокує
  access-токен при **наступному** запиті, але не має механізму примусово перервати запит, що вже виконується,
  чи "виштовхнути" WebSocket/SSE з'єднання — таких у проєкті немає, тож це неактуально, але варто розуміти:
  захист спрацьовує на рівні "наступний HTTP-запит", не "миттєво в моменті блокування".
- **Notification/UX для заблокованої організації** (лист адміну, банер на фронті) — поза бекенд-скоупом цього
  AC ("Backend повертає відповідний результат" — тобто коректний HTTP-статус/повідомлення, не сповіщення).
- Повідомлення і статус-коди **не змінюються**: `login`/Google — `403 ACCESS_DENIED_MESSAGE` (вже є); `refresh`/
  `AuthGuard` — `401 ACCOUNT_NOT_ACTIVE_MESSAGE` (вже є, просто тепер спрацьовує й для org-блокування). Ця
  асиметрія 403-при-вході / 401-при-продовженні-сесії вже існує в проєкті навмисно — не вирівнювати її в рамках
  цієї задачі.

## Тест-план

Для кожного з 4 місць — по одному новому тесту "org-blocked → відхилено" (дзеркалити вже наявний тест у
`auth.service.spec.ts:143`, який можна лишити без змін як референс):

- `refresh-token.service.spec.ts` — `rotate()` з юзером, чия organization має `status: BLOCKED` → `401
  UnauthorizedException` (доповнити мок `prisma.user.findUnique`, щоб повертав `organization`).
- `auth.guard.spec.ts` — те саме для `canActivate()`.
- `google-auth.service.spec.ts` — мінімум 2 нові тести: (а) вже прив'язаний Google-акаунт, organization
  заблокована → відхилено; (б) лінкування по email (`findUserByGoogleEmail`) з заблокованою organization →
  відхилено. Це саме ті гілки, де зараз мовчки нічого не перевіряється — головне довести регресію "до фіксу
  тест падає", а не просто зелений тест на вже робочу гілку.

## Чек-лист для рев'ю

- [ ] `assertActiveUser` перевіряє `organization?.status === BLOCKED`, і **не** змінено перевірку `UserStatus`
      (усе ще строго `ACTIVE`-only, не зачіпає `INVITED`).
- [ ] Усі 4 Prisma-запити (`refresh-token.service.ts`, `auth.guard.ts`, і 3+1 у `google-auth.service.ts`) мають
      `include: { organization: true }` (для `oAuthAccount.findUnique` — вкладений `user.organization`).
- [ ] `login()` і `assertSignInAllowed` **не змінені** — вони вже коректні, чіпати їх не потрібно.
- [ ] Жодних нових повідомлень/статус-кодів — перевикористані `ACCESS_DENIED_MESSAGE` (403) і
      `ACCOUNT_NOT_ACTIVE_MESSAGE` (401), кожен у своєму вже існуючому контексті.
- [ ] Нові тести з розділу вище присутні й проходять (`npm test`), і хоча б один з них явно демонструє, що без
      фіксу заблокована organization НЕ зупиняла б flow (тобто тест значущий, а не тавтологічний).
