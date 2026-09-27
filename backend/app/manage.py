"""ابزار خط فرمان مدیریت کاربران (روی خود سرور اجرا می‌شود).

نمونه‌ها (در پوشه backend):
    .venv\\Scripts\\python.exe -m app.manage create-admin --username admin2 --full-name "مدیر دوم"
    .venv\\Scripts\\python.exe -m app.manage reset-password --username admin
    .venv\\Scripts\\python.exe -m app.manage list-users

اگر --password داده نشود، گذرواژه به‌صورت پنهان پرسیده می‌شود.
"""
import argparse
import getpass
import sys

from .db import SessionLocal
from .models import Role, User
from .security import hash_password, validate_password_strength
from .seed import init_db


def _ask_password(given: str | None) -> str:
    if given:
        pw = given
    else:
        pw = getpass.getpass("گذرواژه جدید: ")
        if pw != getpass.getpass("تکرار گذرواژه: "):
            sys.exit("خطا: گذرواژه و تکرار آن یکسان نیستند.")
    if err := validate_password_strength(pw):
        sys.exit(f"خطا: {err}")
    return pw


def create_admin(args: argparse.Namespace) -> None:
    init_db()
    db = SessionLocal()
    try:
        username = args.username.strip()
        user = db.query(User).filter(User.username == username).one_or_none()
        if user and not args.force:
            sys.exit(
                f"خطا: کاربر «{username}» وجود دارد. برای ارتقا به مدیر و بازنشانی گذرواژه، --force را اضافه کنید."
            )
        pw = _ask_password(args.password)
        if user is None:
            user = User(username=username, full_name=args.full_name or "مدیر سامانه")
            db.add(user)
        elif args.full_name:
            user.full_name = args.full_name
        user.password_hash = hash_password(pw)
        user.role = Role.ADMIN
        user.is_active = True
        user.must_change_password = not args.no_change_required
        db.commit()
        print(f"مدیر «{username}» آماده است. اکنون می‌توانید با آن وارد سامانه شوید.")
    finally:
        db.close()


def reset_password(args: argparse.Namespace) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == args.username.strip()).one_or_none()
        if user is None:
            sys.exit(f"خطا: کاربر «{args.username}» یافت نشد.")
        user.password_hash = hash_password(_ask_password(args.password))
        user.is_active = True
        user.must_change_password = not args.no_change_required
        db.commit()
        print(f"گذرواژه «{user.username}» بازنشانی شد و حساب فعال است.")
    finally:
        db.close()


def list_users(_: argparse.Namespace) -> None:
    db = SessionLocal()
    try:
        for u in db.query(User).order_by(User.role, User.username):
            state = "فعال" if u.is_active else "غیرفعال"
            print(f"{u.username:<24} {u.role.value:<8} {state:<8} {u.full_name}")
    finally:
        db.close()


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m app.manage", description="مدیریت کاربران سامانه")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("create-admin", help="ساخت کاربر مدیر کل")
    c.add_argument("--username", required=True)
    c.add_argument("--password", help="اگر داده نشود پرسیده می‌شود")
    c.add_argument("--full-name", default="")
    c.add_argument("--force", action="store_true", help="اگر کاربر وجود دارد، به مدیر ارتقا و گذرواژه‌اش بازنشانی شود")
    c.add_argument("--no-change-required", action="store_true", help="در نخستین ورود تغییر گذرواژه اجباری نباشد")
    c.set_defaults(func=create_admin)

    r = sub.add_parser("reset-password", help="بازنشانی گذرواژه و فعال‌سازی یک کاربر")
    r.add_argument("--username", required=True)
    r.add_argument("--password")
    r.add_argument("--no-change-required", action="store_true")
    r.set_defaults(func=reset_password)

    sub.add_parser("list-users", help="فهرست کاربران").set_defaults(func=list_users)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
