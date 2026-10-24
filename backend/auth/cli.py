"""
Account administration CLI (operator-only; there is no self-service reset because no email
service is configured).

  python -m backend.auth.cli list-users
  python -m backend.auth.cli make-admin ada@example.com
  python -m backend.auth.cli remove-admin ada@example.com
  python -m backend.auth.cli reset-password ada@example.com      prompts for the new password
  python -m backend.auth.cli disable ada@example.com             signs the account out everywhere
  python -m backend.auth.cli enable ada@example.com

Uses the same platform database as the server (HYPNEXIS_DATA_DIR, default data/).
Resetting a password or disabling an account revokes every session of that account.
"""

import argparse
import getpass
import sys
from datetime import datetime

from backend import services
from backend.auth.service import AuthError


def _when(ts) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else "never"


def _new_password(args) -> str:
    if args.password_stdin:
        return sys.stdin.readline().rstrip("\r\n")
    first = getpass.getpass("New password: ")
    if getpass.getpass("Repeat new password: ") != first:
        raise AuthError(422, "mismatch", "The passwords do not match.")
    return first


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m backend.auth.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list-users")
    for name in ("make-admin", "remove-admin", "disable", "enable"):
        sub.add_parser(name).add_argument("email")
    rp = sub.add_parser("reset-password")
    rp.add_argument("email")
    rp.add_argument("--password-stdin", action="store_true", help="read the new password from stdin (for scripts)")
    args = ap.parse_args(argv)

    auth = services.auth()
    try:
        if args.cmd == "list-users":
            rows = services.db().q("SELECT email, name, role, disabled, created_at, last_login_at FROM users "
                                   "ORDER BY created_at")
            if not rows:
                print("No accounts yet.")
            for r in rows:
                flags = " ".join(f for f in (r["role"] == "admin" and "admin", r["disabled"] and "disabled") if f)
                print(f"{r['email']:<40} {r['name'][:30]:<30} last sign-in {_when(r['last_login_at'])}"
                      f"{'  [' + flags + ']' if flags else ''}")
        elif args.cmd in ("make-admin", "remove-admin"):
            u = auth.set_role(args.email, "admin" if args.cmd == "make-admin" else "member")
            print(f"{u['email']} is now {'an administrator' if u['role'] == 'admin' else 'a member'}.")
        elif args.cmd == "reset-password":
            auth.reset_password(args.email, _new_password(args))
            print(f"Password reset for {args.email}; all of its sessions were signed out.")
        else:
            auth.set_disabled(args.email, args.cmd == "disable")
            print(f"{args.email} {'disabled and signed out everywhere' if args.cmd == 'disable' else 'enabled'}.")
    except AuthError as e:
        print(f"! {e.message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
