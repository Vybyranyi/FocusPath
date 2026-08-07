# FocusPath — API

Express 5 + Mongoose 8 + TypeScript. Загальний опис проєкту — у
[кореневому README](../README.md), архітектура — у [`DESIGN.md`](../DESIGN.md),
довідник ендпоінтів — у [`docs/API.md`](../docs/API.md).

## Запуск

Зазвичай сервер піднімають разом із клієнтом із кореня (`npm run dev`). Окремо:

```bash
npm install
npm run dev        # http://localhost:3000
```

Оточення читається з **кореневого** `.env` — `src/server.ts` завантажує його
явно через `dotenv.config({ path: '../../.env' })`. Свій `.env` у цій теці
створювати не треба. Мінімум для старту: `MONGO_URI` і `JWT_SECRET`. Повна
таблиця змінних — у [кореневому README](../README.md#змінні-оточення).

## Команди

| Команда | Що робить |
| --- | --- |
| `npm run dev` | nodemon + ts-node з підтримкою аліасів |
| `npm run build` | `tsc && tsc-alias` у `dist/` |
| `npm start` | Запуск зібраного `dist/server.js` |
| `npm run typecheck` | Перевірка типів без емісії |
| `npm run lint` | ESLint |
| `npm test` | Jest |
| `npm run test:coverage` | Jest із покриттям |
| `npm run seed:admin` | Створює акаунт із `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| `npm run migrate:day-status` | Переносить `dailyCompletions[].completed` у `status`. Разова, ідемпотентна; виконати перед розгортанням релізу з enum |

`tsc-alias` у збірці обов'язковий: сам `tsc` лишає аліаси шляхів у
згенерованому JS, і без цього кроку зібраний сервер не стартує.

## Шари

```
src/
├── app.ts            складання middleware (порядок має значення)
├── server.ts         точка входу: .env, підключення до БД, listen
├── routes/           маршрути: middleware + схеми валідації
├── controllers/      тонкі: HTTP ↔ виклик сервісу
├── services/         бізнес-логіка, перевірка власника, робота з моделями
├── models/           схеми Mongoose, індекси, toJSON-трансформи
├── validation/       Zod-схеми, з яких виводяться типи DTO
├── middlewares/      auth, csrf, rateLimit, validate, errorHandler
├── errors/           AppError і його підкласи
├── config/           auth, cors, db, logger, mongoose
├── utils/            токени, cookie, паролі, дати, аватар, конверт відповіді
└── scripts/          seedAdmin
```

Правила, яких дотримується весь наявний код:

- **Контролери кидають, а не ловлять.** Express 5 сам передає відхилені проміси
  в `errorHandler`. Жодного `try/catch` у контролерах немає.
- **Відповіді формують тільки `ok` / `created`** з `utils/apiResponse.ts`.
  `res.json` напряму не викликається ніде; `fail` викликає лише обробник
  помилок.
- **Перевірка власника — у сервісах.** `requireOwnedHabit` скоупить кожен
  пошук за `userId`. Запитувати модель `Habit` напряму з контролера не можна.
- **Моделі зрізають секрети самі.** `toJSON` видаляє `password`,
  `tokenVersion`, `refreshSessions`, `userId` і `__v`, тож жоден контролер не
  може про це забути.

Як додати ендпоінт крок за кроком — у
[`CONTRIBUTING.md`](../CONTRIBUTING.md#як-додати-ендпоінт).

## Порядок middleware

У `app.ts` порядок не довільний:

1. `pino-http` — лог кожного запиту.
2. `helmet` — з `crossOriginResourcePolicy: cross-origin`, бо клієнт живе на
   іншому origin і дефолт helmet його б заблокував.
3. `cors` — список дозволених origin із `CORS_ORIGIN`.
4. `express.json` — ліміт 2 МБ (вистачає на base64-аватар, але не дає вичерпати
   пам'ять тілом запиту).
5. `cookie-parser` — **має бути перед CSRF**, інакше порівнювати нічого.
6. `csrfProtection` — перед будь-яким маршрутом, що змінює стан.
7. `apiLimiter` — загальне обмеження частоти.
8. Маршрути.
9. `notFoundHandler`, потім `errorHandler` — **обидва останні, саме в цьому
   порядку**: незнайдений маршрут стає `NotFoundError` і малюється тим самим
   обробником, що й будь-яка інша помилка.

`app.set('trust proxy', 1)` потрібен, бо деплой стоїть за одним проксі — без
нього всі клієнти виглядали б для лімітерів як одна адреса.

## Аліаси

`@app`, `@config/*`, `@models/*`, `@controllers/*`, `@middlewares/*`,
`@routes/*`, `@utils/*`, `@services/*`, `@errors/*`, `@validation/*`,
`@shared/*`.

Оголошені **двічі** — у `tsconfig.json` (`paths`) для компілятора і в
`jest.config.ts` (`moduleNameMapper`) для тестів. Новий аліас треба додати в
обидва місця.

## Тести

Jest + supertest + `mongodb-memory-server`. Ні `.env`, ні працююча база не
потрібні:

- `jest.env.ts` (`setupFiles`) виставляє `NODE_ENV`, `JWT_SECRET`,
  `BCRYPT_ROUNDS=4` і `CORS_ORIGIN` **до** імпорту будь-якого модуля — кілька
  модулів читають `process.env` на етапі імпорту.
- `jest.setup.ts` піднімає MongoDB у пам'яті на прогін і чистить усі колекції
  після кожного тесту.
- Лімітери частоти під `NODE_ENV=test` вимкнені: сьют логіниться значно частіше
  за реального клієнта, і з ними тест міряв би лімітер.

Перший прогін завантажує бінарник `mongod` (~100 МБ) і триває довше. Далі він
кешується в `~/.cache/mongodb-binaries`.

```bash
npm test
npm test -- src/services/habitSchedule.test.ts
```

## Особливість ts-node

У `tsconfig.json` є `"ts-node": { "files": true }` — і це не косметика.
ts-node компілює файли поодинці й інакше ніколи не завантажив би ambient-
декларації, які ніхто не імпортує, зокрема `src/types/express.d.ts`, що додає
`userId` до `Request`. Приберіть цей рядок — і dev-сервер перестане стартувати,
хоча `tsc` і тести лишатимуться задоволені.
