# Logout (`POST /auth/logout`) — план реалізації

Читати після [CLAUDE.md](../CLAUDE.md) і перед тим, як імплементувати або рев'ювати `logout`.
Продовжує [sessions.md](sessions.md) (login/refresh) і [password-reset-implementation.md](password-reset-implementation.md)
(той самий підхід: план + чек-лист для рев'ю в одному файлі).

## Історія

Заголовок [sessions.md](sessions.md) обіцяє "Сесії (login/refresh/**logout**)", але в тілі файлу `logout` ніде не
реалізований, і в поточному [auth.controller.ts](../src/modules/auth/auth.controller.ts) такого ендпоінта немає.
Причина та сама, що й з password reset: на branch `feat/password-reset` логаут був реалізований
(`4a41063 implemented logout`), потім весь branch відкотили разом із password reset, і `logout` відкотився
за компанію, хоч сам по собі не залежав від відсутнього mail-провайдера. Стара реалізація — публічний
ендпоінт, що приймає `refreshToken` у тілі, відкликає його, і **завжди повертає успіх** (навіть якщо токен
невалідний/не знайдений) — цей принцип нижче зберігається.

## Поточний стан (що вже є і що використовувати як основу)

- [RefreshTokenService](../src/modules/auth/refresh-token.service.ts) вже має все необхідне:
  - `hash()` — приватний sha256-хеш токена (той самий підхід, що й в `PasswordResetService`);
  - `revokeFamily(familyId)` — [refresh-token.service.ts:70-75](../src/modules/auth/refresh-token.service.ts#L70),
    вже використовується в `rotate()` при виявленні повторного використання токена. Це саме той метод, який
    потрібен для logout — не `revokeAllForUser` (це "вийти всюди", для password reset), а саме `revokeFamily`
    (це "вийти з цієї сесії").
- [RefreshTokenDto](../src/modules/auth/auth.dto.ts#L132) (`{ refreshToken: string }`) вже існує й використовується
  в `POST /auth/refresh` — **новий DTO для logout не потрібен**, це той самий вхід.
- `MessageResponseDto` вже є в [users.dto.ts](../src/modules/users/users.dto.ts#L74) — той самий підхід відповіді,
  що й у `forgot-password`/`reset-password` (`{ message: string }`, `200`, не `204`, як було у старій реалізації —
  свідомо відхиляюсь від старого branch тут же, як і в password-reset плані, щоб не змішувати стилі відповідей).
- [AuthGuard](../src/modules/auth/auth.guard.ts) перевіряє `accessToken` двома незалежними способами:
  підпис (HMAC, `token.ts`) і `user.tokensInvalidBefore` (порівняння з `payload.iat`). **Жодного зв'язку між
  `accessToken` і конкретним `refreshToken`/сесією в БД немає** — access token сам по собі stateless.

## Ключове архітектурне обмеження (прочитати перед реалізацією)

`accessToken` — **не JWT у класичному сенсі відкликання**, а підписаний HMAC-токен без будь-якого стану в БД
([token.ts](../src/modules/auth/token.ts)). Logout може миттєво й надійно відкликати `refreshToken` (рядок у БД —
`revokedAt`), але **не може миттєво інвалідувати вже виданий `accessToken`** без окремого чорного списку токенів,
якого в проєкті немає (і додавати його для DF-задачі logout — over-engineering, поза скоупом AC).

Наслідок для AC "Після Logout session не може використовуватися як active":
- **Refresh-сесія** — так, миттєво: після logout повторний `POST /auth/refresh` з тим самим `refreshToken`
  поверне `401` (сімейство відкликано).
- **Access token, виданий до logout** — залишається технічно валідним до природного завершення свого TTL
  (7 днів, `ACCESS_TOKEN_TTL_MS` у `token.ts`). Це вже задокументований пробіл проєкту — `sessions.md` окремо
  зазначає, що `AuthGuard`/`login`/`refresh` не мають додаткового шару відкликання access-токенів. Не намагатись
  "закрити" це в рамках logout-задачі; зафіксувати як свідоме обмеження (див. чек-лист нижче).

## Дизайн

### `RefreshTokenService` — додати один метод

```ts
async logout(plainToken: string): Promise<void> {
  const record = await this.prisma.refreshToken.findUnique({
    where: { tokenHash: this.hash(plainToken) },
  });

  if (!record) {
    return; // ідемпотентно: невідомий/вже видалений токен — не помилка
  }

  await this.revokeFamily(record.familyId);
}
```

Не `revokeAllForUser` — логаут завершує **одну** сесію (той family, що відповідає переданому `refreshToken`),
а не всі пристрої користувача. `revokeFamily` вже ідемпотентний (`updateMany({ where: { revokedAt: null } })`),
тож повторний виклик на вже відкликаному family — безпечний no-op.

### Контролер — `AuthController`

Публічний ендпоінт, без `AuthGuard` — так само, як `refresh`, бо ідентифікація відбувається через сам
`refreshToken` у тілі, а не через `Authorization`-заголовок:

```ts
@Post('logout')
@HttpCode(HttpStatus.OK)
@ApiOkResponse({ type: MessageResponseDto })
async logout(@Body() body: RefreshTokenDto) {
  await this.refreshTokenService.logout(body.refreshToken);
  return { message: 'Ви вийшли з системи.' };
}
```

Розмістити одразу після `refresh` (логічне групування: обидва працюють з `refreshToken`).

### DTO / Module wiring

Нічого нового не потрібно: `RefreshTokenDto` і `RefreshTokenService` вже імпортовані в `AuthController`/
`AuthModule` для `refresh`.

## Тест-план

`refresh-token.service.spec.ts` (доповнити, за зразком існуючих тестів на `rotate`/`revokeFamily`):

- валідний, ще не використаний `refreshToken` → `logout()` відкликає весь family (`revokedAt` виставлено на
  всіх рядках family з `revokedAt: null`);
- невідомий/вигаданий токен → `logout()` не кидає виключення, нічого не змінює;
- вже відкликаний токен → повторний `logout()` — безпечний no-op, без помилки;
- після `logout()` — `rotate()` із тим самим токеном повертає `401`.

Controller-тест: `POST /auth/logout` завжди повертає `200 { message }`, незалежно від валідності токена в тілі.

## Чек-лист для рев'ю

- [ ] `RefreshTokenService.logout()` викликає саме `revokeFamily`, не `revokeAllForUser` (не виходить з усіх
      пристроїв) і не просто `update` одного рядка (не залишає інші токени того ж family активними).
- [ ] Невідомий/невалідний/вже відкликаний `refreshToken` у тілі — відповідь усе одно `200`, без винятку.
- [ ] Ендпоінт публічний (без `AuthGuard`), використовує вже існуючий `RefreshTokenDto`.
- [ ] Не додано жодного нового DTO, нової БД-моделі чи нового поля — logout повністю переиспользує те, що вже є.
- [ ] Немає спроби інвалідувати `accessToken` миттєво (чорний список токенів) — це свідомо поза межами задачі
      (див. розділ "Ключове архітектурне обмеження" вище); якщо в реалізації з'явився такий механізм — це
      скоуп-крип, варто обговорити окремо, а не мовчки додавати.
- [ ] Тести з розділу вище присутні й проходять (`npm test`).
