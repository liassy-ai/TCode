# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report them privately by email to the maintainer: **liassy@qq.com**.
Please do not disclose the issue publicly before a fix is available.

You can expect an initial response within a few days. Once the issue is confirmed, a fix will be prepared and you will be credited if you wish.

## Scope notes

This application handles API keys for LLM providers:

- Keys are supplied by the user via environment variables (referenced as `$VAR` in `models.json`) and are never stored in this repository or bundled into releases.
- User data under `~/.pi/agent/` (`sessions/*.jsonl`, `auth.json`) may contain sensitive content. Be careful what you include in bug reports — redact keys and personal data.

If you find a code path that could leak keys into logs, the renderer, or crash reports, that is in scope and we'd like to hear about it.
