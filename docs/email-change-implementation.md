# Зміна email (`me/email/change` / `me/email/verify`) — план реалізації

Читати після [CLAUDE.md](../CLAUDE.md) і [password-reset-implementation.md](password-reset-implementation.md):
цей flow побудований на тих самих примітивах (одноразовий токен у листі, `sha256` у БД, `MailService`,
інвалідація сесій).

Цей файл — не лише план, а і чек-лист для рев'ю: якщо реалізацію вже зроблено, звіряй її з розділом
["Чек-лист для рев'ю"](#чек-лист-для-рев'ю) і виправляй розбіжності, а не переписуй з нуля.

## Поточний стан

Обидва ендпоінти існують лише як заглушки, що повертають `501 Поза MVP` —
[users.controller.ts:116-126](../src/modules/users/users.controller.ts#L116). Контролер під `AuthGuard`
на рівні класу, тож до них доходять лише `ACTIVE` користувачі неблокованої організації
([auth-access.ts](../src/modules/auth/auth-access.ts), `assertActiveUser`).

## Чому email не можна змінити одним `PATCH`

`User.email` — це не просто поле профілю, від нього залежить доступ до акаунта:

1. **Логін.** `AuthService.login` шукає юзера за email ([auth.service.ts:46](../src/modules/auth/auth.service.ts#L46)).
2. **Відновлення пароля.** `forgot-password` шле токен на `user.email`. Хто контролює цю скриньку, той
   контролює акаунт.
3. **Google OAuth fallback.** Якщо в Google-акаунта ще немає прив'язаного `OAuthAccount`, `sessionFromProfile`
   шукає юзера **за email** і автоматично прив'язує Google-акаунт
   ([google-auth.service.ts:178-204](../src/modules/auth/google-auth.service.ts#L178)).

Без підтвердження нової адреси юзер A міг би записати собі `victim@gmail.com`, і тоді перший вхід жертви через
Google з цим email потрапив би в акаунт A (account pre-hijacking). Тому зміна email складається з двох кроків,
і `User.email` оновлюється **лише після** того, як власник нової скриньки перейде за посиланням із листа.

## Flow

```
1. POST /users/me/email/change  { newEmail, currentPassword }
   → перевірка пароля + унікальності → токен у БД → лист на НОВУ адресу
   → 200 { message }                    (User.email ще не змінено)

2. Юзер відкриває лист → фронтенд /confirm-email?token=... → POST /users/me/email/verify { token }
   → User.email = newEmail, сесії відкликано, повідомлення на СТАРУ адресу
   → 200 { message }                    (фронтенд редіректить на логін)
```

## Що вже є в репозиторії (перевикористати, не переробляти)

- Референс токен-flow: `PasswordResetService`
  ([password-reset.service.ts](../src/modules/auth/password-reset.service.ts)). Звідти копіюються `hashToken()`,
  генерація токена (`randomBytes(48).toString('base64url')`) та інвалідація попередніх
  токенів через `updateMany({ usedAt })`.
- Референс "перевірити поточний пароль + відкликати сесії": `UsersService.changePassword`
  ([users.service.ts:77-118](../src/modules/users/users.service.ts#L77)).
- `RefreshTokenService.revokeAllForUser` (експортується з `AuthModule`, вже інжектиться в `UsersService`).
- `MailService.sendEmail({ to, subject, html, text? })` та `MailSendFailedError`
  ([mail.service.ts](../src/modules/mail/mail.service.ts)).
- `isUniqueConstraintOn(error, 'email')` ([unique-constraint.ts](../src/common/prisma/unique-constraint.ts)).
- Формат 409 для зайнятого email: `{ statusCode: 409, errors: [{ field: 'email', message }] }`, як в
  `AuthService.createOwnerUser` / `InvitationsService.emailAlreadyExists`.
- `escapeHtml()` ([invitation-email.content.ts:30](../src/modules/invitations/invitation-email.content.ts#L30)),
  бо нова адреса потрапляє в HTML листа.

## Модель даних

Нова таблиця за зразком `PasswordResetToken`, плюс поле з цільовою адресою:

```prisma
model EmailChangeToken {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  newEmail  String    @map("new_email") @db.VarChar(255)
  tokenHash String    @unique @map("token_hash") @db.VarChar(128)
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("email_change_tokens")
}
```

У `User` додати зворотну relation: `emailChangeTokens EmailChangeToken[]`.

Міграція: `npx prisma migrate dev --name add_email_change_tokens`.

Чому окрема таблиця, а не колонки `pendingEmail`/`pendingEmailTokenHash` на `User`: так вже влаштований
`PasswordResetToken`, а `User` не розростається полями, потрібними лише на час flow. Перевикористати
`PasswordResetToken` не можна: там немає `newEmail`, і токен одного типу не повинен підходити для іншого flow.

## Сервіс: `src/modules/users/email-change.service.ts`

Окремий сервіс, а не методи в `UsersService`: йому потрібен `MailService`, а `UsersService` і його spec
лишаються без змін.

Константи:

```ts
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000; // нову скриньку можуть перевірити не одразу
const EMAIL_CHANGE_COOLDOWN_MS = 60 * 1000;      // захист від розсилки листів на чужі адреси
const INVALID_EMAIL_CHANGE_TOKEN_MESSAGE =
  'Посилання для підтвердження email недійсне або застаріле.';
```

`hashToken()` скопіювати з `password-reset.service.ts`. `frontendBaseUrl()` імпортувати зі спільного
[frontend-url.ts](../src/common/config/frontend-url.ts); його ж використовують `PasswordResetService` та листи-запрошення.

```ts
function emailChangeConfirmUrl(token: string): string {
  return `${frontendBaseUrl()}/confirm-email?token=${encodeURIComponent(token)}`;
}
```

### `requestEmailChange(user: User, newEmail: string, currentPassword: string)`

1. `const email = newEmail.trim().toLowerCase()`.
2. Якщо `email === user.email` → `400 'Новий email збігається з поточним.'`.
3. Перечитати юзера з БД (`findUnique({ where: { id: user.id } })`), як у `changePassword`.
4. Якщо `!fresh.passwordHash` → `400` (див. [Google-only акаунти](#google-only-акаунти-без-пароля)).
5. `bcrypt.compare(currentPassword, fresh.passwordHash)`. Якщо не збігається → `400 'Current password is incorrect'`,
   той самий текст, що в `changePassword`.
   **Не `401`**: ендпоінт аутентифікований, і фронтенд сприйме `401` як протухлу сесію (refresh/logout).
6. `prisma.user.findUnique({ where: { email } })`. Якщо запис є (включно з soft-deleted, бо `email` унікальний
   на всю таблицю) → `409` у форматі `{ errors: [{ field: 'email', message: 'Користувач з таким email уже існує.' }] }`.
   Розкриття факту існування email тут прийнятне: `register` уже повертає ту саму `409`.
7. Cooldown: якщо в юзера є `EmailChangeToken` з `createdAt > now - EMAIL_CHANGE_COOLDOWN_MS` →
   `HttpException('Зачекайте хвилину перед повторним запитом.', HttpStatus.TOO_MANY_REQUESTS)`.
   У проєкті немає throttler, а без cooldown будь-хто з валідним паролем може без обмежень слати листи на довільні адреси.
8. Інвалідувати попередні невикористані токени: `emailChangeToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } })`.
9. `token = randomBytes(48).toString('base64url')`; створити запис з `tokenHash: hashToken(token)`, `newEmail: email`,
   `expiresAt: now + EMAIL_CHANGE_TTL_MS`.
10. `mailService.sendEmail({ to: email, ... })` (див. [Листи](#листи)). Якщо SMTP впав — видалити щойно створений
    токен і прокинути `MailSendFailedError` (`500`). Інакше cooldown з кроку 7 відповідав би `429` на повторну спробу,
    хоча лист так і не дійшов.
11. `Logger.log` з `userId` (без токена).
12. Повернути `{ message: 'Лист для підтвердження надіслано на нову адресу.' }`.

### `verifyEmailChange(user: User, token: string)`

1. `record = emailChangeToken.findUnique({ where: { tokenHash: hashToken(token) } })`.
2. Одна й та сама `BadRequestException(INVALID_EMAIL_CHANGE_TOKEN_MESSAGE)` на всі причини:
   нема запису / `expiresAt` минув / `usedAt` стоїть / `record.userId !== user.id`.
   Прив'язка до `user.id` не дає іншому залогіненому юзеру "спожити" чужий токен. Як і в кроці 5 вище, **не `401`**.
3. В `prisma.$transaction(async (tx) => ...)`:
   - атомарно спожити токен: `tx.emailChangeToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: now } })`.
     Якщо `count !== 1` → та сама `400` (два паралельні verify з одним токеном; той самий патерн, що
     `consumed.count` у `GoogleAuthService.complete`);
   - `tx.user.update({ where: { id: user.id }, data: { email: record.newEmail, tokensInvalidBefore: now } })`;
   - інвалідувати решту невикористаних токенів юзера (`updateMany ... usedAt: null`).
4. Якщо транзакція впала з `isUniqueConstraintOn(error, 'email')` → `409` у тому ж форматі, що в
   `requestEmailChange`. Це буває, коли адресу встигли зайняти між кроками 1 і 2 (реєстрація/інвайт). Транзакція
   відкотилась, тож токен лишається невикористаним і до кінця TTL так само повертатиме `409`.
5. `refreshTokenService.revokeAllForUser(user.id)`, як у `changePassword` (див. [Відкриті питання](#відкриті-питання) №2).
6. Повідомлення на **стару** адресу (`user.email` з guard'а): best-effort. Обгорнути в `try/catch`, при помилці
   `logger.warn` і **не** кидати: email уже змінено в БД.
7. Повернути `{ message: 'Email оновлено. Увійдіть знову з новою адресою.' }`.

Після кроку 3 поточний access token стає недійсним (`payload.iat < tokensInvalidBefore`,
[auth.guard.ts:42](../src/modules/auth/auth.guard.ts#L42)). Фронтенд після `200` має очистити токени
й відкрити логін.

## DTO: додати в `src/modules/users/users.dto.ts`

```ts
export class ChangeEmailDto {
  @ApiProperty({ example: 'new.owner@example.com' })
  @IsEmail({}, { message: 'Введіть коректний email.' })
  @MaxLength(255)
  @IsNotEmpty()
  newEmail: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;
}
```

Відповіді: наявний `MessageResponseDto`.

## Контролер: `users.controller.ts`

Шляхи лишаються ті самі, змінюються лише тіла методів:

```ts
@Post('me/email/change')
@HttpCode(HttpStatus.OK)
@ApiOkResponse({ type: MessageResponseDto })
changeEmail(@CurrentUser() user: User, @Body() body: ChangeEmailDto) {
  return this.emailChangeService.requestEmailChange(
    user,
    body.newEmail,
    body.currentPassword,
  );
}

@Post('me/email/verify')
@HttpCode(HttpStatus.OK)
@ApiOkResponse({ type: MessageResponseDto })
verifyEmail(@CurrentUser() user: User, @Body() body: VerifyEmailDto) {
  return this.emailChangeService.verifyEmailChange(user, body.token);
}
```

- `@HttpCode(HttpStatus.OK)` обов'язковий, бо `@Post` за замовчуванням дає `201`.
- Прибрати імпорт `HttpException`, він використовувався лише в заглушках.
- `verify` лишається під `AuthGuard`, тобто юзер має бути залогінений. Якщо лист відкрили на іншому пристрої,
  фронтенд спершу веде на логін **старим** email (він ще дійсний) і потім повторює `verify`.

## Wiring: `users.module.ts`

```ts
imports: [AuthModule, MailModule],
providers: [UsersService, EmailChangeService],
```

## Листи

Обидва листи збираються в сервісі, як у `PasswordResetService`. Усі змінні значення проходять через `escapeHtml()`.

**На нову адресу** (`requestEmailChange`):
- subject: `Підтвердження нової email-адреси`;
- тіло: посилання `emailChangeConfirmUrl(token)`, термін дії 24 години, фраза "Якщо ви не запитували зміну —
  просто проігноруйте цей лист".

**На стару адресу** (`verifyEmailChange`, best-effort):
- subject: `Email вашого акаунта змінено`;
- тіло: "Email для входу змінено на `<newEmail>`. Якщо це були не ви — зверніться до адміністратора автошколи."
  Нову адресу показуємо повністю, щоб справжній власник міг повідомити про захоплення акаунта.

## Вплив на інші частини системи

| Де | Що відбувається | Дія |
|---|---|---|
| Google login, акаунт уже прив'язано (`OAuthAccount` за `sub`) | Працює далі, email не використовується | — |
| Google login, акаунт ще не прив'язано | Fallback за email тепер знаходить юзера за **новою** адресою | Саме тому підтвердження обов'язкове |
| `OAuthAccount.email`, `Invitation.email` | Історичні знімки на момент прив'язки/інвайту | Не чіпати |
| `Organization.email` | При реєстрації OWNER копіюється його email; модуль `organization` цю адресу не редагує | Не чіпати (див. [Відкриті питання](#відкриті-питання) №4). Побічний ефект: стара адреса лишається зайнятою в `organizations.email`, і реєстрація нової школи з нею дасть `409` |
| Demo-сід ([demo-accounts.ts](../src/prisma/demo-accounts.ts), `provisionDemoAccounts`) | `upsert` шукав лише за `email`, а `create` має фіксований `id`. Якщо demo-юзер змінить email, наступний старт у dev впав би з `P2002` на `id` | `upsert` за id рядка, знайденого за email, або за фіксованим `account.id`, якщо за email нічого нема; `update` містить `email: account.email`, тож сід повертає demo-адресу. Просто `where: { id }` не підходить: demo-ідентифікатори додали пізніше, і в старих БД demo-юзери можуть мати інші id |

## Google-only акаунти без пароля

OWNER, зареєстрований через Google, має `passwordHash: null`, і перевірити `currentPassword` нема з чим.
Пропускати перевірку не можна: тоді вкраденого access token достатньо, щоб змінити email на свій,
зробити `forgot-password` і встановити пароль, тобто повністю захопити акаунт.

**Рекомендація для цієї задачі:** `400 'Щоб змінити email, спершу встановіть пароль через «Забули пароль?».'`.
`forgot-password` уже працює для юзерів без пароля і шле лист на поточну (підтверджену) адресу.
Повторна аутентифікація через свіжий Google `idToken` — окрема задача (див. [Відкриті питання](#відкриті-питання) №3).

## Тест-план

`src/modules/users/email-change.service.spec.ts`, моки в стилі
[users.service.spec.ts](../src/modules/users/users.service.spec.ts) (`jest.mock('bcrypt')`, plain-object Prisma).

`requestEmailChange`:
- `newEmail` з пробілами/великими літерами нормалізується; якщо збігається з поточним → `400`, токен не створено, лист не надіслано;
- `passwordHash: null` → `400`, лист не надіслано;
- неправильний пароль → `400` (не `401`), лист не надіслано;
- email зайнятий іншим (у т.ч. soft-deleted) юзером → `409` з `field: 'email'`;
- попередній токен створено < 60 с тому → `429`;
- успіх: попередні токени інвалідуються, у БД пишеться `sha256` (не сирий токен), `newEmail` нормалізований,
  `expiresAt` ≈ now + 24h, лист іде на **нову** адресу і містить сирий токен у посиланні;
- `MailSendFailedError` прокидається далі.

`verifyEmailChange`:
- невідомий / прострочений / використаний / чужий (`userId` іншого юзера) токен → однакова `400`, `user.update` не викликано;
- `updateMany` повернув `count: 0` (гонка) → та сама `400`;
- `P2002` на `email` під час `user.update` → `409`;
- успіх: `email = newEmail`, `tokensInvalidBefore` встановлено, `revokeAllForUser` викликано, лист іде на **стару** адресу;
- падіння листа на стару адресу → відповідь усе одно `200`, `logger.warn` викликано.

## Відкриті питання

1. **Маршрут фронтенду для посилання.** План передбачає `/confirm-email?token=...`. Погодити з фронтендом до мержу,
   бо змінити URL у вже надісланих листах неможливо.
2. **Відкликати всі сесії після зміни email?** План: так, як у `changePassword` (CLAUDE.md §1, "Forced revocation of
   active sessions"). Альтернатива: не відкликати, а повертати `PublicUserDto` з новим email. Це зручніше, але
   сесії на інших пристроях лишаються живими після зміни ідентифікатора входу.
3. **Google-only акаунти.** План: блокувати з підказкою про `forgot-password`. Альтернатива: приймати в `change`
   опційний `googleIdToken` і перевіряти, що `sub` збігається з прив'язаним `OAuthAccount`.
4. **`Organization.email` для OWNER.** План: не синхронізувати, бо це контакт школи, а не логін. Якщо продукт
   вважає інакше, синхронізацію робити в тій самій транзакції кроку 3 `verifyEmailChange`.

## Чек-лист для рев'ю

- [ ] Заглушки `501` прибрано, обидва ендпоінти повертають `200 { message }` і задокументовані у Swagger.
- [ ] `User.email` змінюється **лише** у `verifyEmailChange`, ніколи в `requestEmailChange`.
- [ ] Токен: `randomBytes(48).base64url`, у БД лише `sha256`; `newEmail` зберігається в `EmailChangeToken`.
- [ ] `requestEmailChange` перевіряє поточний пароль і повертає `400` (не `401`) на неправильний.
- [ ] Google-only юзер (`passwordHash: null`) не може змінити email без пароля.
- [ ] Перевірка зайнятості email у `change` + обробка `P2002` у `verify`; обидва дають `409` з `field: 'email'`.
- [ ] Cooldown між запитами; попередні невикористані токени інвалідуються при новому запиті.
- [ ] `verify`: однакова `400` на всі види невалідного токена, токен прив'язаний до `user.id`,
      споживається атомарно (`updateMany ... usedAt: null` + `count`).
- [ ] Після зміни: `tokensInvalidBefore` оновлено, `revokeAllForUser` викликано.
- [ ] Лист на нову адресу з посиланням; повідомлення на стару best-effort, його падіння не ламає відповідь.
- [ ] HTML листів екранується (`escapeHtml`).
- [ ] `MailModule` імпортовано в `UsersModule`; `EmailChangeService` у `providers`.
- [ ] Міграція `add_email_change_tokens` додана; demo-сід знаходить demo-юзера за email або фіксованим `id`.
- [ ] Тести з розділу вище присутні й проходять (`npm test`).
