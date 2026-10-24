"""
Thin LLM adapter for the knowledge base, built on the project's GeminiClient.

Adds what KB pipelines need on top of backend/utils/gemini_client.py:
  - optional: returns None when no key is configured (callers fall back to heuristics)
  - circuit breaker: after repeated failures the LLM is paused, so a bad key or an
    exhausted quota degrades to heuristics instead of stalling every request
  - robust JSON extraction from model output
"""

import json
import re
import time
from typing import Any, Optional

from backend.kb.config import KBSettings
from backend.utils.logger import get_logger

log = get_logger(__name__)


class LLMUnavailable(RuntimeError):
    pass


def parse_json_block(raw: str) -> Any:
    """Parse the first JSON object/array in `raw` (tolerates ``` fences and prose)."""
    if raw is None:
        raise ValueError("empty LLM response")
    s = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", s, re.DOTALL)
    if fence:
        s = fence.group(1).strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    starts = [i for i in (s.find("{"), s.find("[")) if i >= 0]
    if not starts:
        raise ValueError("no JSON found in LLM response")
    start = min(starts)
    opener = s[start]
    closer = "}" if opener == "{" else "]"
    depth, in_str, esc = 0, False, False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return json.loads(s[start:i + 1])
    raise ValueError("unterminated JSON in LLM response")


class KBLLM:
    FAILURE_LIMIT = 3
    COOLDOWN_S = 300.0

    def __init__(self, client: Any, gen_model: str, fast_model: str):
        self._client = client
        self.gen_model = gen_model
        self.fast_model = fast_model
        self._failures = 0
        self._paused_until = 0.0
        self.last_error: Optional[str] = None

    @property
    def available(self) -> bool:
        return time.monotonic() >= self._paused_until

    async def complete(
        self, prompt: str, system: Optional[str] = None, fast: bool = False,
        max_tokens: int = 1024, temperature: float = 0.0,
    ) -> str:
        if not self.available:
            raise LLMUnavailable(f"LLM paused after repeated failures: {self.last_error}")
        messages = ([{"role": "system", "content": system}] if system else []) + [
            {"role": "user", "content": prompt}
        ]
        try:
            text = await self._client.chat(
                messages=messages,
                model=self.fast_model if fast else self.gen_model,
                temperature=temperature, max_tokens=max_tokens, max_retries=2,
            )
        except Exception as e:
            self._record_failure(e)
            raise LLMUnavailable(str(e)) from e
        if not text or not str(text).strip():
            self._record_failure(ValueError("empty response"))
            raise LLMUnavailable("LLM returned an empty response")
        self._failures = 0
        return str(text)

    async def complete_json(self, prompt: str, **kw) -> Any:
        raw = await self.complete(prompt, **kw)
        try:
            return parse_json_block(raw)
        except (ValueError, json.JSONDecodeError) as e:
            raise LLMUnavailable(f"Unparseable JSON from LLM: {e}") from e

    def _record_failure(self, err: Exception) -> None:
        self._failures += 1
        self.last_error = str(err)[:300]
        log.warning(f"KB LLM call failed ({self._failures}/{self.FAILURE_LIMIT}): {self.last_error}")
        if self._failures >= self.FAILURE_LIMIT:
            self._paused_until = time.monotonic() + self.COOLDOWN_S
            self._failures = 0
            log.error(f"KB LLM paused for {self.COOLDOWN_S:.0f}s; heuristic fallbacks active.")


def build_llm(settings: KBSettings) -> Optional[KBLLM]:
    if not settings.llm_enabled:
        return None
    try:
        from backend.utils.gemini_client import get_pool
        return KBLLM(get_pool(), settings.gen_model, settings.fast_model)
    except Exception as e:
        log.warning(f"Gemini client unavailable, KB runs in heuristic mode: {e}")
        return None
