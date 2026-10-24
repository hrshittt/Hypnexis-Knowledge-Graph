"""
Call API — "Call Paheli": the PAHELI voice assistant phones the number the user enters.
POST /api/call/paheli   {phone}  → OmniDimension outbound call dispatch

Needs OMNIDIM_API_KEY, OMNIDIM_FROM_NUMBER_ID and OMNIDIM_AGENT_ID in .env.
Signed-in users only (every call costs money), rate limited per IP.
"""

import asyncio
import json
import os
import re
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.auth.deps import CurrentUser, http_error, require_user
from backend.config import real_secret
from backend.utils.logger import get_logger

log = get_logger(__name__)
router = APIRouter(prefix="/api/call", tags=["call"])
limiter = Limiter(key_func=get_remote_address)

OMNIDIM_BASE = os.getenv("OMNIDIM_BASE_URL", "https://backend.omnidim.io/api/v1").rstrip("/")
DEFAULT_COUNTRY_CODE = os.getenv("OMNIDIM_DEFAULT_COUNTRY_CODE", "+91")
E164 = re.compile(r"^\+[1-9]\d{7,14}$")


class CallRequest(BaseModel):
    phone: str = Field(..., min_length=6, max_length=24)


def _config():
    key = os.getenv("OMNIDIM_API_KEY", "")
    agent = os.getenv("OMNIDIM_AGENT_ID", "").strip()
    from_id = os.getenv("OMNIDIM_FROM_NUMBER_ID", "").strip()
    if not (real_secret(key) and agent.isdigit() and from_id.isdigit()):
        return None
    return key.strip(), int(agent), int(from_id)


def normalize_phone(raw: str) -> str:
    """'98765 43210' → '+919876543210'; numbers with a + or 00 prefix keep their country code."""
    s = re.sub(r"[\s\-().]", "", raw or "")
    if s.startswith("00"):
        s = "+" + s[2:]
    if not s.startswith("+"):
        s = s.lstrip("0")
        s = (DEFAULT_COUNTRY_CODE + s) if len(s) == 10 else "+" + s
    if not E164.match(s):
        raise http_error(422, "invalid_phone", "Enter a valid phone number, e.g. +91 98765 43210.",
                         fields={"phone": "Not a valid phone number"})
    return s


def _dispatch(key: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{OMNIDIM_BASE}/calls/dispatch",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = res.read().decode() or "{}"
            return {"status": res.status, "body": json.loads(body)}
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors="replace")
        try:
            body = json.loads(text)
        except ValueError:
            body = {"error": text}
        return {"status": e.code, "body": body}


def _provider_message(body) -> str:
    if isinstance(body, dict):
        for k in ("error_description", "message", "error", "detail"):
            if isinstance(body.get(k), str) and body[k]:
                return body[k]
    return "the call provider rejected the request"


@router.get("/status")
async def call_status():
    """Whether the Call Paheli button should be offered."""
    return {"enabled": _config() is not None}


@router.post("/paheli")
@limiter.limit("3/minute")
async def call_paheli(request: Request, body: CallRequest, user: CurrentUser = Depends(require_user)):
    cfg = _config()
    if cfg is None:
        raise http_error(503, "calling_unavailable",
                         "Calling is not configured on this server (set OMNIDIM_API_KEY, OMNIDIM_AGENT_ID and OMNIDIM_FROM_NUMBER_ID).")
    key, agent_id, from_id = cfg
    to_number = normalize_phone(body.phone)
    payload = {
        "agent_id": agent_id,
        "to_number": to_number,
        "from_number_id": from_id,
        "call_context": {"customer_name": user.name, "source": "hypnexis-web"},
    }
    masked = to_number[:3] + "*" * (len(to_number) - 7) + to_number[-4:]
    log.info(f"Dispatching Paheli call | user={user.id} | to={masked}")
    try:
        res = await asyncio.to_thread(_dispatch, key, payload)
    except Exception as e:
        log.error(f"Paheli call dispatch failed: {e}")
        raise http_error(502, "call_failed", "Could not reach the calling service. Try again in a moment.")

    data = res["body"]
    ok = 200 <= res["status"] < 300 and not (isinstance(data, dict) and data.get("success") is False)
    if not ok:
        msg = _provider_message(data)
        log.warning(f"Paheli call rejected ({res['status']}): {msg}")
        raise http_error(502, "call_failed", f"Paheli couldn't place the call: {msg}")
    log.success(f"Paheli call queued | to={masked}")
    return {"ok": True, "to_number": to_number,
            "request_id": data.get("requestId") or data.get("request_id") if isinstance(data, dict) else None}
