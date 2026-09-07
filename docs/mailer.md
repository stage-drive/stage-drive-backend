# Mailer (Mail Module) — що реалізовано

Модуль [mail](../src/modules/mail/) відправляє email через SMTP за допомогою `@nestjs-modules/mailer` + `nodemailer`. Використовується як внутрішній сервіс (`MailService`), який можна інжектити в інші модулі (`AuthModule`, `UsersModule` тощо), а також має тестовий HTTP-ендпоінт для перевірки відправки вручну.

## Що додано

### 1. Конфіг — [mail.config.ts](../src/modules/mail/mail.config.ts)

`MailConfig` читає з env `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM` через `requireEnv()` (той самий підхід, що й [google-oauth.config.ts](../src/modules/auth/google-oauth.config.ts)). Якщо якась змінна відсутня — застосунок падає одразу при старті, а не при першій спробі відправити лист.

### 2. Модуль — [mail.module.ts](../src/modules/mail/mail.module.ts)

`MailerModule.forRootAsync` збирає SMTP-транспорт із `MailConfig` (`extraProviders`, бо `@nestjs-modules/mailer` не підтримує звичайний `providers`). `secure: true` виставляється автоматично лише для порту `465` (implicit TLS), інакше `false` (STARTTLS на 587). `MailService` експортується з модуля, щоб його можна було інжектити в інші модулі.

### 3. Сервіс — [mail.service.ts](../src/modules/mail/mail.service.ts)

`sendEmail(dto)` викликає `MailerService.sendMail`. Помилки SMTP логуються через `Logger` (з recipient + stack), а назовні кидається загальний `InternalServerErrorException('Failed to send email')` — деталі транспорту (SMTP-помилки, дані про акаунт) клієнту не показуються.

### 4. DTO — [send-mail.dto.ts](../src/modules/mail/dto/send-mail.dto.ts)

`to` (`@IsEmail`), `subject`/`html` (`@IsString @IsNotEmpty`). Валідується глобальним `ValidationPipe` (вже налаштований у [configure-app.ts](../src/configure-app.ts)).

### 5. Тестовий ендпоінт — [mail.controller.ts](../src/modules/mail/mail.controller.ts)

`POST /mail/send` — приймає `SendMailDto`, викликає `MailService.sendEmail`, повертає `{ success: true }`. **Без auth guard** — існує лише для ручного тестування (Postman/curl) під час розробки мейлера. Перед виходом за межі локальної розробки цей ендпоінт треба або захистити guard'ом, або прибрати.

### 6. Тести

[mail.service.spec.ts](../src/modules/mail/mail.service.spec.ts) і [mail.controller.spec.ts](../src/modules/mail/mail.controller.spec.ts) — мокають `MailerService`/`MailService`, перевіряють успішну відправку, обгортання помилки в `InternalServerErrorException` без витоку деталей та логування оригінальної помилки.

## Як налаштувати SMTP локально (важливо!)

**У нас поки немає власного домену й Google Workspace для проєкту.** Тому спільний акаунт (`stage-drive@gmail.com` чи подібний) використовувати не можна — Google App Passwords на звичайному акаунті, яким по черзі користуються різні люди з різних пристроїв, тригерять захист від захоплення акаунта і мовчки блокують SMTP-вхід навіть із коректним паролем (перевірено на практиці — саме так і сталось).

**Кожен розробник має завести власні креденшели у своєму `.env`:**

1. Увімкнути 2-Step Verification на **власному** Google-акаунті: https://myaccount.google.com/signinoptions/two-step-verification
2. Згенерувати особистий App Password: https://myaccount.google.com/apppasswords → назва, наприклад `stage-drive-backend-dev` → скопіювати 16-символьний код одразу після генерації.
3. Прописати у своєму локальному `.env` (не комітити!):
   ```
   MAIL_HOST=smtp.gmail.com
   MAIL_PORT=465
   MAIL_USER=<ваш власний gmail>
   MAIL_PASSWORD=<ваш власний app password>
   MAIL_FROM="Dev Team <ваш власний gmail>"
   ```
4. **Після генерації App Password більше нічого не змінювати** в налаштуваннях безпеки цього акаунта (passkeys, recovery email тощо) — будь-яка зміна 2FA-методів інвалідує вже видані App Passwords.
5. Перезапустити контейнер, щоб підхопити нові значення: `docker compose up -d --force-recreate backend`.

Коли в проєкту з'явиться власний домен / Google Workspace (або перейдемо на транзакційний сервіс типу SendGrid/Mailgun/Resend), ці особисті креденшели будуть замінені на один спільний робочий акаунт для всієї команди.

## Змінні середовища

| Змінна | Приклад | Призначення |
|---|---|---|
| `MAIL_HOST` | `smtp.gmail.com` | SMTP-хост |
| `MAIL_PORT` | `465` або `587` | `465` → implicit TLS, `587` → STARTTLS |
| `MAIL_USER` | `you@gmail.com` | Логін SMTP (ваш особистий акаунт, див. вище) |
| `MAIL_PASSWORD` | `xxxxxxxxxxxxxxxx` | App Password (16 символів, **не** пароль від акаунта) |
| `MAIL_FROM` | `"Dev Team <you@gmail.com>"` | Значення заголовка `From` |

Ці ж змінні прокинуті в `backend` сервіс у [docker-compose.yml](../docker-compose.yml) через `${VAR:-default}`.

## Як перевірити, що працює

```bash
curl -X POST http://localhost:3000/mail/send \
  -H "Content-Type: application/json" \
  -d '{"to":"you@example.com","subject":"Test","html":"<p>hello</p>"}'
```

## Що свідомо не робили (поза межами задачі)

- Немає HTML-шаблонів (Handlebars через `template.dir`) — додати, коли з'являться конкретні листи (запрошення, скидання пароля).
- `PasswordResetToken` і флоу скидання пароля — поза межами поточної задачі за CLAUDE.md, `MailService` лише готовий до того, щоб його підключили пізніше.
- Auth guard на `/mail/send` — ендпоінт існує тільки для ручного тестування, не для продакшн-використання.
