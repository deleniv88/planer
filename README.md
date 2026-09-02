# Плани — PWA-планер

Локальний планер із категоріями, погодинним і місячним виглядом, голосовим вводом через Groq
і фоновими нагадуваннями через web push.

---

## 1. Публікація на GitHub Pages

```bash
cd planner-app
git init && git add . && git commit -m "Планер: перша версія"
git branch -M main
git remote add origin https://github.com/<нік>/planner.git
git push -u origin main
```

Далі **Settings → Pages → Deploy from a branch → main → / (root)**.
Сайт зʼявиться на `https://<нік>.github.io/planner/`.

HTTPS тут обовʼязковий: без нього не працюють ні service worker, ні сповіщення.
Жодних ключів у репозиторії немає — усе вводиться в застосунку і лежить у localStorage браузера.

---

## 2. Supabase

Створіть проєкт на supabase.com, далі:

**а) Таблиці.** SQL Editor → вставити `supabase/schema.sql`.
Перед запуском замініть у блоці `cron.schedule`:
- `PROJECT_REF` — ідентифікатор проєкту з URL (`https://<PROJECT_REF>.supabase.co`)
- `SERVICE_ROLE_KEY` — Settings → API → `service_role`

**б) VAPID-ключі.** Пара вже згенерована:

```
PUBLIC : BLKdsfg2iSFpKRBzHALHlIYVE1iyH2nvNdzBnmMfJvr-jAJr8TCT363FGfsdWK-BDtEnw2qhdDGell2HMZmHl8I
PRIVATE: _UU5N7pK2gKjlokukUYhiLmDgKpZequu5GpkrggZb9E
```

Публічний піде в застосунок, приватний — лише у змінні оточення Supabase.
Приватний нікуди більше не копіюйте. Якщо захочете свою пару: `npx web-push generate-vapid-keys`.

**в) Секрети функції:**

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=BLKdsfg2iSFpKRBzHALHlIYVE1iyH2nvNdzBnmMfJvr-jAJr8TCT363FGfsdWK-BDtEnw2qhdDGell2HMZmHl8I \
  VAPID_PRIVATE_KEY=_UU5N7pK2gKjlokukUYhiLmDgKpZequu5GpkrggZb9E \
  VAPID_SUBJECT=mailto:ваша@пошта
```

**г) Деплой функції:**

```bash
supabase link --project-ref <PROJECT_REF>
supabase functions deploy send-reminders --no-verify-jwt
```

---

## 3. Налаштування в застосунку

Відкрити сайт → тапнути аватар → заповнити:

| Поле | Звідки взяти |
|---|---|
| Groq API key | console.groq.com |
| Supabase URL | Settings → API → Project URL |
| Supabase anon key | Settings → API → `anon public` |
| VAPID public key | публічний ключ вище |

Далі **«Увімкнути фонові нагадування»** → дозволити сповіщення.
Блок діагностики має показати вісім галочок.

На iPhone: відкрити в **Safari** → Поділитись → «На екран Додому» → запускати **тільки з іконки**.
У звичайній вкладці Safari push не працює взагалі.

---

## 4. Як це працює

```
застосунок                        Supabase                    пристрій
─────────                         ────────                    ────────
зберегли справу
  └─ syncReminders()  ──POST──▶   reminders (fire_at)
підписались на push ──POST──▶     push_subscriptions

                        pg_cron щохвилини
                                │
                                ▼
                        send-reminders (Edge Function)
                          fire_at <= now() and sent_at is null
                                │
                                └── web-push ──────────────▶  sw.js → showNotification
```

Локальні `setTimeout` у застосунку лишились як дубль на випадок, коли він відкритий.
Через `tag` сповіщення не задвоюється.

---

## 5. Перевірка, якщо не приходить

```bash
supabase functions logs send-reminders --tail   # чи викликається функція
```

```sql
select * from cron.job_run_details order by start_time desc limit 5;  -- чи працює cron
select * from reminders where sent_at is null order by fire_at;       -- чи долітають нагадування
```

Найчастіші причини: не замінений `PROJECT_REF`/`SERVICE_ROLE_KEY` у cron-джобі,
не виставлені секрети функції, або на iOS застосунок відкритий у вкладці, а не з іконки.

---

## 6. Що варто зробити далі

- **Auth.** Зараз доступ до таблиць іде по anon key, тобто будь-хто з ключем може в них писати.
  Для особистого застосунку прийнятно, для публічного — ні. Додайте Supabase Auth і замініть
  політики RLS на `auth.uid() = user_id`.
- **Groq за проксі.** Ключ зараз лежить у localStorage і йде з браузера напряму. Правильніше —
  ще одна Edge Function, яка тримає ключ у секретах і проксіює запити до Groq. Заодно зніме
  можливі проблеми з CORS.
- **Синхронізація справ.** Самі завдання поки лише в localStorage — на іншому пристрої їх не буде.
  У Supabase їде тільки черга нагадувань.
- **Повторювані справи** через RRULE.
