require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createPoolFromEnv } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const pool = createPoolFromEnv();

app.get("/healthz", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows?.[0]?.ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// List (order id ASC) + search by full_name via ?q=
app.get("/api/students", async (req, res) => {
  const q = (req.query.q || "").trim();

  if (q) {
    const like = `%${q}%`;
    const [rows] = await pool.query(
      `SELECT id, student_code, full_name, email, dob, class_name, created_at, updated_at
       FROM students
       WHERE full_name LIKE ?
       ORDER BY id ASC`,
      [like]
    );
    return res.json(rows);
  }

  const [rows] = await pool.query(
    `SELECT id, student_code, full_name, email, dob, class_name, created_at, updated_at
     FROM students
     ORDER BY id ASC`
  );
  res.json(rows);
});

// Get by id
app.get("/api/students/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query(
    "SELECT id, student_code, full_name, email, dob, class_name, created_at, updated_at FROM students WHERE id = ?",
    [id]
  );
  if (!rows.length) return res.status(404).json({ message: "Not found" });
  res.json(rows[0]);
});

// Create
app.post("/api/students", async (req, res) => {
  const { student_code, full_name, email, dob, class_name } = req.body || {};
  if (!student_code || !full_name) {
    return res.status(400).json({ message: "student_code và full_name là bắt buộc" });
  }
  try {
    const [result] = await pool.query(
      "INSERT INTO students (student_code, full_name, email, dob, class_name) VALUES (?, ?, ?, ?, ?)",
      [student_code, full_name, email || null, dob || null, class_name || null]
    );
    const [rows] = await pool.query(
      "SELECT id, student_code, full_name, email, dob, class_name, created_at, updated_at FROM students WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    // Lỗi trùng student_code
    if (String(e).includes("ER_DUP_ENTRY")) {
      return res.status(409).json({ message: "student_code đã tồn tại" });
    }
    res.status(500).json({ message: "Server error", error: String(e) });
  }
});

// Update
app.put("/api/students/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { student_code, full_name, email, dob, class_name } = req.body || {};

  if (!student_code || !full_name) {
    return res.status(400).json({ message: "student_code và full_name là bắt buộc" });
  }

  try {
    const [result] = await pool.query(
      "UPDATE students SET student_code=?, full_name=?, email=?, dob=?, class_name=? WHERE id=?",
      [student_code, full_name, email || null, dob || null, class_name || null, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Not found" });

    const [rows] = await pool.query(
      "SELECT id, student_code, full_name, email, dob, class_name, created_at, updated_at FROM students WHERE id = ?",
      [id]
    );
    res.json(rows[0]);
  } catch (e) {
    if (String(e).includes("ER_DUP_ENTRY")) {
      return res.status(409).json({ message: "student_code đã tồn tại" });
    }
    res.status(500).json({ message: "Server error", error: String(e) });
  }
});

// Delete
app.delete("/api/students/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [result] = await pool.query("DELETE FROM students WHERE id = ?", [id]);
  if (result.affectedRows === 0) return res.status(404).json({ message: "Not found" });
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Backend listening on :${port}`);
});
