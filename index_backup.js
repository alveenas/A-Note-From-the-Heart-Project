const express = require("express");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


/* ======================
   STATIC FILES
====================== */
app.use(express.static("public"));

/* ======================
   ENV
====================== */
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").toString().trim();
const DATABASE_URL = process.env.DATABASE_URL;

/* ======================
   DB
====================== */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ======================
   HELPERS
====================== */
function words(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

function adminAuth(req, res, next) {
  const provided =
    (req.headers["x-admin-password"] ||
      req.query.password ||
      req.body.password ||
      "")
      .toString()
      .trim();

  if (!ADMIN_PASSWORD || provided !== ADMIN_PASSWORD) {
    return res.sendStatus(403);
  }
  next();
}

/* ======================
   ROUTES
====================== */

/* Health check */
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    console.error("HEALTH ERROR:", e);
    res.status(500).json({ ok: false });
  }
});

/* Submit a note */
app.post("/submit", async (req, res) => {
  try {
    const title = (req.body.title || "").toString().trim();
    const message = (req.body.message || "").toString().trim();

    if (!title || !message)
      return res.status(400).send("Missing title or message");
    if (words(message) > 500)
      return res.status(400).send("Message too long");

    await pool.query(
      `INSERT INTO notes (title, message, reportcount, hidden)
       VALUES ($1, $2, 0, FALSE)`,
      [title, message]
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("SUBMIT ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* Get random note */
app.get("/random", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, title, message
       FROM notes
       WHERE hidden = FALSE
       ORDER BY random()
       LIMIT 1`
    );

    if (r.rows.length === 0) {
      return res.json({
        id: null,
        title: "No notes yet",
        message: "Be the first to leave something kind."
      });
    }

    res.json(r.rows[0]);
  } catch (err) {
    console.error("RANDOM ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* Count notes */
app.get("/count", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM notes
       WHERE hidden = FALSE`
    );
    res.json({ total: r.rows[0].total });
  } catch (err) {
    console.error("COUNT ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* Report */
app.post("/report", async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).send("Missing noteId");

    const u = await pool.query(
      `UPDATE notes
       SET reportcount = reportcount + 1
       WHERE id = $1
       RETURNING reportcount`,
      [noteId]
    );

    if (u.rows.length === 0) return res.sendStatus(404);

    if (u.rows[0].reportcount >= 3) {
      await pool.query(
        `UPDATE notes SET hidden = TRUE WHERE id = $1`,
        [noteId]
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("REPORT ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* Feedback */
app.post("/feedback", async (req, res) => {
  try {
    const message = (req.body.message || "").toString().trim();
    if (!message) return res.status(400).send("Missing message");

    await pool.query(
      `INSERT INTO feedback (message)
       VALUES ($1)`,
      [message]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("FEEDBACK ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* ======================
   ADMIN
====================== */

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin/data", adminAuth, async (req, res) => {
  try {
    const notes = await pool.query(
      `SELECT id, title, message, reportcount, hidden, created_at
       FROM notes
       ORDER BY created_at DESC NULLS LAST, id DESC`
    );
    const feedback = await pool.query(
      `SELECT id, message, created_at
       FROM feedback
       ORDER BY created_at DESC NULLS LAST, id DESC`
    );
    res.json({ notes: notes.rows, feedback: feedback.rows });
  } catch (err) {
    console.error("ADMIN DATA ERROR:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/toggleHidden", adminAuth, async (req, res) => {
  try {
    const { noteId, hidden } = req.body;
    if (!noteId) return res.status(400).send("Missing noteId");

    await pool.query(
      `UPDATE notes SET hidden = $1 WHERE id = $2`,
      [!!hidden, noteId]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error("ADMIN TOGGLE ERROR:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/resetReports", adminAuth, async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).send("Missing noteId");

    await pool.query(
      `UPDATE notes SET reportcount = 0 WHERE id = $1`,
      [noteId]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error("ADMIN RESET ERROR:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/delete", adminAuth, async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).send("Missing noteId");

    await pool.query(
      `DELETE FROM notes WHERE id = $1`,
      [noteId]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error("ADMIN DELETE ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* ======================
   START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
