const cron = require("node-cron");

const { academy } = require("./scrapers/academy-pos/academy-main.js");
const { getNigerianTime, formatNigerianTime } = require("./utils/dateHelpers.js");
const http = require("http");

// --- Core Application Logic ---
let isJobRunning = false;

// --- HTTP Server for Health Checks ---
const server = http.createServer((req, res) => {
  if (req.url === "/" && req.method === "GET") {
    const serverTime = formatNigerianTime();
    const html = `
      <div style="font-family: monospace; line-height: 1.6; font-weight: bold; font-size: 16px;">
        <p>&#9989 [VSPPM] Server is running.</p>
        <p><strong>Server Time (Nigerian):</strong> ${serverTime}</p>
        <p><strong>Daily Schedule for OG-Scrap:</strong></p>
        <ul>
          <li></li>
          <li></li>
          <li>10:00 PM - Academic-pos </li>

        </ul>
      </div>
    `;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

/**
 * Ensures only one scraper runs at a time.
 * Always resolves (never throws) so the caller can safely exit the process.
 */
async function runWithLock(fn, label) {
  if (isJobRunning) {
    console.log(`⚠️ Skipping ${label} — job is still running.`);
    return { skipped: true };
  }

  isJobRunning = true;
  console.log(`▶️ Starting ${label}...`);

  try {
    await fn();
    console.log(`✅ ${label} scrap-job completed successfully`);
    return { success: true };
  } catch (err) {
    console.error(`❌ ${label} failed:`, err.message || err);
    return { success: false, error: err.message || String(err) };
  } finally {
    isJobRunning = false;
  }
}

/**
 * Run a scraper then exit the process.
 * Exiting after each job clears Chromium/memory on Render free tier.
 * Always exit(0) so the platform does not treat a finished job as a crash.
 */
async function runAndExit(fn, label) {
  try {
    await runWithLock(fn, label);
  } finally {
    console.log(`🛑 ${label} finished. Exiting process to clear memory...`);
    // Small delay so logs flush
    await new Promise((r) => setTimeout(r, 10000));
    process.exit(0);
  }
}


async function setupCronJobs() {


  cron.schedule(
    "0 22 * * *",
    async () => {
      console.log("🌅 10:00 PM - proceeding to run academy-pos scrapper..");
      await runAndExit(academy, "academy-pos");
    },
    { scheduled: true, timezone: "Africa/Lagos" }
  );

  console.log("📅 Daily Schedule (Africa/Lagos):");
  console.log("   - 10:00 PM → academy-positions");
}

// --- Server Startup and Graceful Shutdown ---
async function startServer() {
  try {
    const PORT = process.env.PORT || 5100;

    server.listen(PORT, async () => {
      console.log(`🟢 Server is live on port ${PORT}`);
      console.log(`⏰ Current Nigerian time: ${formatNigerianTime()}`);
      console.log(`next is cron schedule..`);
      await setupCronJobs();
    });

    const shutdown = async () => {
      console.log("🔄 Shutting down server...");
      server.close((err) => {
        if (err) {
          console.error("❌ Error closing HTTP server:", err);
        } else {
          console.log("✅ HTTP server closed.");
        }
        process.exit(0);
      });

      // Force exit if close hangs
      setTimeout(() => {
        console.log("⚠️ Forcing shutdown...");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("SIGQUIT", shutdown);
  } catch (error) {
    console.error("❌ Failed to start the server:", error);
    process.exit(1);
  }
}

// Log unexpected errors but do not kill the process outside of scheduled jobs.
// (Scheduled jobs intentionally exit after finishing to free memory.)
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Do not process.exit here – let the health-check server stay up
  // until the next scheduled job exits deliberately.
});

startServer();