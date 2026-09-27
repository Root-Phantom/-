# راهنمای کامل استقرار سامانه مدیریت معابر شهر پلدختر روی Windows Server

این راهنما همه مراحل نصب سامانه را روی **Windows Server 2016 / 2019 / 2022 / 2025** از صفر تا راه‌اندازی سرویس، HTTPS، پشتیبان‌گیری و به‌روزرسانی شرح می‌دهد. همه دستورها در **PowerShell با دسترسی Administrator** اجرا می‌شوند.

---

## فهرست

0. [معماری و پیش‌نیازها](#0-معماری-و-پیشنیازها)
1. [انتقال فایل‌ها به سرور](#1-انتقال-فایلها-به-سرور)
2. [نصب Python 3.12](#2-نصب-python-312)
3. [نصب PostgreSQL 16 و PostGIS](#3-نصب-postgresql-16-و-postgis)
4. [نصب Node.js (اختیاری)](#4-نصب-nodejs-اختیاری)
5. [دریافت NSSM](#5-دریافت-nssm)
6. [اجرای اسکریپت نصب](#6-اجرای-اسکریپت-نصب)
7. [اجرای آزمایشی](#7-اجرای-آزمایشی)
8. [نصب به‌عنوان سرویس ویندوز](#8-نصب-بهعنوان-سرویس-ویندوز)
9. [دسترسی از شبکه](#9-دسترسی-از-شبکه)
10. [نخستین ورود و درون‌ریزی شیپ‌فایل پلدختر](#10-نخستین-ورود-و-درونریزی-شیپفایل-پلدختر)
11. [IIS و HTTPS (پیشنهادی برای محیط عملیاتی)](#11-iis-و-https)
12. [پشتیبان‌گیری و بازیابی](#12-پشتیبانگیری-و-بازیابی)
13. [به‌روزرسانی نسخه](#13-بهروزرسانی-نسخه) · [ساخت مدیر و بازیابی گذرواژه](#105-ساخت-مدیر-و-بازیابی-گذرواژه)
14. [نصب روی سرور بدون اینترنت](#14-نصب-روی-سرور-بدون-اینترنت)
15. [عیب‌یابی](#15-عیبیابی)
16. [چک‌لیست امنیتی](#16-چکلیست-امنیتی)
17. [خلاصه دستورها](#17-خلاصه-دستورها)

---

## 0. معماری و پیش‌نیازها

```
 مرورگر کاربران  ──HTTP/HTTPS──►  [ IIS (اختیاری) ]  ──►  سرویس ویندوز PoldokhtarGIS
                                                         (Python / FastAPI / Uvicorn)
                                                          │  رابط کاربری React (پوشه dist)
                                                          ▼
                                                   PostgreSQL 16 + PostGIS 3.4
```

| مؤلفه | فناوری | دلیل انتخاب |
|---|---|---|
| بک‌اند | Python 3.12 + FastAPI | نصب با یک فایل، بدون نیاز به کامپایلر؛ همه کتابخانه‌ها برای ویندوز بسته آماده دارند |
| پایگاه داده | PostgreSQL 16 + PostGIS | نصب‌کننده رسمی ویندوز؛ قوی‌ترین پایگاه داده مکانی متن‌باز |
| رابط کاربری | React + Leaflet | به فایل‌های ایستا تبدیل می‌شود و توسط همان سرویس پایتون سرو می‌شود |
| سرویس | NSSM | اجرای خودکار با روشن شدن سرور و راه‌اندازی مجدد در صورت خطا |
| شیپ‌فایل | pyshp (خالص پایتون) | بدون نیاز به GDAL که نصبش روی ویندوز دشوار است |

**سخت‌افزار پیشنهادی:** ۴ هسته CPU، ۸ گیگابایت RAM، ۵۰ گیگابایت دیسک.

**پورت‌ها:** سامانه `8000` (یا 80/443 با IIS)، PostgreSQL `5432` (فقط محلی؛ نباید در شبکه باز باشد).

> **نقشه پایه:** لایه‌های OpenStreetMap و تصویر ماهواره‌ای از اینترنت و **در مرورگر کاربر** بارگذاری می‌شوند. اگر رایانه کاربران اینترنت نداشته باشند، لایه‌های معابر و جدول توصیفی کار می‌کنند ولی نقشه زمینه خاکستری دیده می‌شود (گزینه «بدون نقشه پایه»).

---

## 1. انتقال فایل‌ها به سرور

کل پوشه پروژه را به مسیر **`C:\PoldokhtarGIS`** کپی کنید. مسیر نصب نباید فاصله یا حروف فارسی داشته باشد.

ساختار نهایی:

```
C:\PoldokhtarGIS\
├── backend\          کد سرور (Python)
├── frontend\         کد رابط کاربری (و پوشه dist ساخته‌شده)
├── deploy\           اسکریپت‌های نصب، سرویس، پشتیبان‌گیری و web.config
├── docs\             همین راهنما
└── pol_final\        شیپ‌فایل معابر پلدختر
```

پوشه‌های `backend\.venv` و `frontend\node_modules` را **کپی نکنید**؛ روی سرور ساخته می‌شوند.

پس از کپی، مسدودیت فایل‌های دانلودی را بردارید و اجازه اجرای اسکریپت را در همین پنجره بدهید:

```powershell
Get-ChildItem C:\PoldokhtarGIS -Recurse | Unblock-File
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
```

---

## 2. نصب Python 3.12

1. نسخه **Windows installer (64-bit)** پایتون 3.12 را از <https://www.python.org/downloads/windows/> دریافت کنید (مثلاً `python-3.12.10-amd64.exe`).
2. نصب بی‌صدا برای همه کاربران (در پوشه‌ای که فایل دانلود شده):

```powershell
.\python-3.12.10-amd64.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0 Include_launcher=1
```

3. پنجره PowerShell را **ببندید و دوباره باز کنید**، سپس بررسی کنید:

```powershell
py -3.12 --version
python --version
```

خروجی باید `Python 3.12.x` باشد.

---

## 3. نصب PostgreSQL 16 و PostGIS

### 3.1 نصب PostgreSQL

1. نصب‌کننده **PostgreSQL 16 برای Windows x86-64** را از <https://www.enterprisedb.com/downloads/postgres-postgresql-downloads> دریافت کنید.
2. نصب بی‌صدا (یک گذرواژه قوی برای کاربر `postgres` انتخاب و **یادداشت کنید**):

```powershell
.\postgresql-16.8-1-windows-x64.exe --mode unattended --unattendedmodeui minimal `
    --superpassword "PgSuper@2025" --serverport 5432 --locale "English, United States" --install_runtimes 0
```

یا نصب‌کننده را معمولی اجرا کنید و گزینه‌ها را پیش‌فرض بگذارید.

3. بررسی سرویس و اتصال:

```powershell
Get-Service postgresql*
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "SELECT version();"
```

### 3.2 نصب PostGIS

**روش الف — Stack Builder (ساده‌ترین):**
1. از منوی Start برنامه **Application Stack Builder** را اجرا کنید.
2. سرور `PostgreSQL 16 on port 5432` را انتخاب کنید.
3. در بخش **Spatial Extensions** گزینه **PostGIS 3.4 Bundle for PostgreSQL 16** را تیک بزنید و نصب کنید.
4. در پرسش «Create spatial database» گزینه را **تیک نزنید** (اسکریپت نصب پایگاه داده را می‌سازد).

**روش ب — نصب‌کننده مستقیم (برای سرور بدون دسترسی Stack Builder):**
فایل `postgis-bundle-pg16x64-setup-3.4.x-1.exe` را از <https://download.osgeo.org/postgis/windows/pg16/> دریافت و اجرا کنید.

بررسی نصب PostGIS:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "SELECT name, default_version FROM pg_available_extensions WHERE name='postgis';"
```

باید یک ردیف با نسخه 3.4 نمایش داده شود.

> **امنیت:** PostgreSQL به‌صورت پیش‌فرض فقط به `localhost` گوش می‌دهد. پورت 5432 را در فایروال باز نکنید.

---

## 4. نصب Node.js (اختیاری)

Node.js **فقط برای ساختن رابط کاربری** لازم است. دو راه دارید:

**راه اول — ساخت روی سرور:** Node.js 20 LTS را از <https://nodejs.org> دریافت و نصب کنید:

```powershell
msiexec /i node-v20.19.0-x64.msi /qn
```

پنجره PowerShell را دوباره باز کنید و `npm --version` را بررسی کنید. اسکریپت نصب خودش رابط کاربری را می‌سازد.

**راه دوم — بدون Node روی سرور:** روی یک رایانه دیگر که Node دارد، در پوشه `frontend` دستورهای زیر را اجرا کنید و پوشه `frontend\dist` را به همان مسیر در سرور کپی کنید:

```powershell
npm ci
npm run build
```

سپس اسکریپت نصب را با سوییچ `-SkipFrontendBuild` اجرا کنید.

---

## 5. دریافت NSSM

1. NSSM 2.24 را از <https://nssm.cc/download> دریافت کنید.
2. فایل `nssm-2.24\win64\nssm.exe` را در این مسیر قرار دهید:

```powershell
New-Item -ItemType Directory -Force C:\PoldokhtarGIS\deploy\tools
Copy-Item "$env:USERPROFILE\Downloads\nssm-2.24\win64\nssm.exe" C:\PoldokhtarGIS\deploy\tools\
```

---

## 6. اجرای اسکریپت نصب

```powershell
cd C:\PoldokhtarGIS\deploy
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

.\install.ps1 `
    -PostgresPassword "PgSuper@2025" `
    -DbPassword       "PolDb@2025!x" `
    -AdminPassword    "Admin@2025"
```

| پارامتر | توضیح | پیش‌فرض |
|---|---|---|
| `-PostgresPassword` | گذرواژه کاربر `postgres` (مرحله 3.1) | اجباری |
| `-DbPassword` | گذرواژه کاربر اختصاصی سامانه در پایگاه داده (جدید) | اجباری |
| `-AdminPassword` | گذرواژه اولیه مدیر سامانه (حداقل ۸ نویسه، حرف و رقم) | اجباری |
| `-AdminUsername` | نام کاربری مدیر اولیه | `admin` |
| `-DbName` / `-DbUser` | نام پایگاه داده و کاربر آن | `poldokhtar_gis` / `pol_user` |
| `-AppPort` | پورت سامانه | `8000` |
| `-PgBin` | مسیر پوشه bin پستگرس اگر خودکار پیدا نشد | خودکار |
| `-PythonExe` | مسیر python.exe اگر خودکار پیدا نشد | خودکار |
| `-BehindIIS` | سامانه پشت IIS و HTTPS اجرا می‌شود (بخش 11) | خاموش |
| `-SkipFrontendBuild` | استفاده از `frontend\dist` آماده | خاموش |
| `-WheelsDir` | نصب آفلاین بسته‌های پایتون (بخش 14) | — |
| `-OverwriteEnv` | ساخت دوباره فایل `backend\.env` | خاموش |

> گذرواژه‌ها نباید نویسه `"` داشته باشند.

اسکریپت به ترتیب این کارها را انجام می‌دهد و در پایان پیام `Installation completed successfully` نمایش می‌دهد:

1. یافتن Python و psql
2. ساخت کاربر `pol_user` و پایگاه داده `poldokhtar_gis` و فعال‌سازی `postgis` و `pg_trgm`
3. ساخت محیط مجازی `backend\.venv` و نصب بسته‌ها
4. ساخت `backend\.env` با کلید امنیتی تصادفی
5. ساخت جداول و کاربر مدیر اولیه (و حذف گذرواژه اولیه از `.env`)
6. ساخت رابط کاربری
7. باز کردن پورت در فایروال

اسکریپت را می‌توان بدون خطر دوباره اجرا کرد.

#### معادل دستی مراحل پایگاه داده (در صورت نیاز)

```powershell
$env:PGPASSWORD = "PgSuper@2025"
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
& $psql -U postgres -c "CREATE ROLE pol_user WITH LOGIN PASSWORD 'PolDb@2025!x';"
& $psql -U postgres -c "CREATE DATABASE poldokhtar_gis OWNER pol_user ENCODING 'UTF8' TEMPLATE template0;"
& $psql -U postgres -d poldokhtar_gis -c "CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm; GRANT ALL ON SCHEMA public TO pol_user;"
Remove-Item Env:\PGPASSWORD
```

#### معادل دستی مراحل پایتون

```powershell
cd C:\PoldokhtarGIS\backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env      # سپس .env را با Notepad ویرایش کنید
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe -m app.seed
```

ساخت کلید امنیتی تصادفی برای `SECRET_KEY`:

```powershell
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
```

---

## 7. اجرای آزمایشی

```powershell
cd C:\PoldokhtarGIS\deploy
.\run-server.ps1 -Port 8000
```

در مرورگر سرور باز کنید:

- سامانه: <http://localhost:8000>
- وضعیت سلامت: <http://localhost:8000/api/health>
- مستندات API: <http://localhost:8000/api/docs>

یا از PowerShell دیگر:

```powershell
Invoke-RestMethod http://localhost:8000/api/health
```

خروجی باید `status : ok` و نسخه PostGIS را نشان دهد. با `Ctrl+C` متوقف کنید.

---

## 8. نصب به‌عنوان سرویس ویندوز

```powershell
cd C:\PoldokhtarGIS\deploy
.\install-service.ps1 -Port 8000
```

| پارامتر | توضیح | پیش‌فرض |
|---|---|---|
| `-ServiceName` | نام سرویس | `PoldokhtarGIS` |
| `-Port` | پورت | `8000` |
| `-BindAddress` | `0.0.0.0` برای دسترسی مستقیم از شبکه، `127.0.0.1` پشت IIS | `0.0.0.0` |
| `-Workers` | تعداد پردازش‌های هم‌زمان | `2` |

سرویس با روشن شدن سرور خودکار اجرا می‌شود، پس از PostgreSQL شروع می‌شود و در صورت خطا پس از ۵ ثانیه دوباره راه‌اندازی می‌شود.

مدیریت سرویس:

```powershell
Get-Service PoldokhtarGIS
Restart-Service PoldokhtarGIS
Stop-Service PoldokhtarGIS
Start-Service PoldokhtarGIS
Get-Content C:\PoldokhtarGIS\backend\logs\service.log -Tail 50 -Wait     # مشاهده زنده لاگ سرویس
```

حذف سرویس (داده‌ها حفظ می‌شوند):

```powershell
.\uninstall-service.ps1
```

---

## 9. دسترسی از شبکه

اسکریپت نصب قاعده فایروال `PoldokhtarGIS-HTTP-8000` را می‌سازد. آدرس IP سرور را پیدا کنید:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object IPAddress, InterfaceAlias
```

کاربران سامانه را با `http://IP-سرور:8000` باز می‌کنند. ساخت یا حذف دستی قاعده فایروال:

```powershell
New-NetFirewallRule -DisplayName "PoldokhtarGIS-HTTP-8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
Remove-NetFirewallRule -DisplayName "PoldokhtarGIS-HTTP-8000"
```

---

## 10. نخستین ورود و درون‌ریزی شیپ‌فایل پلدختر

1. سامانه را باز کنید و روی **ورود کارکنان** بزنید؛ با `admin` و گذرواژه‌ای که در مرحله ۶ دادید وارد شوید.
2. سامانه تغییر گذرواژه را درخواست می‌کند؛ گذرواژه جدید تعیین کنید.
3. در سرور، شیپ‌فایل را فشرده کنید:

```powershell
Compress-Archive -Path C:\PoldokhtarGIS\pol_final\pol.* -DestinationPath C:\PoldokhtarGIS\pol_final.zip -Force
```

4. در سامانه به تب **آپلود شیپ‌فایل** بروید، فایل `pol_final.zip` را انتخاب و **آپلود و پیش‌نمایش** را بزنید. باید ۴۴۸ عارضه، نوع «خط / معبر»، سیستم تصویر `EPSG:4326` و رمزگذاری `utf-8` نمایش داده شود.
5. نام لایه را «معابر شهر پلدختر» بگذارید، ستون «نام» را به‌عنوان برچسب انتخاب و **درون‌ریزی** را بزنید.
6. در تب **لایه‌ها و ستون‌ها** ستون‌های جدید (مثلاً «عرض معبر»، «جنس روکش») اضافه کنید.
7. در تب **کاربران** کارشناسان را با سطح دسترسی مناسب تعریف کنید.

### سطوح دسترسی

| نقش | امکانات |
|---|---|
| **کاربر عمومی** (بدون ورود) | مشاهده نقشه و جدول توصیفی، جست‌وجو، خروجی، **پیشنهاد نام معبر** |
| **مشاهده‌کننده** | موارد بالا + مشاهده تاریخچه تغییرات |
| **کارشناس** | موارد بالا + ویرایش و نام‌گذاری معابر، رسم نقطه/خط/چندضلعی، افزودن ستون، آپلود شیپ‌فایل، آرشیو، بررسی پیشنهادها |
| **مدیر کل** | همه موارد + مدیریت کاربران، حذف ستون/لایه/عارضه، آرشیو لایه، **مشاهده لاگ سامانه** |

همه اقدامات (ورود و خروج، تلاش ناموفق ورود، ایجاد/ویرایش/آرشیو/حذف، جست‌وجو، آپلود، خروجی، پیشنهاد و بررسی آن) با نام کاربر، زمان، IP و مقدار قبل و بعد در **لاگ سامانه** ثبت می‌شوند.

### 10.5 ساخت مدیر و بازیابی گذرواژه

**روش عادی (از رابط کاربری):** با حساب مدیر وارد شوید ← تب **👥 کاربران** ← **＋ تعریف کاربر جدید** ← نام کاربری، گذرواژه اولیه و سطح دسترسی «مدیر کل» یا «کارشناس» را انتخاب کنید. کاربر جدید در نخستین ورود گذرواژه را تغییر می‌دهد. ویرایش، غیرفعال‌سازی و بازنشانی گذرواژه هم در همین صفحه است.

**از روی سرور (وقتی نمی‌توانید وارد شوید یا مدیری وجود ندارد):** در PowerShell با دسترسی Administrator:

```powershell
cd C:\PoldokhtarGIS\deploy
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

.\create-admin.ps1 -List                                   # فهرست کاربران
.\create-admin.ps1 -Username admin2 -FullName "مدیر دوم"   # مدیر جدید (گذرواژه پرسیده می‌شود)
.\create-admin.ps1 -Username admin -Force                  # کاربر موجود ← مدیر + گذرواژه جدید
.\create-admin.ps1 -ResetPassword -Username ali            # فراموشی گذرواژه یک کاربر
```

گذرواژه باید حداقل ۸ نویسه و شامل حرف و رقم باشد. نیازی به ری‌استارت سرویس نیست.

---

## 11. IIS و HTTPS

برای محیط عملیاتی پیشنهاد می‌شود سامانه با دامنه و HTTPS و از طریق IIS منتشر شود.

### 11.1 نصب IIS

```powershell
Install-WindowsFeature -Name Web-Server, Web-Mgmt-Console, Web-Http-Redirect -IncludeManagementTools
```

### 11.2 نصب URL Rewrite و ARR

1. **URL Rewrite 2.1** (x64): <https://www.iis.net/downloads/microsoft/url-rewrite>
2. **Application Request Routing 3.0**: <https://www.iis.net/downloads/microsoft/application-request-routing>

```powershell
msiexec /i rewrite_amd64_en-US.msi /qn
msiexec /i requestRouter_amd64.msi /qn
```

### 11.3 فعال‌سازی پروکسی ARR

```powershell
$appcmd = "$env:windir\system32\inetsrv\appcmd.exe"
& $appcmd set config -section:system.webServer/proxy /enabled:"True" /preserveHostHeader:"True" /reverseRewriteHostInResponseHeaders:"False" /timeout:"00:10:00" /includePortInXForwardedFor:"False" /commit:apphost
iisreset
```

### 11.4 ساخت سایت

```powershell
Import-Module WebAdministration
New-Item -ItemType Directory -Force C:\inetpub\poldokhtargis | Out-Null
Copy-Item C:\PoldokhtarGIS\deploy\iis\web.config C:\inetpub\poldokhtargis\web.config

# غیرفعال کردن سایت پیش‌فرض (در صورت نیاز)
Stop-Website -Name "Default Web Site"

New-Website -Name "PoldokhtarGIS" -PhysicalPath C:\inetpub\poldokhtargis -Port 80 -HostHeader "gis.poldokhtar.ir"
```

### 11.5 گواهی HTTPS

با گواهی معتبر (فایل PFX):

```powershell
$pwd = ConvertTo-SecureString "PfxPassword" -AsPlainText -Force
$cert = Import-PfxCertificate -FilePath C:\certs\gis.pfx -CertStoreLocation Cert:\LocalMachine\My -Password $pwd
New-WebBinding -Name "PoldokhtarGIS" -Protocol https -Port 443 -HostHeader "gis.poldokhtar.ir" -SslFlags 1
(Get-WebBinding -Name "PoldokhtarGIS" -Protocol https).AddSslCertificate($cert.Thumbprint, "My")
New-NetFirewallRule -DisplayName "HTTP-HTTPS" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
```

فقط برای آزمایش در شبکه داخلی (گواهی خودامضا):

```powershell
$cert = New-SelfSignedCertificate -DnsName "gis.poldokhtar.local" -CertStoreLocation Cert:\LocalMachine\My
```

> اگر هنوز HTTPS ندارید، قاعده `HTTP to HTTPS` را از `web.config` حذف کنید و در `.env` مقدار `COOKIE_SECURE=false` بگذارید؛ در غیر این صورت ورود به سامانه کار نمی‌کند.

### 11.6 تنظیم سامانه برای کار پشت IIS

در `C:\PoldokhtarGIS\backend\.env`:

```ini
COOKIE_SECURE=true
TRUST_PROXY_HEADERS=true
```

سرویس را طوری نصب کنید که فقط از داخل سرور در دسترس باشد و پورت 8000 را ببندید:

```powershell
cd C:\PoldokhtarGIS\deploy
.\install-service.ps1 -Port 8000 -BindAddress 127.0.0.1
Remove-NetFirewallRule -DisplayName "PoldokhtarGIS-HTTP-8000" -ErrorAction SilentlyContinue
Restart-Service PoldokhtarGIS
```

اکنون سامانه از `https://gis.poldokhtar.ir` در دسترس است.

---

## 12. پشتیبان‌گیری و بازیابی

### پشتیبان دستی

```powershell
cd C:\PoldokhtarGIS\deploy
.\backup.ps1 -BackupDir D:\Backups\PoldokhtarGIS -RetentionDays 30
```

فایل‌هایی مانند `poldokhtar_gis_20250920_020000.dump` ساخته و نسخه‌های قدیمی‌تر از ۳۰ روز حذف می‌شوند.

### پشتیبان خودکار روزانه

```powershell
.\schedule-backup.ps1 -At "02:00" -BackupDir D:\Backups\PoldokhtarGIS -RetentionDays 30
Start-ScheduledTask -TaskName PoldokhtarGIS-DailyBackup      # اجرای آزمایشی
Get-ScheduledTaskInfo -TaskName PoldokhtarGIS-DailyBackup    # نتیجه آخرین اجرا
```

> پشتیبان‌ها را به‌طور منظم روی دیسک یا سرور دیگری هم کپی کنید. فایل `backend\.env` را هم (در جای امن) نگه دارید.

### بازیابی

```powershell
.\restore.ps1 -BackupFile D:\Backups\PoldokhtarGIS\poldokhtar_gis_20250920_020000.dump
```

اسکریپت سرویس را متوقف، داده‌ها را جایگزین و سرویس را دوباره اجرا می‌کند.

دستور معادل دستی:

```powershell
$env:PGPASSWORD = "PolDb@2025!x"
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -h localhost -U pol_user -d poldokhtar_gis -F c -f D:\backup.dump
& "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -h localhost -U pol_user -d poldokhtar_gis --clean --if-exists --no-owner D:\backup.dump
```

---

## 13. به‌روزرسانی نسخه

فایل‌های `backend\.env` (تنظیمات و گذرواژه پایگاه داده)، `backend\.venv`، `backend\uploads` و `backend\logs` روی سرور **هرگز نباید بازنویسی شوند**. اسکریپت‌های زیر این کار را خودکار و امن انجام می‌دهند.

### 13.1 ساخت بسته به‌روزرسانی (روی رایانه توسعه — Mac/Linux)

```bash
./deploy/make-package.sh
```

رابط کاربری ساخته می‌شود و فایلی مانند `dist-packages/PoldokhtarGIS-update-20260927-1930.zip` ساخته می‌شود (بدون `.env`، `.venv` و `node_modules`). در ویندوز معادل آن: `npm ci && npm run build` در پوشه `frontend` و فشرده‌کردن پوشه‌های `backend` (بدون `.venv` و `.env`)، `frontend` (بدون `node_modules`)، `deploy` و `docs`.

### 13.2 اعمال روی سرور

فایل ZIP را (با Remote Desktop، فلش یا اشتراک شبکه) مثلاً در `C:\Temp` کپی کنید و در PowerShell با دسترسی Administrator:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Expand-Archive C:\Temp\PoldokhtarGIS-update-20260927-1930.zip C:\Temp\pol-update -Force
C:\Temp\pol-update\deploy\apply-update.ps1
```

این اسکریپت (اگر مسیر نصب متفاوت است: `-InstallDir D:\PoldokhtarGIS`):

1. فایل‌های جدید را روی `C:\PoldokhtarGIS` کپی می‌کند و `.env`، `.venv`، `uploads`، `logs` و `deploy\tools` را دست نمی‌زند؛
2. پوشه `frontend\dist` را کامل جایگزین می‌کند؛
3. `update.ps1` را اجرا می‌کند: پشتیبان پایگاه داده ← توقف سرویس ← نصب بسته‌های پایتون ← ساخت جداول جدید ← اجرای سرویس؛
4. سلامت سامانه را بررسی می‌کند.

سپس در مرورگر `Ctrl+F5` بزنید. پس از آن `C:\Temp\pol-update` را می‌توانید پاک کنید.

### 13.3 فقط ری‌استارت

```powershell
Restart-Service PoldokhtarGIS                 # اگر به‌صورت سرویس نصب شده
Get-Service PoldokhtarGIS                     # وضعیت
Get-Content C:\PoldokhtarGIS\backend\logs\service.log -Tail 50
```

اگر `Get-Service PoldokhtarGIS` خطای «Cannot find any service» داد، سامانه در یک پنجره PowerShell با `run-server.ps1` اجرا شده است: در همان پنجره `Ctrl+C` بزنید و دوباره `.\run-server.ps1 -Port 8000` را اجرا کنید؛ یا بهتر، یک‌بار `.\install-service.ps1 -Port 8000` را اجرا کنید تا با روشن شدن سرور خودکار بالا بیاید.

## 14. نصب روی سرور بدون اینترنت

روی یک رایانه **دارای اینترنت** (ترجیحاً ویندوز با Python 3.12):

```powershell
cd C:\PoldokhtarGIS\backend
py -3.12 -m pip download -r requirements.txt -d C:\PoldokhtarGIS\wheels --only-binary=:all: --platform win_amd64 --python-version 3.12

cd C:\PoldokhtarGIS\frontend
npm ci
npm run build
```

پوشه‌های `wheels` و `frontend\dist` را همراه پروژه و نصب‌کننده‌های Python، PostgreSQL، PostGIS و NSSM به سرور منتقل کنید. سپس روی سرور:

```powershell
.\install.ps1 -PostgresPassword "..." -DbPassword "..." -AdminPassword "..." `
    -WheelsDir C:\PoldokhtarGIS\wheels -SkipFrontendBuild
```

به‌روزرسانی آفلاین:

```powershell
.\update.ps1 -WheelsDir C:\PoldokhtarGIS\wheels -SkipFrontendBuild
```

---

## 15. عیب‌یابی

| نشانه | علت محتمل | راه‌حل |
|---|---|---|
| `running scripts is disabled on this system` | سیاست اجرای PowerShell | `Set-ExecutionPolicy -Scope Process Bypass -Force` |
| `Python 3.11+ not found` | پایتون نصب نیست یا PATH تازه نشده | مرحله ۲؛ پنجره PowerShell را دوباره باز کنید یا `-PythonExe "C:\Program Files\Python312\python.exe"` |
| `psql.exe not found` | مسیر پستگرس متفاوت است | `-PgBin "D:\PostgreSQL\16\bin"` |
| `password authentication failed for user "postgres"` | گذرواژه postgres اشتباه است | گذرواژه مرحله 3.1 را وارد کنید |
| `PostGIS is not installed` | PostGIS نصب نشده | مرحله 3.2 |
| `frontend\dist is missing` | رابط کاربری ساخته نشده | مرحله ۴ |
| صفحه JSON «رابط کاربری ساخته نشده است» | dist پس از اجرای سرویس ساخته شده | `Restart-Service PoldokhtarGIS` |
| سرویس اجرا نمی‌شود | خطای پیکربندی | `Get-Content C:\PoldokhtarGIS\backend\logs\service.log -Tail 80` و اجرای `.\run-server.ps1` برای دیدن خطا |
| `/api/health` خطای database می‌دهد | پستگرس خاموش یا `DATABASE_URL` نادرست | `Get-Service postgresql*` ؛ بررسی `.env` |
| ورود موفق است ولی دوباره صفحه ورود می‌آید | `COOKIE_SECURE=true` روی HTTP | روی HTTPS باز کنید یا `COOKIE_SECURE=false` و ری‌استارت سرویس |
| «تعداد تلاش‌های ناموفق زیاد است» | ۱۰ تلاش ناموفق در ۱۵ دقیقه از یک IP | ۱۵ دقیقه صبر کنید |
| پشت IIS همه IPها در لاگ `127.0.0.1` است | `TRUST_PROXY_HEADERS=false` | مقدار را `true` کنید (بخش 11.6) |
| خطای 404.13 هنگام آپلود پشت IIS | محدودیت حجم IIS | `maxAllowedContentLength` در `web.config` |
| خطای 502.3 هنگام درون‌ریزی فایل بزرگ پشت IIS | مهلت ARR | `/timeout:"00:10:00"` در بخش 11.3 |
| متن فارسی شیپ‌فایل ناخوانا است | فایل `.cpg` وجود ندارد و رمزگذاری غیر استاندارد است | فایل `pol.cpg` با محتوای `UTF-8` یا `1256` کنار shp قرار دهید |
| سیستم تصویر تشخیص داده نشد | فایل `.prj` در ZIP نیست | در مرحله پیش‌نمایش کد EPSG را وارد کنید (WGS84=4326، UTM 38N=32638، UTM 39N=32639) |
| نقشه پایه خاکستری است | رایانه کاربر اینترنت ندارد | لایه‌ها و جدول کار می‌کنند؛ گزینه «بدون نقشه پایه» |

بررسی سریع وضعیت:

```powershell
Get-Service PoldokhtarGIS, postgresql*
Invoke-RestMethod http://127.0.0.1:8000/api/health
Test-NetConnection -ComputerName localhost -Port 8000
netstat -ano | findstr :8000
```

---

## 16. چک‌لیست امنیتی

- [ ] گذرواژه مدیر اولیه پس از نخستین ورود تغییر داده شد.
- [ ] `SECRET_KEY` در `.env` تصادفی است (اسکریپت نصب خودکار می‌سازد) و به هیچ‌کس داده نمی‌شود.
- [ ] پورت 5432 پستگرس در فایروال **باز نیست**.
- [ ] در محیط عملیاتی، سامانه پشت IIS با HTTPS است و `COOKIE_SECURE=true`.
- [ ] سرویس پشت IIS روی `127.0.0.1` گوش می‌دهد و پورت 8000 از شبکه بسته است.
- [ ] دسترسی فایل `C:\PoldokhtarGIS\backend\.env` فقط برای Administrators است:

```powershell
icacls C:\PoldokhtarGIS\backend\.env /inheritance:r /grant:r "Administrators:F" "SYSTEM:F"
```

- [ ] پشتیبان‌گیری خودکار روزانه فعال و بازیابی آن یک بار آزمایش شد.
- [ ] کاربران غیرفعال به جای حذف، «غیرفعال» می‌شوند تا سابقه لاگ حفظ شود.
- [ ] به‌روزرسانی‌های امنیتی ویندوز و PostgreSQL نصب می‌شوند.

---

## 17. خلاصه دستورها

```powershell
# ---------- آماده‌سازی ----------
Get-ChildItem C:\PoldokhtarGIS -Recurse | Unblock-File
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
cd C:\PoldokhtarGIS\deploy

# ---------- نصب ----------
.\install.ps1 -PostgresPassword "PgSuper@2025" -DbPassword "PolDb@2025!x" -AdminPassword "Admin@2025"
.\run-server.ps1                                   # آزمایش؛ Ctrl+C برای توقف
.\install-service.ps1 -Port 8000                   # نصب سرویس

# ---------- مدیریت سرویس ----------
Get-Service PoldokhtarGIS
Restart-Service PoldokhtarGIS
Get-Content C:\PoldokhtarGIS\backend\logs\service.log -Tail 50 -Wait
Invoke-RestMethod http://127.0.0.1:8000/api/health

# ---------- پشتیبان‌گیری ----------
.\backup.ps1
.\schedule-backup.ps1 -At "02:00"
.\restore.ps1 -BackupFile C:\Backups\PoldokhtarGIS\poldokhtar_gis_YYYYMMDD_HHMMSS.dump

# ---------- کاربران ----------
.\create-admin.ps1 -Username admin2              # ساخت مدیر
.\create-admin.ps1 -ResetPassword -Username ali  # بازنشانی گذرواژه

# ---------- به‌روزرسانی / حذف ----------
C:\Temp\pol-update\deploy\apply-update.ps1       # از بسته استخراج‌شده
.\update.ps1
.\uninstall-service.ps1
```

### فایل‌های مهم

| مسیر | کاربرد |
|---|---|
| `backend\.env` | تنظیمات (اتصال پایگاه داده، کلید امنیتی، کوکی) |
| `backend\.env.example` | نمونه توضیح‌دار تنظیمات |
| `backend\logs\service.log` | لاگ فنی سرویس |
| `deploy\iis\web.config` | پیکربندی پروکسی IIS |
| `deploy\tools\nssm.exe` | ابزار سرویس ویندوز |
| تب «لاگ سامانه» در رابط کاربری | لاگ اقدامات کاربران (در پایگاه داده) |
