import os
import secrets
import smtplib
import sqlite3
import ssl
import string
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from dotenv import load_dotenv
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr

load_dotenv()

GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]
SENDER_EMAIL = os.environ["SENDER_EMAIL"]
CODE_TTL = 600        # 10 minutes
SESSION_TTL = 86400   # 24 hours
MASTERY_THRESHOLD = 3

DB_PATH = Path(__file__).parent / "civics.db"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://atulyaprasad05.github.io", "http://localhost:8000", "https://sneha-civics.duckdns.org"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

pending_codes: dict[str, dict] = {}
active_sessions: dict[str, dict] = {}


# --- DB ---

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                email       TEXT UNIQUE NOT NULL,
                name        TEXT,
                date_joined DATETIME NOT NULL,
                last_login  DATETIME NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tests (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id  INTEGER NOT NULL REFERENCES users(id),
                taken_at DATETIME NOT NULL,
                score    INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS test_questions (
                test_id     INTEGER NOT NULL REFERENCES tests(id),
                question_id TEXT NOT NULL,
                topic       TEXT NOT NULL,
                correct     INTEGER NOT NULL,
                user_answer TEXT,
                PRIMARY KEY (test_id, question_id)
            );
            CREATE TABLE IF NOT EXISTS user_mastery (
                user_id     INTEGER NOT NULL REFERENCES users(id),
                question_id TEXT NOT NULL,
                level       INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, question_id)
            );
        """)


@app.on_event("startup")
async def startup():
    init_db()


# --- Helpers ---

def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_current_user(token: str) -> int:
    session = active_sessions.get(token)
    if not session or time.time() > session["expires_at"]:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return session["user_id"]


# --- Models ---

class SendCodeRequest(BaseModel):
    email: EmailStr


class VerifyCodeRequest(BaseModel):
    email: EmailStr
    code: str


class QuestionResult(BaseModel):
    question_id: str
    topic: str
    correct: int
    user_answer: str | None = None


class SubmitTestRequest(BaseModel):
    score: int
    questions: list[QuestionResult]


class UpdateProfileRequest(BaseModel):
    name: str


# --- Email ---

def generate_code() -> str:
    return "".join(secrets.choice(string.digits) for _ in range(6))


def send_email(to: str, code: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Your USCIS Civics Test verification code"
    msg["From"] = SENDER_EMAIL
    msg["To"] = to
    msg.attach(MIMEText(
        f"<p>Your verification code is: <strong style='font-size:1.5em'>{code}</strong></p>"
        "<p>This code expires in 10 minutes.</p>",
        "html",
    ))
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx) as server:
        server.login(SENDER_EMAIL, GMAIL_APP_PASSWORD)
        server.sendmail(SENDER_EMAIL, to, msg.as_string())


# --- Routes ---

@app.post("/auth/send-code")
async def send_code(req: SendCodeRequest):
    code = generate_code()
    pending_codes[req.email] = {
        "code": code,
        "expires_at": time.time() + CODE_TTL,
    }
    try:
        send_email(req.email, code)
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

    now = now_utc()
    with get_db() as db:
        existing = db.execute("SELECT id FROM users WHERE email = ?", (req.email,)).fetchone()
        if existing:
            user_id = existing["id"]
            db.execute("UPDATE users SET last_login = ? WHERE id = ?", (now, user_id))
            is_new_user = False
        else:
            cursor = db.execute(
                "INSERT INTO users (email, date_joined, last_login) VALUES (?, ?, ?)",
                (req.email, now, now),
            )
            user_id = cursor.lastrowid
            is_new_user = True

    token = secrets.token_urlsafe(32)
    active_sessions[token] = {
        "email": req.email,
        "user_id": user_id,
        "expires_at": time.time() + SESSION_TTL,
    }
    return {"token": token, "is_new_user": is_new_user}


@app.get("/profile")
async def get_profile(authorization: str = Header(...)):
    token = authorization.removeprefix("Bearer ").strip()
    user_id = get_current_user(token)
    with get_db() as db:
        row = db.execute("SELECT name, email FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"name": row["name"] if row else None, "email": row["email"] if row else None}


@app.post("/profile")
async def update_profile(req: UpdateProfileRequest, authorization: str = Header(...)):
    token = authorization.removeprefix("Bearer ").strip()
    user_id = get_current_user(token)
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty.")
    with get_db() as db:
        db.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
    return {"ok": True}


@app.post("/tests")
async def submit_test(req: SubmitTestRequest, authorization: str = Header(...)):
    token = authorization.removeprefix("Bearer ").strip()
    user_id = get_current_user(token)

    now = now_utc()
    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO tests (user_id, taken_at, score) VALUES (?, ?, ?)",
            (user_id, now, req.score),
        )
        test_id = cursor.lastrowid

        db.executemany(
            "INSERT INTO test_questions (test_id, question_id, topic, correct, user_answer) VALUES (?, ?, ?, ?, ?)",
            [(test_id, q.question_id, q.topic, q.correct, q.user_answer) for q in req.questions],
        )

        for q in req.questions:
            if q.correct:
                db.execute(
                    """
                    INSERT INTO user_mastery (user_id, question_id, level) VALUES (?, ?, 1)
                    ON CONFLICT(user_id, question_id) DO UPDATE SET level = level + 1
                    """,
                    (user_id, q.question_id),
                )
            else:
                db.execute(
                    """
                    INSERT INTO user_mastery (user_id, question_id, level) VALUES (?, ?, 0)
                    ON CONFLICT(user_id, question_id) DO UPDATE SET level = 0
                    """,
                    (user_id, q.question_id),
                )

    return {"test_id": test_id}


@app.get("/report")
async def get_report(authorization: str = Header(...)):
    token = authorization.removeprefix("Bearer ").strip()
    user_id = get_current_user(token)

    with get_db() as db:
        tests = db.execute("""
            SELECT t.id, t.taken_at, t.score,
                   COUNT(DISTINCT tq.topic) AS topic_count,
                   GROUP_CONCAT(DISTINCT tq.topic) AS topics
            FROM tests t
            JOIN test_questions tq ON tq.test_id = t.id
            WHERE t.user_id = ?
            GROUP BY t.id
            ORDER BY t.taken_at DESC
        """, (user_id,)).fetchall()

        avg_row = db.execute(
            "SELECT AVG(score) FROM tests WHERE user_id = ?", (user_id,)
        ).fetchone()

        unique_total = db.execute(
            """SELECT COUNT(DISTINCT tq.question_id)
               FROM test_questions tq
               JOIN tests t ON tq.test_id = t.id
               WHERE t.user_id = ?""",
            (user_id,),
        ).fetchone()

        unique_by_topic = db.execute(
            """SELECT tq.topic, COUNT(DISTINCT tq.question_id) AS cnt
               FROM test_questions tq
               JOIN tests t ON tq.test_id = t.id
               WHERE t.user_id = ?
               GROUP BY tq.topic
               ORDER BY tq.topic""",
            (user_id,),
        ).fetchall()

        mastery_rows = db.execute(
            "SELECT level, COUNT(*) AS cnt FROM user_mastery WHERE user_id = ? GROUP BY level",
            (user_id,),
        ).fetchall()

    return {
        "tests": [
            {
                "id": t["id"],
                "taken_at": t["taken_at"],
                "score": t["score"],
                "topic_count": t["topic_count"],
                "topics": t["topics"].split(",") if t["topics"] else [],
            }
            for t in tests
        ],
        "summary": {
            "total_tests": len(tests),
            "avg_score": round(avg_row[0], 1) if avg_row[0] else 0,
            "unique_questions": unique_total[0] or 0,
            "unique_by_topic": {row["topic"]: row["cnt"] for row in unique_by_topic},
        },
        "mastery": {str(row["level"]): row["cnt"] for row in mastery_rows},
        "mastery_threshold": MASTERY_THRESHOLD,
    }


app.mount("/", StaticFiles(directory="../js", html=True), name="frontend")
