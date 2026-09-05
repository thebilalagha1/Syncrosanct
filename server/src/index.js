import "dotenv/config";
import express from "express";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
import { upsertUser, getUser, getValue, setValue } from "./db.js";
import { signToken, requireAuth } from "./auth.js";

const required = ["GOOGLE_CLIENT_ID", "JWT_SECRET", "CLIENT_URL"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const app = express();

// No cookies involved anymore (auth is a bearer token the client sends
// itself), so this doesn't need `credentials: true` — a plain origin
// allowlist is enough, and it sidesteps any cookie/SameSite config drift
// between environments.
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

// ---- auth ----

// Client sends the Google ID token (credential) it got from Google Identity
// Services after the user signs in. We verify it *server-side* against
// Google's public keys — this is the step that can't be done in a browser
// sandbox, since it needs the real client ID to check the token audience.
app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: "missing_credential" });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "invalid_google_token" });
  }

  const user = await upsertUser({
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  });

  const token = signToken(user);
  res.json({ user, token });
});

// Stateless JWTs can't be revoked server-side without a blocklist we don't
// have yet — logging out is really just the client discarding the token it
// holds. This route stays so the client has something to call for symmetry
// (and as a hook if we ever add revocation), but there's no server state to
// clear today.
app.post("/api/auth/logout", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await getUser(req.userId);
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  res.json({ user });
});

// ---- per-user key/value storage ----
// Mirrors the shape of the artifact's window.storage.get/set that the app
// already uses, just backed by SQLite and scoped to the logged-in user.
// The app currently only uses two keys: "events" and "settings".

app.get("/api/kv/:key", requireAuth, async (req, res) => {
  const value = await getValue(req.userId, req.params.key);
  if (value === null) return res.status(404).json({ error: "not_found" });
  res.json({ key: req.params.key, value });
});

app.put("/api/kv/:key", requireAuth, async (req, res) => {
  const { value } = req.body || {};
  if (typeof value !== "string") return res.status(400).json({ error: "value_must_be_string" });
  await setValue(req.userId, req.params.key, value);
  res.json({ ok: true });
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`Syncrosanct API listening on http://localhost:${port}`);
});
