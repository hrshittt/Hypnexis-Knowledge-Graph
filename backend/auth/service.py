"""
AuthService — registration, sign-in, server-side sessions.

Sessions
  - The browser holds a random 256-bit token in an HttpOnly cookie; only its SHA-256 is
    stored, so a leaked database cannot be replayed as cookies.
  - Each session carries its own CSRF token (synchroniser pattern). The SPA receives it
    from /api/auth/me and sends it as X-CSRF-Token on every state-changing request.
  - Expiry is absolute: AUTH_SESSION_HOURS by default, AUTH_REMEMBER_DAYS with "remember me".

Roles
  - users.role is 'member' or 'admin'. Admin is never selectable at sign-up: it comes from
    HYPNEXIS_ADMIN_EMAILS or `python -m backend.auth.cli make-admin`.
"""

import hashlib
import re
import secrets
import time
import uuid
from typing import Any, Dict, Optional, Tuple

from backend.auth.passwords import (
    DUMMY_HASH, hash_password, needs_rehash, password_problems, verify_password,
)
from backend.config import WORKSPACE_TYPES, PlatformSettings
from backend.storage.database import PlatformDB
from backend.utils.logger import get_logger

log = get_logger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_TOUCH_INTERVAL_S = 300.0


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii", "ignore")).hexdigest()


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def public_user(row: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": row["user_id"], "email": row["email"], "name": row["name"], "role": row["role"],
            "primary_workspace_type": row.get("primary_workspace_type"), "created_at": row["created_at"],
            "last_login_at": row.get("last_login_at")}


class AuthService:
    def __init__(self, db: PlatformDB, settings: PlatformSettings):
        self.db = db
        self.settings = settings

    # ── validation ────────────────────────────────────────────────────────────
    @staticmethod
    def validate_registration(email: str, password: str, name: str, workspace_type: Optional[str]) -> Dict[str, str]:
        errors: Dict[str, str] = {}
        e = normalize_email(email)
        if not e or len(e) > 254 or not EMAIL_RE.match(e):
            errors["email"] = "Enter a valid email address."
        n = (name or "").strip()
        if not n:
            errors["name"] = "Enter your full name."
        elif len(n) > 100:
            errors["name"] = "Use at most 100 characters."
        problems = password_problems(password or "", e, n)
        if problems:
            errors["password"] = " ".join(problems)
        if workspace_type is not None and workspace_type not in WORKSPACE_TYPES:
            errors["workspace_type"] = "Choose one of the four workspaces."
        return errors

    def _role_for(self, email: str, current: str = "member") -> str:
        return "admin" if email in self.settings.admin_emails else current

    # ── users ─────────────────────────────────────────────────────────────────
    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self.db.one("SELECT * FROM users WHERE user_id=?", (user_id,))

    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        return self.db.one("SELECT * FROM users WHERE email=?", (normalize_email(email),))

    def register(self, email: str, password: str, name: str, workspace_type: Optional[str] = None) -> Dict[str, Any]:
        if not self.settings.registration_open:
            raise AuthError(403, "registration_closed", "Registration is closed on this deployment.")
        errors = self.validate_registration(email, password, name, workspace_type)
        if errors:
            raise AuthError(422, "invalid_input", "Please fix the highlighted fields.", {"fields": errors})
        e = normalize_email(email)
        if self.get_user_by_email(e):
            raise AuthError(409, "email_taken", "An account with this email already exists.",
                            {"fields": {"email": "An account with this email already exists."}})
        now = time.time()
        user_id = "u_" + uuid.uuid4().hex[:16]
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO users(user_id, email, name, password_hash, role, primary_workspace_type, created_at, "
                "updated_at) VALUES (?,?,?,?,?,?,?,?)",
                (user_id, e, name.strip(), hash_password(password), self._role_for(e), workspace_type, now, now))
        log.info(f"Registered user {user_id}")
        return self.get_user(user_id)

    def authenticate(self, email: str, password: str) -> Dict[str, Any]:
        row = self.get_user_by_email(email)
        if row is None:
            verify_password(password or "", DUMMY_HASH)  # equalise timing
            raise AuthError(401, "invalid_credentials", "Invalid email or password.")
        if not verify_password(password or "", row["password_hash"]):
            raise AuthError(401, "invalid_credentials", "Invalid email or password.")
        if row["disabled"]:
            raise AuthError(403, "account_disabled", "This account has been disabled. Contact your administrator.")
        updates: Dict[str, Any] = {"last_login_at": time.time()}
        if needs_rehash(row["password_hash"]):
            updates["password_hash"] = hash_password(password)
        role = self._role_for(row["email"], row["role"])
        if role != row["role"]:
            updates["role"] = role
        cols = ", ".join(f"{k}=?" for k in updates)
        self.db.execute(f"UPDATE users SET {cols} WHERE user_id=?", (*updates.values(), row["user_id"]))
        return self.get_user(row["user_id"])

    def update_profile(self, user_id: str, name: Optional[str] = None,
                       primary_workspace_type: Optional[str] = None) -> Dict[str, Any]:
        fields: Dict[str, Any] = {}
        if name is not None:
            n = name.strip()
            if not n or len(n) > 100:
                raise AuthError(422, "invalid_input", "Name must be 1–100 characters.", {"fields": {"name": "Name must be 1–100 characters."}})
            fields["name"] = n
        if primary_workspace_type is not None:
            if primary_workspace_type not in WORKSPACE_TYPES:
                raise AuthError(422, "invalid_input", "Unknown workspace type.")
            fields["primary_workspace_type"] = primary_workspace_type
        if fields:
            fields["updated_at"] = time.time()
            cols = ", ".join(f"{k}=?" for k in fields)
            self.db.execute(f"UPDATE users SET {cols} WHERE user_id=?", (*fields.values(), user_id))
        return self.get_user(user_id)

    def change_password(self, user_id: str, current: str, new: str, keep_token: Optional[str] = None) -> None:
        row = self.get_user(user_id)
        if row is None or not verify_password(current or "", row["password_hash"]):
            raise AuthError(400, "wrong_password", "Your current password is incorrect.",
                            {"fields": {"current_password": "Incorrect password."}})
        problems = password_problems(new or "", row["email"], row["name"])
        if problems:
            raise AuthError(422, "invalid_input", "Choose a stronger password.", {"fields": {"new_password": " ".join(problems)}})
        self.db.execute("UPDATE users SET password_hash=?, updated_at=? WHERE user_id=?",
                        (hash_password(new), time.time(), user_id))
        self.revoke_all(user_id, except_token=keep_token)

    # operator-only (CLI)
    def set_role(self, email: str, role: str) -> Dict[str, Any]:
        if role not in ("member", "admin"):
            raise AuthError(422, "invalid_role", "Role must be 'member' or 'admin'.")
        row = self.get_user_by_email(email)
        if row is None:
            raise AuthError(404, "not_found", f"No user with email {email}.")
        self.db.execute("UPDATE users SET role=?, updated_at=? WHERE user_id=?", (role, time.time(), row["user_id"]))
        return self.get_user(row["user_id"])

    def reset_password(self, email: str, new: str) -> None:
        row = self.get_user_by_email(email)
        if row is None:
            raise AuthError(404, "not_found", f"No user with email {email}.")
        problems = password_problems(new, row["email"], row["name"])
        if problems:
            raise AuthError(422, "invalid_input", " ".join(problems))
        self.db.execute("UPDATE users SET password_hash=?, updated_at=? WHERE user_id=?",
                        (hash_password(new), time.time(), row["user_id"]))
        self.revoke_all(row["user_id"])

    def set_disabled(self, email: str, disabled: bool) -> None:
        row = self.get_user_by_email(email)
        if row is None:
            raise AuthError(404, "not_found", f"No user with email {email}.")
        self.db.execute("UPDATE users SET disabled=?, updated_at=? WHERE user_id=?", (int(disabled), time.time(), row["user_id"]))
        if disabled:
            self.revoke_all(row["user_id"])

    # ── sessions ──────────────────────────────────────────────────────────────
    def create_session(self, user_id: str, remember: bool = False, user_agent: str = "") -> Tuple[str, str, float]:
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        now = time.time()
        ttl = self.settings.remember_days * 86400 if remember else self.settings.session_hours * 3600
        with self.db.tx() as c:
            c.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            c.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)",
                      (_token_hash(token), user_id, csrf, int(remember), (user_agent or "")[:200], now, now + ttl, now))
        return token, csrf, now + ttl

    def resolve_session(self, token: Optional[str]) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
        """(user, session) for a live session token, else None."""
        if not token or len(token) > 200:
            return None
        th = _token_hash(token)
        sess = self.db.one("SELECT * FROM sessions WHERE token_hash=?", (th,))
        if sess is None:
            return None
        now = time.time()
        if sess["expires_at"] < now:
            self.db.execute("DELETE FROM sessions WHERE token_hash=?", (th,))
            return None
        user = self.get_user(sess["user_id"])
        if user is None or user["disabled"]:
            return None
        if now - sess["last_seen_at"] > _TOUCH_INTERVAL_S:
            self.db.execute("UPDATE sessions SET last_seen_at=? WHERE token_hash=?", (now, th))
        return user, sess

    def revoke_session(self, token: Optional[str]) -> None:
        if token:
            self.db.execute("DELETE FROM sessions WHERE token_hash=?", (_token_hash(token),))

    def revoke_all(self, user_id: str, except_token: Optional[str] = None) -> int:
        if except_token:
            return self.db.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
                                   (user_id, _token_hash(except_token)))
        return self.db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))

    def session_count(self, user_id: str) -> int:
        row = self.db.one("SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND expires_at>=?", (user_id, time.time()))
        return int(row["n"]) if row else 0
