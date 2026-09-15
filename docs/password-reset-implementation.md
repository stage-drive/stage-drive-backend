# Password reset (`forgot-password` / `reset-password`) — план реалізації

Читати після [CLAUDE.md](../CLAUDE.md) і перед тим, як імплементувати або рев'ювати `forgot-password`/`reset-password`.
Продовжує [sessions.md](sessions.md) (login/refresh) для DF-02 / UF-13: *"Реалізувати backend flow запиту на відновлення пароля"*.

Цей файл — не лише план, а і чек-лист для рев'ю: якщо реалізацію вже зроблено, звіряй її з розділом
["Чек-лист для рев'ю"](#чек-лист-для-рев'ю) нижче і виправляй розбіжності, а не переписуй з нуля.

## Історія (навіщо цей файл існує)

`docs/sessions.md` містить примітку: password recovery вже реалізовували раніше, потім **свідомо відкотили**, бо
в проєкті не було поштового провайдера — токен нікуди було надсилати, а нефункціональний ендпоінт у Swagger вводив
фронтенд в оману. Повна стара реалізація залишилась на branches `feat/password-reset` та `reset-password`
(остання — з тестами, `f3545a6 tests implemented`).

Ці branches **застарілі й не мержаться напряму** — вони базуються на комітах до Google OAuth, до модуля `invitations`,
до поточного `MailModule`/`RefreshTokenService` (family-based rotation). Пряме злиття видалило б увесь цей код.
Використовуй їх лише як референс дизайн-рішень (нижче), не як джерело патча.

Що змінилось відтоді і чому старий підхід треба адаптувати, а не копіювати:

| Старий branch (`feat/password-reset`) | Поточний код (`develop`/`feat/mailer`) |
|---|---|
| `refreshToken`/`resetToken` у форматі `id.secret`, секрет хешується bcrypt | Один випадковий токен (`randomBytes(48).base64url`), у БД лише `sha256(token)` — [refresh-token.service.ts](../src/modules/auth/refresh-token.service.ts), [invitations.service.ts](../src/modules/invitations/invitations.service.ts) |
| Лист не надсилається, токен у `console.log` (не було mail-провайдера) | `MailModule`/`MailService` вже реалізовані й використовуються в `InvitationsService` — [mailer.md](mailer.md) |
| Ендпоінти повертають `204 No Content` | Поточний стиль — JSON `{ message }`, як у `UsersService.changePassword` ([users.service.ts:104](../src/modules/users/users.service.ts#L104)) |
| Немає `FRONTEND_URL` (не існував) | Вже є в `.env.example` і в `frontendBaseUrl()` в `InvitationsService` |
| Немає `invitations` — усі юзери мають пароль | `InvitationsService.inviteAdmin` створює `User` з `passwordHash: null`, `status: INVITED`, і **немає жодного іншого ендпоінта**, який дозволяє такому юзеру встановити пароль вперше |

Останній рядок — ключова відмінність від старого дизайну: `forgot-password` зараз є єдиним механізмом, яким
запрошений (INVITED) юзер може отримати пароль. Не трактуй `passwordHash === null` як "нема що скидати" —
для цієї БД це означає "юзер ще не логінився", і токен для нього треба видавати так само, як для активного.

## Що вже готово в репозиторії (не чіпати/переробляти)

- `PasswordResetToken` — модель у Prisma вже є, не використовується жодним сервісом:
  [schema.prisma:127-139](../prisma/schema.prisma#L127) (`tokenHash` unique, `expiresAt`, `usedAt`). Міграція не потрібна.
- `MailService.sendEmail({ to, subject, html })` — [mail.service.ts](../src/modules/mail/mail.service.ts).
- `FRONTEND_URL` — вже в `.env.example`, читається через `process.env.FRONTEND_URL` fallback-ланцюжком у
  `frontendBaseUrl()` в `InvitationsService` ([invitations.service.ts:37-44](../src/modules/invitations/invitations.service.ts#L37)).
- `RefreshTokenService.revokeAllForUser(userId)` — [refresh-token.service.ts:77-82](../src/modules/auth/refresh-token.service.ts#L77).
- Патерн "хеш пароля + інвалідація сесій" вже реалізований і протестований у
  `UsersService.changePassword` — [users.service.ts:67-105](../src/modules/users/users.service.ts#L67). Це референс-реалізація
  для кроку 2 (`reset-password`), копіюй логіку 1:1.

## Дизайн

### Новий файл: `src/modules/auth/password-reset.service.ts`

Структурно копіює `InvitationsService` ([invitations.service.ts](../src/modules/invitations/invitations.service.ts)):
свій `hashToken()` (sha256, ідентично до вже двох існуючих копій у `RefreshTokenService` і `InvitationsService` —
за CLAUDE.md/project style не виносити в спільний util заради трьох однакових рядків), свій `escapeHtml()`,
своя TTL-константа.

```ts
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 хв — коротше за INVITATION_TTL_MS (7 днів)

export function passwordResetUrl(token: string): string {
  return `${frontendBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}
```

**`requestPasswordReset(email: string): Promise<{ message: string }>`**

1. `user = prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } })`.
2. Якщо юзера нема, або `deletedAt` не `null` — **нічого не робити**, повернути той самий generic-response,
   що й при успіху. Це навмисно: інакше різниця у відповіді/часі виконання дозволяє user enumeration
   (той самий принцип, що описаний у старому `docs/sessions-and-password-reset.md`).
3. Якщо юзер є:
   - позначити всі невикористані `PasswordResetToken` цього юзера як `usedAt: new Date()` (щоб старі лінки з
     попередніх запитів переставали працювати — цього не було в старому branch, це посилення);
   - згенерувати токен (`randomBytes(48).toString('base64url')`), зберегти `hashToken(token)` + `expiresAt`;
   - надіслати лист через `MailService.sendEmail`. Текст листа має відрізнятись для `status === INVITED`
     ("встановіть пароль, щоб активувати акаунт") проти вже активного юзера ("скидання пароля") — див.
     відкрите питання нижче.
4. Повернути `{ message: 'Якщо акаунт із таким email існує, лист надіслано.' }`.

**`resetPassword(token: string, newPassword: string): Promise<{ message: string }>`**

1. `hashToken(token)` → знайти `PasswordResetToken`.
2. Одне й те саме `UnauthorizedException` повідомлення для всіх причин відмови (не знайдено / `expiresAt` минув /
   `usedAt` вже стоїть) — не підказувати зловміснику причину, як у старому branch.
3. Якщо валідний — так само, як `UsersService.changePassword`:
   - `bcrypt.hash(newPassword, BCRYPT_ROUNDS)` → `user.passwordHash`;
   - `tokensInvalidBefore: new Date()`;
   - `refreshTokenService.revokeAllForUser(userId)` (це "Forced revocation of active sessions" з CLAUDE.md §1);
   - позначити токен `usedAt`;
   - якщо `user.status === INVITED` → `ACTIVE` (дзеркалить `AuthService.login` при першому вході,
     [auth.service.ts:60-64](../src/modules/auth/auth.service.ts#L60)).

### DTO: `src/modules/auth/password-reset.dto.ts`

Стиль — як `auth.dto.ts`/`invitations.dto.ts` (українські `@ApiProperty` messages, `class-validator`):

```ts
export class RequestPasswordResetDto {
  @IsEmail(...) email: string;
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty() token: string;
  @MinLength(8) @MaxLength(72) password: string;
  @Match('password', ...) passwordConfirmation: string;
}
```

### Контролер — додати в `AuthController`, окремий модуль не потрібен

`forgot-password`/`reset-password` публічні й без ролей, як `login`/`register` — на відміну від `invitations`,
де є окремий модуль, бо там `@Roles(UserRole.OWNER)`. Не створюй `PasswordResetController`/`PasswordResetModule`.

```
POST /auth/forgot-password  { email }                          → 200 { message }
POST /auth/reset-password   { token, password, passwordConfirmation } → 200 { message }
```

### Wiring: `auth.module.ts`

- Додати `MailModule` в `imports` (зараз лише `InvitationsModule` його імпортує; CLAUDE.md прямо каже
  "Always export `MailService`... so it can be injected into `AuthModule`").
- Додати `PasswordResetService` в `providers`.

## Тест-план

`password-reset.service.spec.ts`, за зразком `invitations.service.spec.ts` / `refresh-token.service.spec.ts`:

- невідомий email → generic success, лист не надсилається, токен не створюється;
- `deletedAt` не `null` → так само, як невідомий email;
- юзер з `passwordHash: null` і `status: INVITED` → токен створюється, лист іде, після `resetPassword` —
  `status: ACTIVE`;
- прострочений / вже використаний / неіснуючий токен у `resetPassword` → однаковий `401`;
- успішний `resetPassword` → `revokeAllForUser` викликано, `tokensInvalidBefore` оновлено, старий токен `usedAt`;
- повторний `requestPasswordReset` для того ж юзера інвалідує попередній невикористаний токен.

## Відкрите питання

Чи різниться текст листа для `INVITED` (перше встановлення пароля) проти `ACTIVE` (реальне відновлення)?
У AC це сформульовано як "invitation/recovery message відповідно до погодженого flow" — уточнити перед тим,
як писати копірайт листа; технічна логіка (токен/TTL/revocation) від відповіді не залежить.

## Чек-лист для рев'ю

Якщо реалізація вже існує в коді — звірити по пунктах, виправити відхилення:

- [ ] Токен: `randomBytes(48).base64url` + `sha256` хеш у БД (**не** bcrypt, **не** формат `id.secret`).
- [ ] `requestPasswordReset` повертає однакову відповідь незалежно від того, чи існує email.
- [ ] Попередні невикористані токени юзера інвалідуються при новому запиті.
- [ ] `resetPassword` повертає одне generic-повідомлення на всі варіанти невалідного токена.
- [ ] Успішний reset: `passwordHash` оновлено, `tokensInvalidBefore` оновлено, `revokeAllForUser` викликано,
      токен позначено `usedAt`.
- [ ] `INVITED` юзер після reset стає `ACTIVE`.
- [ ] Ендпоінти публічні (без `AuthGuard`/`RolesGuard`), лежать у `AuthController`, не в окремому модулі.
- [ ] `MailModule` імпортовано в `AuthModule`.
- [ ] Немає нового env var для TTL (константа в коді) і немає дубльованого `FRONTEND_URL`-читання поза
      патерном `frontendBaseUrl()`.
- [ ] Тести з розділу вище присутні й проходять (`npm test`).
