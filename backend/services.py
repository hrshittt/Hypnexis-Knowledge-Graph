"""
Process-wide singletons for the platform layer (settings, database, auth, workspaces,
placement). Built lazily on first use; tests call reset() with isolated settings.
"""

import threading
from typing import Optional

from backend.config import PlatformSettings, load_platform_settings

_lock = threading.RLock()
_settings: Optional[PlatformSettings] = None
_db = None
_auth = None
_workspaces = None
_placement = None
_models_provider = None


def settings() -> PlatformSettings:
    global _settings
    with _lock:
        if _settings is None:
            _settings = load_platform_settings()
        return _settings


def db():
    global _db
    with _lock:
        if _db is None:
            from backend.storage.database import PlatformDB
            _db = PlatformDB(settings().db_path)
        return _db


def auth():
    global _auth
    with _lock:
        if _auth is None:
            from backend.auth.service import AuthService
            _auth = AuthService(db(), settings())
        return _auth


def workspaces():
    global _workspaces
    with _lock:
        if _workspaces is None:
            from backend.workspaces.service import WorkspaceService
            _workspaces = WorkspaceService(db(), settings(), models_provider=_models_provider)
        return _workspaces


def placement():
    global _placement
    with _lock:
        if _placement is None:
            from backend.placement.service import PlacementService
            _placement = PlacementService(db(), settings())
        return _placement


def reset(new_settings: Optional[PlatformSettings] = None, models_provider=None) -> None:
    """Drop every singleton (closing open stores). Used by tests and the CLI."""
    global _settings, _db, _auth, _workspaces, _placement, _models_provider
    with _lock:
        if _workspaces is not None:
            _workspaces.close()
        if _db is not None:
            _db.close()
        _settings, _db, _auth, _workspaces, _placement = new_settings, None, None, None, None
        _models_provider = models_provider
