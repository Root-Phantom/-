# راهنمای استقرار سامانه با Docker روی اوبونتو

این راهنما استقرار سامانه مدیریت معابر شهر پلدختر را با **Docker و Docker Compose** روی **Ubuntu Server 22.04 / 24.04** شرح می‌دهد. در این روش نیازی به نصب دستی Python، Node.js یا PostgreSQL روی سرور نیست؛ همه چیز داخل کانتینر اجرا می‌شود.

---

## فهرست

0. [معماری و پورت‌ها](#0-معماری-و-پورتها)
1. [نصب Docker روی اوبونتو](#1-نصب-docker-روی-اوبونتو)
2. [انتقال فایل‌ها به سرور](#2-انتقال-فایلها-به-سرور)
3. [تنظیم فایل .env](#3-تنظیم-فایل-env)
4. [ساخت و اجرا](#4-ساخت-و-اجرا)
5. [دسترسی از شبکه و فایروال](#5-دسترسی-از-شبکه-و-فایروال)
6. [نخستین ورود و درون‌ریزی شیپ‌فایل](#6-نخستین-ورود-و-درونریزی-شیپفایل)
7. [پشتیبان‌گیری و بازیابی](#7-پشتیبانگیری-و-بازیابی)
8. [به‌روزرسانی نسخه](#8-بهروزرسانی-نسخه)
9. [مدیریت کاربران از خط فرمان](#9-مدیریت-کاربران-از-خط-فرمان)
10. [HTTPS با پروکسی معکوس (اختیاری)](#10-https-با-پروکسی-معکوس-اختیاری)
11. [عیب‌یابی](#11-عیبیابی)
12. [خلاصه دستورها](#12-خلاصه-دستورها)

---

## 0. معماری و پورت‌ها

```
 مرورگر کاربران ──HTTP/HTTPS──► کانتینر backend (FastAPI/Uvicorn + رابط کاربری React)
                                        │
                                        ▼
                                 کانتینر db (PostgreSQL 16 + PostGIS 3.4)
```

دو سرویس با `docker-compose.yml` در ریشه پروژه مدیریت می‌شوند و هرکدام **پورت جداگانه‌ای روی هاست** می‌گیرند تا با سرویس‌های احتمالاً از قبل نصب‌شده روی سرور (مثلاً یک PostgreSQL دیگر، یا سرویسی روی 8000) تداخل نکنند:

| سرویس | پورت داخل کانتینر | پورت پیش‌فرض روی هاست | متغیر در `.env` |
|---|---|---|---|
| backend (سامانه + رابط کاربری) | 8000 | **8005** | `APP_PORT` |
| db (PostgreSQL/PostGIS) | 5432 | **55432** | `DB_PORT` |

> پورت‌ها دلخواه‌اند؛ اگر 8005 یا 55432 روی سرور شما هم اشغال بود، در فایل `.env` مقدار دیگری بدهید (مثلاً `APP_PORT=8101`) و دوباره `docker compose up -d` بزنید. پورت پایگاه داده فقط برای دسترسی مدیریتی (psql، ابزار گرافیکی) لازم است؛ در محیط عملیاتی بهتر است در فایروال بسته بماند (بخش ۵).

داده‌های پایگاه داده و فایل‌های آپلودی در دو **volume داکر** (`pgdata` و `uploads`) نگه داشته می‌شوند، پس با توقف یا بازسازی کانتینرها از بین نمی‌روند.

---

## 1. نصب Docker روی اوبونتو

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# اجرای docker بدون sudo (پس از این دستور باید یک بار از سرور خارج و دوباره وارد شوید)
sudo usermod -aG docker "$USER"
```

بررسی نصب:

```bash
docker --version
docker compose version
```

---

## 2. انتقال فایل‌ها به سرور

کل پوشه پروژه را به مسیری مثل `/opt/poldokhtar-gis` روی سرور منتقل کنید (با `git clone`، `scp` یا `rsync`). پوشه‌های `backend/.venv`، `frontend/node_modules` و `frontend/dist` لازم نیست منتقل شوند؛ داخل ایمیج ساخته می‌شوند.

```bash
sudo mkdir -p /opt/poldokhtar-gis
sudo chown "$USER" /opt/poldokhtar-gis
# مثال با rsync از رایانه توسعه:
#   rsync -avz --exclude 'frontend/node_modules' --exclude 'frontend/dist' \
#         --exclude 'backend/.venv' --exclude 'backend/.env' --exclude '.git' \
#         ./ user@server:/opt/poldokhtar-gis/
cd /opt/poldokhtar-gis
```

---

## 3. تنظیم فایل .env

```bash
cp .env.docker.example .env
nano .env
```

حداقل این مقادیر را عوض کنید:

- `DB_PASSWORD` — گذرواژه کاربر پایگاه داده
- `SECRET_KEY` — یک مقدار تصادفی (دستور زیر):

```bash
docker run --rm python:3.12-slim python -c "import secrets; print(secrets.token_urlsafe(48))"
```

- `FIRST_ADMIN_PASSWORD` — گذرواژه اولیه مدیر سامانه (حداقل ۸ نویسه، حرف و رقم)

در صورت نیاز `APP_PORT` و `DB_PORT` را هم مطابق بخش ۰ تغییر دهید. فایل `.env` حاوی رمزهاست و در `.gitignore` قرار دارد؛ هرگز آن را commit نکنید.

---

## 4. ساخت و اجرا

```bash
docker compose build
docker compose up -d
```

وضعیت و لاگ‌ها:

```bash
docker compose ps
docker compose logs -f backend
```

سرویس آماده است وقتی `docker compose ps` هر دو کانتینر را `healthy`/`running` نشان دهد. بررسی سلامت:

```bash
curl http://localhost:8005/api/health
```

خروجی باید `"status":"ok"` و نسخه PostGIS را نشان دهد (ساخت جداول و کاربر مدیر اولیه به‌صورت خودکار در نخستین اجرا انجام می‌شود).

- سامانه: `http://IP-سرور:8005`
- مستندات API: `http://IP-سرور:8005/api/docs`

توقف / اجرای دوباره:

```bash
docker compose down        # توقف (داده‌ها در volume باقی می‌مانند)
docker compose up -d       # اجرای دوباره
```

---

## 5. دسترسی از شبکه و فایروال

اگر از `ufw` استفاده می‌کنید، فقط پورت سامانه را باز کنید؛ پورت پایگاه داده را **باز نکنید** مگر برای اتصال مدیریتی موقت از IP مشخص لازم باشد:

```bash
sudo ufw allow 8005/tcp
sudo ufw status
```

برای بستن موقتاً پورت پایگاه داده از دسترسی شبکه بدون حذف نگاشت آن، می‌توانید در `docker-compose.yml` بخش `ports` سرویس `db` را کامنت کنید و فقط شبکه داخلی داکر (سرویس `db` با نام میزبان `db` و پورت 5432) برای `backend` باقی بماند.

---

## 6. نخستین ورود و درون‌ریزی شیپ‌فایل

مطابق [docs/DEPLOY.md](DEPLOY.md#10-نخستین-ورود-و-درونریزی-شیپفایل-پلدختر) با کاربر `admin` و گذرواژه‌ای که در `FIRST_ADMIN_PASSWORD` دادید وارد شوید، گذرواژه را تغییر دهید، سپس شیپ‌فایل `pol_final` را فشرده و از تب «آپلود شیپ‌فایل» درون‌ریزی کنید.

---

## 7. پشتیبان‌گیری و بازیابی

### پشتیبان دستی

```bash
docker compose exec -T db pg_dump -U pol_user -Fc poldokhtar_gis > backup_$(date +%Y%m%d_%H%M%S).dump
```

(اگر `DB_USER`/`DB_NAME` را در `.env` عوض کرده‌اید، همان مقادیر را جای `pol_user`/`poldokhtar_gis` بگذارید.)

### بازیابی

```bash
cat backup_20260101_020000.dump | docker compose exec -T db pg_restore -U pol_user -d poldokhtar_gis --clean --if-exists --no-owner
```

### پشتیبان خودکار روزانه (crontab)

```bash
crontab -e
```

یک سطر مانند زیر اضافه کنید (ساعت ۲ بامداد، نگه‌داری ۳۰ روز):

```cron
0 2 * * * cd /opt/poldokhtar-gis && docker compose exec -T db pg_dump -U pol_user -Fc poldokhtar_gis > /opt/backups/poldokhtar_$(date +\%Y\%m\%d).dump && find /opt/backups -name 'poldokhtar_*.dump' -mtime +30 -delete
```

> پوشه آپلودها (`uploads` volume) را هم به‌صورت دوره‌ای پشتیبان بگیرید: `docker run --rm -v poldokhtar-gis_uploads:/data -v $PWD:/backup alpine tar czf /backup/uploads.tgz -C /data .` (نام دقیق volume را با `docker volume ls` بررسی کنید).

---

## 8. به‌روزرسانی نسخه

```bash
cd /opt/poldokhtar-gis
git pull            # یا کپی فایل‌های جدید روی همین مسیر (بدون دست‌زدن به .env)
docker compose build
docker compose up -d
docker compose logs -f backend   # بررسی راه‌اندازی موفق
```

فایل `.env` و volume های `pgdata`/`uploads` در این فرایند دست‌نخورده باقی می‌مانند. جداول جدید پایگاه داده (در صورت وجود) به‌صورت خودکار در راه‌اندازی بعدی ساخته می‌شوند.

---

## 9. مدیریت کاربران از خط فرمان

ابزار `app.manage` (همان ابزار استفاده‌شده در استقرار ویندوز) داخل کانتینر backend هم موجود است:

```bash
docker compose exec backend python -m app.manage list-users
docker compose exec backend python -m app.manage create-admin --username admin2 --full-name "مدیر دوم"
docker compose exec backend python -m app.manage reset-password --username admin
```

---

## 10. HTTPS با پروکسی معکوس (اختیاری)

برای محیط عملیاتی توصیه می‌شود یک پروکسی معکوس (Nginx یا Caddy) روی پورت 80/443 جلوی `backend` قرار گیرد و گواهی Let's Encrypt بگیرد. در این حالت در `.env`:

```ini
COOKIE_SECURE=true
TRUST_PROXY_HEADERS=true
```

و پروکسی را به `http://127.0.0.1:8005` (یا هر `APP_PORT` انتخابی) هدایت کنید. نصب و تنظیم دقیق Nginx/Caddy/Let's Encrypt در این راهنما نیامده و باید جدا انجام شود.

---

## 11. عیب‌یابی

| نشانه | علت محتمل | راه‌حل |
|---|---|---|
| `docker compose up` خطای «variable is not set» می‌دهد | `.env` ساخته نشده یا مقداری خالی است | بخش ۳؛ `cp .env.docker.example .env` و پر کردن مقادیر |
| کانتینر `db` بالا نمی‌آید یا `backend` دائم ری‌استارت می‌شود | گذرواژه پایگاه داده نادرست یا `db` هنوز سالم نیست | `docker compose logs db` و `docker compose logs backend` |
| `/api/health` خطای database می‌دهد | سرویس `db` هنوز در حال راه‌اندازی است | چند ثانیه صبر کنید؛ `docker compose ps` باید `db` را healthy نشان دهد |
| پورت 8005 یا 55432 از قبل اشغال است | سرویس دیگری همان پورت را گرفته | `APP_PORT`/`DB_PORT` را در `.env` عوض کنید و `docker compose up -d` |
| صفحه «رابط کاربری ساخته نشده است» | ساخت frontend در ایمیج شکست خورده | `docker compose build --no-cache backend` و بررسی خروجی مرحله `frontend-build` |
| تغییرات کد پس از `git pull` دیده نمی‌شود | ایمیج بازسازی نشده | `docker compose build && docker compose up -d` |

بررسی سریع وضعیت:

```bash
docker compose ps
docker compose logs --tail=100 backend
curl -s http://localhost:8005/api/health | python3 -m json.tool
```

---

## 12. خلاصه دستورها

```bash
# ---------- نصب Docker ----------
# (بخش ۱)

# ---------- راه‌اندازی ----------
cd /opt/poldokhtar-gis
cp .env.docker.example .env && nano .env
docker compose build
docker compose up -d
docker compose ps

# ---------- مدیریت ----------
docker compose logs -f backend
docker compose restart backend
docker compose down
docker compose up -d

# ---------- پشتیبان‌گیری / بازیابی ----------
docker compose exec -T db pg_dump -U pol_user -Fc poldokhtar_gis > backup.dump
cat backup.dump | docker compose exec -T db pg_restore -U pol_user -d poldokhtar_gis --clean --if-exists --no-owner

# ---------- کاربران ----------
docker compose exec backend python -m app.manage list-users
docker compose exec backend python -m app.manage create-admin --username admin2

# ---------- به‌روزرسانی ----------
git pull && docker compose build && docker compose up -d
```
