"""
FastAPI dependencies for request authentication.

  optional_user   the signed-in user or None (never raises)
  require_user    401 without a live session; 403 when a state-changing request lacks
                  the session's CSRF token (X-CSRF-Token header)
  require_admin   require_user + users.role == 'admin'

Error bodies are {"detail": {"code": ..., "message": ...}} so the SPA can tell an expired
session (redirect to sign-in) from a permission problem.
"""

import hmac
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, Request, Response

from backend import services

SESSION_COOKIE = "hx_session"
CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_UNRESOLVED = object()


@dataclass
class CurrentUser:
    id: str
    email: str
    name: str
    role: str
    csrf_token: str
    session_token: str
    session_expires_at: float
    remember: bool
    row: Dict[str, Any]

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def http_error(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def _resolve(request: Request) -> Optional[CurrentUser]:
    cached = getattr(request.state, "hx_user", _UNRESOLVED)
    if cached is not _UNRESOLVED:
        return cached
    token = request.cookies.get(SESSION_COOKIE)
    user = None
    if token:
        res = services.auth().resolve_session(token)
        if res is not None:
            row, sess = res
            user = CurrentUser(id=row["user_id"], email=row["email"], name=row["name"], role=row["role"],
                               csrf_token=sess["csrf_token"], session_token=token,
                               session_expires_at=sess["expires_at"], remember=bool(sess["remember"]), row=row)
    request.state.hx_user = user
    return user


def optional_user(request: Request) -> Optional[CurrentUser]:
    return _resolve(request)


def check_csrf(request: Request, user: CurrentUser) -> None:
    if request.method.upper() in SAFE_METHODS:
        return
    sent = request.headers.get(CSRF_HEADER, "")
    if not sent or not hmac.compare_digest(sent, user.csrf_token):
        raise http_error(403, "csrf_failed", "Security token missing or invalid. Reload the page and try again.")


def require_user(request: Request) -> CurrentUser:
    user = _resolve(request)
    if user is None:
        had_cookie = bool(request.cookies.get(SESSION_COOKIE))
        raise http_error(401, "session_expired" if had_cookie else "not_authenticated",
                         "Your session has expired. Sign in again." if had_cookie else "Sign in to continue.")
    check_csrf(request, user)
    return user


def require_admin(user: CurrentUser = Depends(require_user)) -> CurrentUser:
    if not user.is_admin:
        raise http_error(403, "admin_required", "This action requires an administrator.")
    return user


# ── cookies ──────────────────────────────────────────────────────────────────
def _secure(request: Request) -> bool:
    mode = services.settings().cookie_secure
    if mode in ("1", "true", "yes", "on"):
        return True
    if mode in ("0", "false", "no", "off"):
        return False
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip().lower()
    return proto == "https"


def _cookie_attrs(request: Request):
    secure = _secure(request)
    samesite = services.settings().cookie_samesite
    if samesite == "none" and not secure:
        samesite = "lax"  # browsers drop SameSite=None cookies that are not Secure
    return secure, samesite


def set_session_cookie(response: Response, request: Request, token: str, expires_at: float, remember: bool) -> None:
    secure, samesite = _cookie_attrs(request)
    # Without "remember me" the cookie lives for the browser session (the server-side expiry still applies).
    max_age = max(0, int(expires_at - time.time())) if remember else None
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=secure,
                        samesite=samesite, path="/")


def clear_session_cookie(response: Response, request: Request) -> None:
    secure, samesite = _cookie_attrs(request)
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=secure, samesite=samesite)
