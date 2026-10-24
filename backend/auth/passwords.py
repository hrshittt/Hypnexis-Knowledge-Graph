"""
Password hashing with the standard library's scrypt (memory-hard KDF, no extra dependency).

Stored format:  scrypt$<n>$<r>$<p>$<salt b64>$<hash b64>
Parameters travel with the hash, so they can be raised later and old hashes still verify
(needs_rehash() tells the login path when to upgrade a stored hash).
"""

import base64
import hashlib
import hmac
import re
import secrets
from typing import List

N, R, P, DKLEN = 2 ** 15, 8, 1, 64
_MAXMEM = 128 * 1024 * 1024

MIN_LENGTH = 10
MAX_LENGTH = 128


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _kdf(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=dklen, maxmem=_MAXMEM)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"scrypt${N}${R}${P}${_b64(salt)}${_b64(_kdf(password, salt, N, R, P, DKLEN))}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = base64.b64decode(digest)
        got = _kdf(password, base64.b64decode(salt), int(n), int(r), int(p), len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, expected)


def needs_rehash(stored: str) -> bool:
    try:
        _, n, r, p, _, _ = stored.split("$")
        return (int(n), int(r), int(p)) != (N, R, P)
    except ValueError:
        return True


# A real hash of a random secret: verifying against it costs the same as a real check,
# so "unknown email" and "wrong password" take equally long.
DUMMY_HASH = hash_password(secrets.token_urlsafe(24))


def password_problems(password: str, email: str = "", name: str = "") -> List[str]:
    """Human-readable reasons a password is rejected (empty list = acceptable)."""
    problems = []
    if len(password) < MIN_LENGTH:
        problems.append(f"Use at least {MIN_LENGTH} characters.")
    if len(password) > MAX_LENGTH:
        problems.append(f"Use at most {MAX_LENGTH} characters.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        problems.append("Include at least one letter and one number.")
    low = password.lower()
    local = email.split("@")[0].lower() if email else ""
    if local and len(local) >= 4 and local in low:
        problems.append("Don't include your email address.")
    if name and len(name.strip()) >= 4 and name.strip().lower() in low:
        problems.append("Don't include your name.")
    if len(set(password)) < 4:
        problems.append("Avoid repeating the same few characters.")
    return problems
