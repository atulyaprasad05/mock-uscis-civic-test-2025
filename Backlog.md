# Feature Backlog

Ordered by priority — highest at the top, lowest at the bottom.

---

## 1. Email Authentication (One-Time Code)

Allow users to sign in by entering their email address and receiving a one-time passcode (OTP) to verify. No third-party logins (no Google, no OAuth). Plain email only.

- Send a short-lived numeric or alphanumeric code to the user's email on sign-in request
- User enters the code in the app to complete authentication
- Session persists after successful verification

---

## 2. Backend User Profiles

Store each authenticated user's data in a backend. Fields to persist:

| Field | Description |
|---|---|
| Name | Display name |
| Email | Primary identifier |
| Date Joined | When the account was created |
| Last Logged In | Timestamp of most recent sign-in |
| Average Quiz Score | Rolling average across all completed quizzes |

---

## 3. Question Mastery Tracking

Track each user's mastery level per question. Rules:

- Mastery is an integer level per question, starting at **0**
- Each consecutive correct answer increments the level by 1
- Mastery is reached at level **3** (configurable — do not hardcode)
- Any wrong answer **resets the level to 0** immediately
- Mastery levels are stored in the backend, tied to the user's account

---

## 4. Exclude Mastered Questions

Give users the option to skip questions they have already mastered.

- Prompt appears at the **start of each session**, before questions are drawn
- If the user opts in, fully mastered questions are excluded from the pool for that session
- If too few unmastered questions remain to fill a test, fall back gracefully (e.g., fill remaining slots with mastered questions)

---

## 5. Test Mode (Free-Response Only)

Add a second mode alongside the existing **Learn** mode. The home page presents two entry points:

- **Learn** — current experience (MCQ, proportional, mastery-tracked)
- **Test** — new mode described below

**Test mode behavior:**

- All questions are free-response (FRQ) — no multiple choice, no answer options shown
- Same selection logic as Learn: random, proportional across topics
- After the user submits a typed answer, show **all accepted correct answers** — regardless of whether the user was right
- User self-assesses (same checkbox mechanic as open questions today)
- **Does not affect mastery** — answers in Test mode are not counted toward mastery levels

---

## 6. Region & Address Collection on First Login

When a user signs in for the first time, prompt them to provide their location details. Used to give accurate answers to state- and district-specific civics questions.

- Fields: state, congressional district, home address (optional, for local official lookup)
- Stored in the user's profile on the backend
- Used to pre-fill correct answers for `userSpecific: true` questions (e.g., "Who is your senator?")

---

## 7. Report Card

Users can generate a personal report card from the home page or at the end of any session. Summarizes overall progress across all activity.

Report includes:

- Total number of **Learn** sessions completed
- Total number of **Test** sessions completed
- Average score for Learn sessions
- Average score for Test sessions
- **Mastery percentage** — number of questions mastered out of 128 total
- Breakdown of mastery by topic (e.g., "American Government: 12/45 mastered")
