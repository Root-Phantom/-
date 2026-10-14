# سامانه مدیریت معابر شهر پلدختر

سامانه تحت وب برای ثبت، نام‌گذاری و مدیریت معابر و خیابان‌های شهر پلدختر با جدول توصیفی پویا (مشابه ArcGIS).

## امکانات

- **سطوح دسترسی:** کاربر عمومی (بدون ورود، فقط مشاهده و پیشنهاد نام)، مشاهده‌کننده، کارشناس، مدیر کل
- **آپلود شیپ‌فایل** (ZIP) با تشخیص خودکار رمزگذاری فارسی و سیستم تصویر، و تبدیل به WGS84
- **نام‌گذاری معابر** و ویرایش جدول توصیفی، تکی یا گروهی
- **افزودن ستون جدید** به جدول توصیفی با انواع متن، عدد، عدد صحیح، بله/خیر، تاریخ و فهرست بازشو
- **جست‌وجوی حرفه‌ای:** جست‌وجوی آزاد با یکسان‌سازی «ی/ي» و «ک/ك»، شرط‌های چندگانه و/یا، ۱۴ عملگر، فیلتر مکانی با رسم محدوده، مرتب‌سازی
- **پیشنهاد نام توسط شهروندان** و بررسی، تأیید و اعمال آن توسط کارشناس
- **رسم نقطه، خط و چندضلعی** و ویرایش هندسه روی نقشه
- **آرشیو و بازگردانی** عوارض و لایه‌ها
- **تاریخچه نسخه‌ها** برای هر عارضه، با مقدار قبل و بعد هر ستون
- **لاگ کامل سامانه:** چه کسی، چه زمانی، از چه IP، چه کاری انجام داد؛ همراه با فیلتر، آمار و خروجی CSV
- **مدیریت کاربران** و تعیین سطح دسترسی
- خروجی **CSV** (سازگار با اکسل) و **GeoJSON** (سازگار با ArcGIS و QGIS)

## فناوری

| لایه | فناوری |
|---|---|
| بک‌اند | Python 3.12، FastAPI، SQLAlchemy، GeoAlchemy2 |
| پایگاه داده | PostgreSQL 16 + PostGIS 3.4 |
| رابط کاربری | React 18، TypeScript، Vite، Leaflet، فونت وزیرمتن |
| استقرار | Windows Server، سرویس NSSM، IIS (اختیاری) |

## استقرار روی Windows Server

راهنمای کامل گام‌به‌گام با همه دستورها: **[docs/DEPLOY.md](docs/DEPLOY.md)**

خلاصه:

```powershell
cd C:\PoldokhtarGIS\deploy
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\install.ps1 -PostgresPassword "..." -DbPassword "..." -AdminPassword "..."
.\install-service.ps1 -Port 8005
```

## استقرار با Docker روی اوبونتو

راهنمای کامل: **[docs/DEPLOY_DOCKER.md](docs/DEPLOY_DOCKER.md)**

خلاصه: دو سرویس (`backend` شامل رابط کاربری ساخته‌شده، و `db` یعنی PostgreSQL/PostGIS) با `docker-compose.yml` اجرا می‌شوند؛ هرکدام روی پورت جداگانه‌ای در هاست (پیش‌فرض `8005` و `55432`، قابل تغییر در `.env`) تا با سرویس‌های دیگر سرور تداخل نکنند.

```bash
cp .env.docker.example .env && nano .env   # DB_PASSWORD, SECRET_KEY, FIRST_ADMIN_PASSWORD
docker compose build
docker compose up -d
curl http://localhost:8005/api/health
```

## اجرای محیط توسعه

```bash
# پایگاه داده آزمایشی
docker run -d --name pol_pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=poldokhtar_gis -p 55432:5432 postgis/postgis:16-3.4

# بک‌اند
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env    # DATABASE_URL=postgresql+psycopg://postgres:devpass@localhost:55432/poldokhtar_gis
.venv/bin/uvicorn app.main:app --reload --port 8005

# رابط کاربری (پراکسی /api به پورت 8005)
cd frontend
npm install && npm run dev    # http://localhost:8006
```

مستندات API: `http://localhost:8005/api/docs`

## ساختار پروژه

```
backend/app/
  main.py              نقطه ورود و سرو رابط کاربری
  models.py            مدل‌های پایگاه داده (کاربر، لایه، ستون، عارضه، تاریخچه، پیشنهاد، لاگ)
  routers/             API ها: auth, users, layers, features, search, suggestions, audit, upload, export
  services/            خواندن شیپ‌فایل و ساخت پرس‌وجوی جست‌وجو
frontend/src/
  App.tsx              پوسته اصلی
  components/          نقشه، جدول توصیفی، جست‌وجو، فرم‌ها
  admin/               لایه‌ها و ستون‌ها، آپلود، کاربران، لاگ، پیشنهادها
deploy/                اسکریپت‌های نصب، سرویس، پشتیبان‌گیری، به‌روزرسانی و web.config
docs/DEPLOY.md         راهنمای استقرار روی Windows Server
docs/DEPLOY_DOCKER.md  راهنمای استقرار با Docker روی اوبونتو
Dockerfile             ساخت ایمیج بک‌اند + رابط کاربری
docker-compose.yml     سرویس‌های backend و db (هرکدام با پورت جداگانه)
.env.docker.example    نمونه تنظیمات Docker Compose
pol_final/             شیپ‌فایل معابر پلدختر (۴۴۸ معبر)
```
