"""Gmail SMTP completion-alert mailer.

Reads GMAIL_USER / GMAIL_APP_PASSWORD / NOTIFY_RECIPIENT_EMAIL from the
environment. If credentials are not configured the send_* helpers return
False without raising, so the rest of the app keeps working.
"""
from __future__ import annotations

import asyncio
import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


def _creds() -> tuple[str, str, str] | None:
    user = (os.environ.get("GMAIL_USER") or "").strip()
    pw = (os.environ.get("GMAIL_APP_PASSWORD") or "").strip().replace(" ", "")
    recipient = (os.environ.get("NOTIFY_RECIPIENT_EMAIL") or "").strip()
    if not user or not pw or not recipient:
        return None
    return user, pw, recipient


def is_email_configured() -> bool:
    return _creds() is not None


def _build_message(
    sender: str, recipient: str, subject: str, text: str, html: str
) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = recipient
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    return msg


def _send_sync(subject: str, text: str, html: str) -> bool:
    creds = _creds()
    if not creds:
        logger.info("Email skipped: Gmail credentials not configured")
        return False
    user, pw, recipient = creds
    msg = _build_message(user, recipient, subject, text, html)
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
            smtp.login(user, pw)
            smtp.send_message(msg)
        logger.info("Sent completion email to %s", recipient)
        return True
    except Exception as exc:  # noqa: BLE001 — log and skip; retry on next tick
        logger.warning("Gmail send failed: %s", exc)
        return False


async def send_completion_email_async(experiment: dict) -> bool:
    subject = f"Ageing complete: {experiment.get('batch', 'sample')}"
    end_iso = ""
    end_ms = experiment.get("end_time")
    if end_ms:
        end_iso = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc).isoformat()
    text = (
        f"Sample {experiment.get('batch')} has reached its target ageing time.\n"
        f"Researcher: {experiment.get('researcher')}\n"
        f"Condition : {experiment.get('condition')}\n"
        f"Duration  : {experiment.get('hours')} h\n"
        f"Completed : {end_iso} UTC\n\n"
        "Open Ageing Monitor and confirm sample removal."
    )
    html = (
        f"<h2 style='color:#06B6D4;font-family:Arial,sans-serif'>Ageing complete</h2>"
        f"<p style='font-family:Arial,sans-serif;color:#222'>"
        f"Sample <strong>{experiment.get('batch')}</strong> has reached its target ageing time.</p>"
        f"<table style='font-family:Arial,sans-serif;color:#333;border-collapse:collapse'>"
        f"<tr><td><b>Researcher</b></td><td>{experiment.get('researcher')}</td></tr>"
        f"<tr><td><b>Condition</b></td><td>{experiment.get('condition')}</td></tr>"
        f"<tr><td><b>Duration</b></td><td>{experiment.get('hours')} h</td></tr>"
        f"<tr><td><b>Completed (UTC)</b></td><td>{end_iso}</td></tr>"
        f"</table>"
        f"<p style='font-family:Arial,sans-serif;color:#555;margin-top:16px'>"
        f"Open the Ageing Monitor app and confirm sample removal.</p>"
    )
    return await asyncio.to_thread(_send_sync, subject, text, html)
