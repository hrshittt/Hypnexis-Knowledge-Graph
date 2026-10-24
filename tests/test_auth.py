"""Accounts and sessions: validation, hashing, cookies, CSRF, expiry, logout, admin designation."""

import time

from platform_support import PASSWORD, Session, app, make_client, register  # noqa: F401


def test_register_validates_input(app):
    c = make_client(app)
    r = c.post("/api/auth/register", json={"name": "", "email": "not-an-email", "password": "short",
                                           "workspace_type": "astrology", "accept_terms": True})
    assert r.status_code == 422
    fields = r.json()["detail"]["fields"]
    assert {"name", "email", "password", "workspace_type"} <= set(fields)
    r = c.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": PASSWORD,
                                           "accept_terms": False})
    assert r.status_code == 422 and "accept_terms" in r.json()["detail"]["fields"]
    r = c.post("/api/auth/register", json={"name": "Adalyn", "email": "ada@example.com", "password": "adalyn12345",
                                           "accept_terms": True})
    assert r.status_code == 422 and "name" in r.json()["detail"]["fields"]["password"].lower()


def test_register_creates_session_workspace_and_hashed_password(app):
    from backend import services
    c = make_client(app)
    r = c.post("/api/auth/register", json={"name": "Fiona Founder", "email": "Founder@Example.com",
                                           "password": PASSWORD, "workspace_type": "placement", "accept_terms": True})
    assert r.status_code == 201, r.text
    s = Session(c, r.json())
    set_cookie = r.headers["set-cookie"].lower()
    assert "hx_session=" in set_cookie and "httponly" in set_cookie and "samesite=lax" in set_cookie
    assert "max-age" not in set_cookie  # without "remember me" it is a browser-session cookie
    assert s.user["email"] == "founder@example.com" and s.user["role"] == "member"
    assert [w["type"] for w in s.payload["workspaces"]] == ["placement"]
    assert s.payload["workspaces"][0]["role"] == "owner"
    row = services.db().one("SELECT password_hash FROM users WHERE email=?", ("founder@example.com",))
    assert row["password_hash"].startswith("scrypt$") and PASSWORD not in row["password_hash"]
    tok = services.db().one("SELECT token_hash FROM sessions")["token_hash"]
    assert tok != c.cookies.get("hx_session") and len(tok) == 64  # only the hash is stored
    me = c.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["user"]["name"] == "Fiona Founder"
    assert me.json()["csrf_token"] == s.csrf


def test_duplicate_email_and_generic_login_errors(app):
    c = make_client(app)
    register(c, "dup@example.com")
    r = make_client(app).post("/api/auth/register", json={"name": "B", "email": "DUP@example.com",
                                                         "password": PASSWORD, "accept_terms": True})
    assert r.status_code == 409
    bad1 = make_client(app).post("/api/auth/login", json={"email": "dup@example.com", "password": "wrong password 1"})
    bad2 = make_client(app).post("/api/auth/login", json={"email": "nobody@example.com", "password": PASSWORD})
    assert bad1.status_code == bad2.status_code == 401
    assert bad1.json()["detail"]["message"] == bad2.json()["detail"]["message"] == "Invalid email or password."
    ok = make_client(app).post("/api/auth/login", json={"email": "dup@example.com", "password": PASSWORD})
    assert ok.status_code == 200 and ok.json()["csrf_token"]


def test_protected_routes_require_session_and_csrf(app):
    anon = make_client(app)
    r = anon.get("/api/workspaces")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "not_authenticated"
    s = register(make_client(app), "csrf@example.com")
    r = s.c.post("/api/workspaces", json={"type": "research"})  # no X-CSRF-Token header
    assert r.status_code == 403 and r.json()["detail"]["code"] == "csrf_failed"
    r = s.c.post("/api/workspaces", json={"type": "research"}, headers={"X-CSRF-Token": "forged"})
    assert r.status_code == 403
    r = s.post("/api/workspaces", json={"type": "research", "name": "Thesis"})
    assert r.status_code == 201 and r.json()["workspace"]["name"] == "Thesis"


def test_logout_and_expired_session(app):
    from backend import services
    s = register(make_client(app), "bye@example.com")
    assert s.post("/api/auth/logout").json()["signed_out"]
    assert s.get("/api/auth/me").status_code == 401
    s2 = Session(s.c, s.c.post("/api/auth/login", json={"email": "bye@example.com", "password": PASSWORD}).json())
    assert s2.get("/api/auth/me").status_code == 200
    services.db().execute("UPDATE sessions SET expires_at=?", (time.time() - 1,))
    r = s2.get("/api/auth/me")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "session_expired"


def test_password_change_revokes_other_sessions(app):
    a = register(make_client(app), "pw@example.com")
    b_client = make_client(app)
    b = Session(b_client, b_client.post("/api/auth/login", json={"email": "pw@example.com", "password": PASSWORD}).json())
    assert b.get("/api/auth/me").status_code == 200
    r = a.post("/api/auth/password", json={"current_password": "wrong one 123", "new_password": "new secret 99x"})
    assert r.status_code == 400
    r = a.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "new secret 99x"})
    assert r.status_code == 200
    assert a.get("/api/auth/me").status_code == 200       # this session survives
    assert b.get("/api/auth/me").status_code == 401       # every other session is signed out
    assert make_client(app).post("/api/auth/login", json={"email": "pw@example.com",
                                                          "password": "new secret 99x"}).status_code == 200


def test_admin_comes_from_operator_config_not_signup(app):
    c = make_client(app)
    r = c.post("/api/auth/register", json={"name": "Eve", "email": "eve@example.com", "password": PASSWORD,
                                           "accept_terms": True, "role": "admin"})
    assert r.status_code == 201 and r.json()["user"]["role"] == "member"
    admin = register(make_client(app), "admin@example.com")
    assert admin.user["role"] == "admin"


def test_auth_config_is_public_and_honest_about_resets(app):
    r = make_client(app).get("/api/auth/config")
    assert r.status_code == 200
    body = r.json()
    assert body["password_reset"] == "administrator" and body["password"]["min_length"] >= 10


def test_session_reports_shared_graph_write_permission(app):
    member = register(make_client(app), "member@example.com")
    admin = register(make_client(app), "admin@example.com")
    assert member.payload["permissions"]["shared_kb_write"] is False   # policy "admin" (the default)
    assert admin.payload["permissions"]["shared_kb_write"] is True
    assert member.get("/api/auth/me").json()["permissions"]["shared_kb_write"] is False
    status = make_client(app).get("/api/kb/status").json()
    assert status["upload"]["max_mb"] > 0 and ".pdf" in status["upload"]["types"]


def test_admin_cli_promotes_resets_and_disables(app, capsys):
    from backend.auth import cli
    s = register(make_client(app), "ops@example.com")
    assert cli.main(["make-admin", "ops@example.com"]) == 0
    assert s.get("/api/auth/me").json()["user"]["role"] == "admin"
    assert cli.main(["make-admin", "ghost@example.com"]) == 1
    import io, sys
    sys.stdin = io.StringIO("brand new pass 77\n")
    try:
        assert cli.main(["reset-password", "ops@example.com", "--password-stdin"]) == 0
    finally:
        sys.stdin = sys.__stdin__
    assert s.get("/api/auth/me").status_code == 401  # a reset signs the account out everywhere
    ok = make_client(app).post("/api/auth/login", json={"email": "ops@example.com", "password": "brand new pass 77"})
    assert ok.status_code == 200
    assert cli.main(["disable", "ops@example.com"]) == 0
    r = make_client(app).post("/api/auth/login", json={"email": "ops@example.com", "password": "brand new pass 77"})
    assert r.status_code == 403
    assert "ops@example.com" in capsys.readouterr().out


def test_session_boot_check_never_401s(app):
    anon = make_client(app)
    r = anon.get("/api/auth/session")
    assert r.status_code == 200 and r.json() == {"authenticated": False, "expired": False}
    s = register(make_client(app), "boot@example.com")
    body = s.get("/api/auth/session").json()
    assert body["authenticated"] is True and body["csrf_token"] == s.csrf and body["user"]["email"] == "boot@example.com"
    s.post("/api/auth/logout")
    s.c.cookies.set("hx_session", "stale-token")
    r = s.get("/api/auth/session")
    assert r.status_code == 200 and r.json() == {"authenticated": False, "expired": True}
    assert "hx_session=" in r.headers.get("set-cookie", "")  # the stale cookie is cleared
