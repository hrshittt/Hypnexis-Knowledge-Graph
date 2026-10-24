"""
Platform settings (accounts, sessions, workspaces, placement) — read from environment.

The knowledge-base pipeline keeps its own settings in backend/kb/config.py; this module
only covers the multi-user platform layered on top of it. Every value has a safe default
so a fresh checkout runs locally with no configuration.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import FrozenSet

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")  # never override variables already set in the shell

WORKSPACE_TYPES = ("corporate", "research", "legal", "placement")
SHARED_KB_WRITE_POLICIES = ("admin", "authenticated", "public")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _emails(raw: str) -> FrozenSet[str]:
    return frozenset(e.strip().lower() for e in raw.split(",") if e.strip())


def real_secret(value: str) -> bool:
    """False for empty values and the placeholders shipped in .env.example."""
    v = (value or "").strip()
    return bool(v) and not v.lower().startswith(("your_", "your-", "changeme", "<"))


@dataclass
class PlatformSettings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("HYPNEXIS_DATA_DIR", ROOT / "data")))
    samples_dir: Path = field(default_factory=lambda: Path(os.getenv("HYPNEXIS_SAMPLES_DIR", ROOT / "samples" / "workspaces")))

    # Session cookie. "auto" marks it Secure whenever the request arrived over HTTPS
    # (X-Forwarded-Proto is honoured, as on Hugging Face Spaces / Vercel).
    cookie_secure: str = field(default_factory=lambda: os.getenv("AUTH_COOKIE_SECURE", "auto").strip().lower())
    cookie_samesite: str = field(default_factory=lambda: os.getenv("AUTH_COOKIE_SAMESITE", "lax").strip().lower())
    session_hours: int = field(default_factory=lambda: _env_int("AUTH_SESSION_HOURS", 12))
    remember_days: int = field(default_factory=lambda: _env_int("AUTH_REMEMBER_DAYS", 30))

    # Administrators are designated by the operator, never chosen at sign-up.
    admin_emails: FrozenSet[str] = field(default_factory=lambda: _emails(os.getenv("HYPNEXIS_ADMIN_EMAILS", "")))
    registration_open: bool = field(default_factory=lambda: os.getenv("HYPNEXIS_REGISTRATION", "open").strip().lower() != "closed")

    # Who may upload to / delete from the shared demo corpus at /api/kb.
    shared_kb_write: str = field(default_factory=lambda: os.getenv("KB_SHARED_WRITE", "admin").strip().lower())

    max_open_workspace_kbs: int = field(default_factory=lambda: _env_int("HYPNEXIS_MAX_OPEN_KBS", 16))
    placement_max_upload_mb: int = field(default_factory=lambda: _env_int("PLACEMENT_MAX_UPLOAD_MB", 10))
    placement_max_rows: int = field(default_factory=lambda: _env_int("PLACEMENT_MAX_ROWS", 50000))

    def __post_init__(self):
        if self.shared_kb_write not in SHARED_KB_WRITE_POLICIES:
            self.shared_kb_write = "admin"
        if self.cookie_samesite not in ("lax", "strict", "none"):
            self.cookie_samesite = "lax"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "platform" / "hypnexis.db"

    @property
    def workspaces_dir(self) -> Path:
        return self.data_dir / "workspaces"

    def workspace_dir(self, workspace_id: str) -> Path:
        return self.workspaces_dir / workspace_id

    @property
    def placement_max_upload_bytes(self) -> int:
        return self.placement_max_upload_mb * 1024 * 1024


def load_platform_settings(**overrides) -> PlatformSettings:
    s = PlatformSettings()
    for k, v in overrides.items():
        if not hasattr(s, k):
            raise AttributeError(f"Unknown platform setting: {k}")
        setattr(s, k, Path(v) if k in ("data_dir", "samples_dir") else v)
    s.__post_init__()
    return s
