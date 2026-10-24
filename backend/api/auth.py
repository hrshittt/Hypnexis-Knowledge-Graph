"""
Auth API — /api/auth

  GET    /config         public: registration open?, password rules, how resets work
  POST   /register       create an account + first workspace, start a session
  POST   /login          start a session (HttpOnly cookie; CSRF token in the body)
  POST   /logout         end this session
  GET    /session        public boot check: {authenticated: false} or the /me payload (never 401)
  GET    /me             current user + CSRF token (401 without a live session)
  PATCH  /me             update name / primary workspace
  POST   /password       change password (signs out every other session)
  POST   /sessions/revoke-others

Passwords are hashed with scrypt; only a SHA-256 of the session token is stored.
There is deliberately no self-service password reset: no email service is configured,
so an administrator resets passwords with `python -m backend.auth.cli reset-password`.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend import services
from backend.auth.deps import (
    CurrentUser, SESSION_COOKIE, check_csrf, clear_session_cookie, http_error, optional_user, require_user,
    set_session_cookie,
)
from backend.auth.passwords import MAX_LENGTH, MIN_LENGTH
from backend.auth.service import AuthError, public_user
from backend.config import WORKSPACE_TYPES

router = APIRouter(prefix="/api/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


class RegisterBody(BaseModel):
    name: str = Field("", max_length=200)
    email: str = Field("", max_length=320)
    password: str = Field("", max_length=1024)
    workspace_type: Optional[str] = Field(None, max_length=20)
    accept_terms: bool = False


class LoginBody(BaseModel):
    email: str = Field("", max_length=320)
    password: str = Field("", max_length=1024)
    remember: bool = False


class ProfileBody(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    primary_workspace_type: Optional[str] = Field(None, max_length=20)


class PasswordBody(BaseModel):
    current_password: str = Field("", max_length=1024)
    new_password: str = Field("", max_length=1024)


def _raise(e: AuthError):
    raise http_error(e.status, e.code, e.message, **e.details)


def _session_payload(request: Request, user_row, csrf: str, expires_at: float, remember: bool):
    ws = services.workspaces().list_for_user(user_row["user_id"])
    # same rule as the shared corpus write guard in api/kb.py, so the SPA only offers what will work
    policy = getattr(request.app.state, "shared_kb_write", "public")
    shared_write = policy in ("public", "authenticated") or user_row["role"] == "admin"
    return {"user": public_user(user_row), "csrf_token": csrf, "workspaces": ws,
            "session": {"expires_at": expires_at, "remember": remember},
            "permissions": {"shared_kb_write": shared_write}}


@router.get("/config")
async def auth_config():
    s = services.settings()
    return {"registration_open": s.registration_open, "workspace_types": list(WORKSPACE_TYPES),
            "password": {"min_length": MIN_LENGTH, "max_length": MAX_LENGTH,
                         "rules": [f"At least {MIN_LENGTH} characters", "At least one letter and one number",
                                   "Not your name or email address"]},
            "password_reset": "administrator",
            "session_hours": s.session_hours, "remember_days": s.remember_days}


@router.post("/register", status_code=201)
@limiter.limit("5/minute")
async def register(request: Request, response: Response, body: RegisterBody):
    if not body.accept_terms:
        raise http_error(422, "invalid_input", "Please fix the highlighted fields.",
                         fields={"accept_terms": "Accept the terms to create an account."})
    auth, ws = services.auth(), services.workspaces()
    try:
        user = auth.register(body.email, body.password, body.name, body.workspace_type)
    except AuthError as e:
        _raise(e)
    if body.workspace_type:
        ws.create(user["user_id"], body.workspace_type)
    token, csrf, expires = auth.create_session(user["user_id"], remember=False,
                                               user_agent=request.headers.get("user-agent", ""))
    set_session_cookie(response, request, token, expires, remember=False)
    ws.log(user["user_id"], None, "account", "Created your Hypnexis account")
    return _session_payload(request, user, csrf, expires, False)


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, response: Response, body: LoginBody):
    auth = services.auth()
    try:
        user = auth.authenticate(body.email, body.password)
    except AuthError as e:
        _raise(e)
    old = request.cookies.get(SESSION_COOKIE)
    if old:
        auth.revoke_session(old)  # never reuse a pre-login session id
    token, csrf, expires = auth.create_session(user["user_id"], remember=body.remember,
                                               user_agent=request.headers.get("user-agent", ""))
    set_session_cookie(response, request, token, expires, remember=body.remember)
    return _session_payload(request, user, csrf, expires, body.remember)


@router.post("/logout")
async def logout(request: Request, response: Response):
    user = optional_user(request)
    if user is not None:
        try:
            check_csrf(request, user)
            services.auth().revoke_session(user.session_token)
        except Exception:
            pass  # a stale tab still gets its cookie cleared
    clear_session_cookie(response, request)
    return {"signed_out": True}


@router.get("/session")
async def session_state(request: Request, response: Response):
    """The SPA's boot check: 200 whether or not anyone is signed in (an anonymous visitor isn't an error)."""
    user = optional_user(request)
    if user is None:
        stale = bool(request.cookies.get(SESSION_COOKIE))
        if stale:
            clear_session_cookie(response, request)
        return {"authenticated": False, "expired": stale}
    return {"authenticated": True,
            **_session_payload(request, user.row, user.csrf_token, user.session_expires_at, user.remember)}


@router.get("/me")
async def me(request: Request, user: CurrentUser = Depends(require_user)):
    return _session_payload(request, user.row, user.csrf_token, user.session_expires_at, user.remember)


@router.patch("/me")
async def update_me(body: ProfileBody, user: CurrentUser = Depends(require_user)):
    try:
        row = services.auth().update_profile(user.id, body.name, body.primary_workspace_type)
    except AuthError as e:
        _raise(e)
    return {"user": public_user(row)}


@router.post("/password")
@limiter.limit("5/minute")
async def change_password(request: Request, body: PasswordBody, user: CurrentUser = Depends(require_user)):
    try:
        services.auth().change_password(user.id, body.current_password, body.new_password, keep_token=user.session_token)
    except AuthError as e:
        _raise(e)
    services.workspaces().log(user.id, None, "account", "Changed your password")
    return {"changed": True}


@router.post("/sessions/revoke-others")
async def revoke_others(user: CurrentUser = Depends(require_user)):
    n = services.auth().revoke_all(user.id, except_token=user.session_token)
    return {"revoked": n}
