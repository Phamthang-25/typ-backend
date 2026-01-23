require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createPoolFromEnv } = require("./db");
const client = require("prom-client");

const app = express();
app.use(cors());
app.use(express.json());

const pool = createPoolFromEnv();
const { v4: uuidv4 } = require("uuid");

// -------------------- Request logging (JSON to stdout) --------------------
app.use((req, res, next) => {
  if (req.path === "/metrics") return next();

  const requestId = req.header("x-request-id") || uuidv4();
  res.setHeader("X-Request-Id", requestId);

  const startNs = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - startNs) / 1000000n);

    const log = {
      time: new Date().toISOString(),
      service: "student-backend",
      request_id: requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: durationMs,
    };

    console.log(JSON.stringify(log));
  });

  next();
});

// -------------------- Prometheus metrics --------------------
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
register.registerMetric(httpRequestDurationSeconds);

// Expose /metrics for Prometheus
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).send("Error generating metrics");
  }
});

// Measure request duration (exclude /metrics itself)
app.use((req, res, next) => {
  if (req.path === "/metrics") return next();
  const end = httpRequestDurationSeconds.startTimer();
  res.on("finish", () => {
    const route =
      (req.route && req.route.path) ||
      (req.baseUrl ? req.baseUrl : "") ||
      req.path;
    end({
      method: req.method,
      route: String(route),
      status_code: String(res.statusCode),
    });
  });
  next();
});

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
