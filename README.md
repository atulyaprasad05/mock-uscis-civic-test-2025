# Mock USCIS Civics Test — Dynamic (Auth-Enabled)

This is the full-stack version of the Mock USCIS Civics Test. It adds email-based authentication: users verify their email with a one-time code before accessing the test.

The original static version lives in the root of this repo. This folder is self-contained.

---

## Stack

- **Frontend** — vanilla JS, no build step
- **Backend** — Python / FastAPI, SendGrid for sending codes

---

## Prerequisites

- Python 3.10+
- A [SendGrid](https://sendgrid.com) account (free tier — 100 emails/day)
- A verified sender email in SendGrid (Settings → Sender Authentication → Single Sender Verification)

---

## Backend setup

### 1. Create the `.env` file

Inside `Dynamic/backend/`, copy the example and fill in your credentials:

```
cp .env.example .env
```

Edit `.env`:

```
SENDGRID_API_KEY=SG.your_key_here
SENDER_EMAIL=you@example.com
```

> Get your API key from SendGrid → Settings → API Keys. The sender email must be verified via Single Sender Verification — no domain required.

### 2. Create a virtual environment and install dependencies

```
cd Dynamic/backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux
pip install -r requirements.txt
```

### 3. Start the backend

```
uvicorn main:app --port 8001
```

---

## Frontend setup

In a separate terminal, serve the `Dynamic/` folder:

```
cd Dynamic
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

---

## How it works

1. User enters their email — backend generates a 6-digit code, stores it server-side, and sends it via SendGrid
2. User enters the code — backend validates it and returns a session token
3. Token is stored in `localStorage` — user is now authenticated and can take the test
4. Session lasts 24 hours; codes expire after 10 minutes

The frontend never sees or stores the actual code — only the session token returned after successful verification.
