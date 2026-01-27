const express = require("express");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ======================
   HOME ROUTE
====================== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

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
   HEALTH
====================== */
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    console.error("HEALTH ERROR:", e);
    res.status(500).json({ ok: false });
  }
});

/* ======================
   SUBMIT NOTE
====================== */
app.post("/submit", async (req, res) => {
  try {
    const title = (req.body.title || "").toString().trim();
    const message = (req.body.message || "").toString().trim();
    const tags = req.body.tags || [];

    if (!message) return res.status(400).send("Missing message");
    if (words(message) > 500) return res.status(400).send("Message too long");

    await pool.query(
      `INSERT INTO notes (title, message, tags, likes, reportcount, hidden)
       VALUES ($1, $2, $3, 0, 0, FALSE)`,
      [title, message, tags]
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("SUBMIT ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* ======================
   RANDOM NOTE (TAG FILTER)
====================== */
app.get("/random", async (req, res) => {
  try {
    const tag = req.query.tag;
    let q, params = [];

    if (tag && tag !== "all") {
      q = `
        SELECT id, title, message, tags, likes, created_at
        FROM notes
        WHERE hidden = FALSE
          AND $1 = ANY(tags)
        ORDER BY random()
        LIMIT 1
      `;
      params = [tag];
    } else {
      q = `
        SELECT id, title, message, tags, likes, created_at
        FROM notes
        WHERE hidden = FALSE
        ORDER BY random()
        LIMIT 1
      `;
    }

    const r = await pool.query(q, params);

    if (r.rows.length === 0) {
      return res.json({
        id: null,
        title: "No notes yet",
        message: "Be the first to leave something kind.",
        created_at: null,
        tags: [],
        likes: 0
      });
    }

    res.json(r.rows[0]);
  } catch (err) {
    console.error("RANDOM ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* ======================
   COUNT
====================== */
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

/* ======================
   LIKE
====================== */
app.post("/like", async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).send("Missing noteId");

    await pool.query(
      `UPDATE notes SET likes = likes + 1 WHERE id = $1`,
      [noteId]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("LIKE ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* ======================
   REPORT
====================== */
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

/* ======================
   FEEDBACK
====================== */
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
      `SELECT id, title, message, tags, likes, reportcount, hidden, created_at
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

/* ===== NEW: UPDATE TAGS FROM ADMIN ===== */
app.post("/admin/updateTags", adminAuth, async (req,res)=>{
  try{
    const { noteId, tags } = req.body;
    if(!noteId) return res.status(400).send("Missing noteId");

    await pool.query(
      `UPDATE notes SET tags = $1 WHERE id = $2`,
      [tags, noteId]
    );
    res.sendStatus(200);
  }catch(err){
    console.error("TAG UPDATE ERROR:", err);
    res.status(500).send("Server error");
  }
});
/* ===================================== */

/* ======================
   START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
