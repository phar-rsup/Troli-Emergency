import express from "express";
import { createServer as createViteServer } from "vite";
import cron from "node-cron";
import nodemailer from "nodemailer";
import admin from "firebase-admin";
import PDFDocument from "pdfkit-table";
import path from "path";

// Initialize Firebase Admin
let firebaseAdminInitialized = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseAdminInitialized = true;
    console.log("Firebase Admin initialized successfully.");
  } else {
    console.warn("FIREBASE_SERVICE_ACCOUNT is not set. Background tasks will not work.");
  }
} catch (e) {
  console.error("Failed to initialize Firebase Admin:", e);
}

const app = express();
const PORT = 3000;

app.use(express.json());

// Helper function to generate PDF and send email
async function generateAndSendReport() {
  if (!firebaseAdminInitialized) {
    throw new Error("Firebase Admin not initialized. Please set FIREBASE_SERVICE_ACCOUNT.");
  }

  const db = admin.firestore();
  const logsSnapshot = await db.collection('trolleyLogs').get();

  if (logsSnapshot.empty) {
    console.log("No logs found for this month. Skipping email.");
    return;
  }

  const logs = [];
  logsSnapshot.forEach(doc => logs.push({ id: doc.id, ...doc.data() }));

  // Generate PDF
  const doc = new PDFDocument({ margin: 30, size: 'A4' });
  const buffers: Buffer[] = [];
  doc.on('data', buffers.push.bind(buffers));

  doc.fontSize(18).text("Laporan Bulanan Pemakaian Troli Emergency", { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Tanggal Laporan: ${new Date().toLocaleDateString('id-ID')}`, { align: 'center' });
  doc.moveDown(2);

  const tableData = {
    title: "Daftar Pemakaian",
    headers: ["Tanggal", "Lokasi", "Pasien", "No. RM", "Perawat", "Dokter"],
    rows: logs.map((log: any) => [
      log.timestamp || "-",
      log.trolleyLocation || "-",
      log.patientName || "-",
      log.mrn || "-",
      log.nurseName || "-",
      log.doctorName || "-"
    ]),
  };

  await doc.table(tableData, { 
    prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
    prepareRow: () => doc.font("Helvetica").fontSize(10)
  });

  doc.end();

  const pdfBuffer = await new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
  });

  // Send Email
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.TARGET_EMAIL) {
    throw new Error("Email credentials (EMAIL_USER, EMAIL_PASS, TARGET_EMAIL) are not set.");
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.TARGET_EMAIL,
    subject: `Laporan Bulanan Troli Emergency - ${new Date().toLocaleDateString('id-ID')}`,
    text: 'Terlampir laporan bulanan pemakaian troli emergency. Log di sistem telah dihapus sesuai prosedur.',
    attachments: [{
      filename: `Laporan_Troli_${new Date().toISOString().slice(0, 10)}.pdf`,
      content: pdfBuffer
    }]
  });

  console.log("Email sent successfully.");

  // Delete logs after successful email
  const batch = db.batch();
  logsSnapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  console.log("Logs deleted successfully.");
}

// API Endpoint to manually trigger the export (useful for external cron jobs like cron-job.org)
app.post("/api/trigger-export", async (req, res) => {
  // Simple security check
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || 'default-secret'}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await generateAndSendReport();
    res.json({ success: true, message: "Report generated, sent, and logs deleted." });
  } catch (error: any) {
    console.error("Export error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API Endpoint to send Telegram notification
app.post("/api/notify-telegram", async (req, res) => {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    res.status(500).json({ error: "Telegram credentials not configured." });
    return;
  }

  const logData = req.body;
  
  const message = `🚨 *Log Troli Emergency Baru* 🚨\n\n` +
                  `📍 *Lokasi:* ${logData.trolleyLocation || '-'}\n` +
                  `👤 *Pasien:* ${logData.patientName || '-'} (RM: ${logData.mrn || '-'})\n` +
                  `👩‍⚕️ *Perawat:* ${logData.nurseName || '-'}\n` +
                  `👨‍⚕️ *Dokter:* ${logData.doctorName || '-'}\n` +
                  `🕒 *Waktu:* ${new Date(logData.timestamp).toLocaleString('id-ID')}\n` +
                  `🔑 *Segel:* ${logData.keyNumber || '-'}`;

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    
    const result = await response.json();
    res.json(result);
  } catch (error: any) {
    console.error("Telegram error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Internal Node Cron Job (Runs at 00:00 on day-of-month 1)
// Note: This only works if the server container is awake at 00:00.
cron.schedule('0 0 1 * *', async () => {
  console.log("Running monthly cron job...");
  try {
    await generateAndSendReport();
  } catch (error) {
    console.error("Cron job failed:", error);
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
