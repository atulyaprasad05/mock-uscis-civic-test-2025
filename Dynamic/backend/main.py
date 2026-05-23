import os
import secrets
import smtplib
import string
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

load_dotenv()

GMAIL_USER = os.environ["GMAIL_USER"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]
CODE_TTL = 600       # 10 minutes
SESSION_TTL = 86400  # 24 hours

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://atulyaprasad05.github.io"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

pending_codes: dict[str, dict] = {}
active_sessions: dict[str, dict] = {}


class SendCodeRequest(BaseModel):
    email: EmailStr


class VerifyCodeRequest(BaseModel):
    email: EmailStr
    code: str


def generate_code() -> str:
    return "".join(secrets.choice(string.digits) for _ in range(6))


def send_gmail(to: str, code: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Your USCIS Civics Test verification code"
    msg["From"] = GMAIL_USER
    msg["To"] = to
    msg.attach(MIMEText(
        f"<p>Your verification code is: <strong style='font-size:1.5em'>{code}</strong></p>"
        "<p>This code expires in 10 minutes.</p>",
        "html",
    ))
    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        server.sendmail(GMAIL_USER, to, msg.as_string())


@app.post("/auth/send-code")
async def send_code(req: SendCodeRequest):
    code = generate_code()
    pending_codes[req.email] = {
        "code": code,
        "expires_at": time.time() + CODE_TTL,
    }
    try:
        send_gmail(req.email, code)
    except Exception as e:
        del pending_codes[req.email]
        raise HTTPException(status_code=502, detail=f"Failed to send email: {e}")
    return {"message": "Code sent"}


@app.post("/auth/verify-code")
async def verify_code(req: VerifyCodeRequest):
    entry = pending_codes.get(req.email)
    if not entry:
        raise HTTPException(status_code=400, detail="No code found for this email. Request a new one.")
    if time.time() > entry["expires_at"]:
        del pending_codes[req.email]
        raise HTTPException(status_code=400, detail="Code has expired. Request a new one.")
    if req.code != entry["code"]:
        raise HTTPException(status_code=400, detail="Incorrect code.")
    del pending_codes[req.email]
    token = secrets.token_urlsafe(32)
    active_sessions[token] = {
        "email": req.email,
        "expires_at": time.time() + SESSION_TTL,
    }
    return {"token": token}
