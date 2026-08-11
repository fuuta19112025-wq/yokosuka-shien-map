const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const PORT = 8791;
const ROOT = path.resolve(__dirname, "..", "..");

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() - start > timeoutMs) reject(new Error("server did not start"));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT });
  try {
    await waitForServer(`http://localhost:${PORT}/index.html`, 15000);

    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", err => errors.push("pageerror: " + err.message));

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const mapVisible = await page.locator("#map").isVisible();
    const filterButtons = await page.locator(".filter-btn").count();

    await browser.close();

    if (errors.length > 0) {
      console.error("Console errors detected:\n" + errors.join("\n"));
      process.exit(1);
    }
    if (!mapVisible || filterButtons < 1) {
      console.error("Page did not render expected elements");
      process.exit(1);
    }
    console.log("Smoke test passed: no console errors, page rendered correctly.");
  } finally {
    server.kill();
  }
})();
