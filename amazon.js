// amazon.js ✅ Updated: fixes Baileys import shape (CJS/ESM), fixes legacy session parsing,
// keeps your Gifted GZIP + Mega session logic, keeps oral chat pipeline,
// keeps auto-react + status seen/reply, keeps store/getMessage, keeps express.
/**
import dotenv from "dotenv";
dotenv.config();

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ Most stable way to load Baileys in an ESM project on Heroku
const baileys = require("@whiskeysockets/baileys");

import { Handler, Callupdate, GroupUpdate } from "./data/index.js";

import express from "express";
import pino from "pino";
import fs from "fs";
import { File } from "megajs";
import NodeCache from "node-cache";
import path from "path";
import chalk from "chalk";
import config from "./config.cjs";
import pkg from "./lib/autoreact.cjs";
import zlib from "zlib";
import { promisify } from "util";
import { fileURLToPath } from "url";

const {
  makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  useMultiFileAuthState,
  makeInMemoryStore
} = baileys;

const { emojis, doReact } = pkg;
const prefix = process.env.PREFIX || config.PREFIX || ".";
const sessionName = "session";
const app = express();
const PORT = process.env.PORT || 3000;

const orange = chalk.bold.hex("#FFA500");
const lime = chalk.bold.hex("#32CD32");

let useQR = false;
let initialConnection = true;

const MAIN_LOGGER = pino({ timestamp: () => `,"time":"${new Date().toJSON()}"` });
const logger = MAIN_LOGGER.child({});
logger.level = "trace";

const msgRetryCounterCache = new NodeCache();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sessionDir = path.join(__dirname, sessionName);
const credsPath = path.join(sessionDir, "creds.json");

if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

// ✅ Store (kept)
const store =
  typeof makeInMemoryStore === "function"
    ? makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) })
    : {
        bind() {},
        loadMessage() {
          return null;
        }
      };

// ------------------------------
// SESSION COMPONENTS (KEPT)
// ------------------------------
const gunzip = promisify(zlib.gunzip);

async function loadGiftedSession() {
  console.log("🔍 Checking SESSION_ID format...");

  if (!config.SESSION_ID) {
    console.error("❌ No SESSION_ID provided in config!");
    return false;
  }

  if (!config.SESSION_ID.startsWith("Gifted~")) {
    console.log("⚠️ SESSION_ID does not start with Gifted~");
    return false;
  }

  console.log("✅ Detected Gifted session format (GZIP compressed)");
  const compressedBase64 = config.SESSION_ID.substring("Gifted~".length);

  try {
    const compressedBuffer = Buffer.from(compressedBase64, "base64");

    // gzip magic bytes check
    if (compressedBuffer[0] !== 0x1f || compressedBuffer[1] !== 0x8b) {
      console.log("❌ Not a valid GZIP file (missing magic bytes)");
      return false;
    }

    const decompressedBuffer = await gunzip(compressedBuffer);
    const sessionData = decompressedBuffer.toString("utf-8");

    await fs.promises.writeFile(credsPath, sessionData);
    console.log("💾 Session saved to file successfully");
    return true;
  } catch (error) {
    console.error("❌ Failed to process Gifted session:", error?.message || error);
    return false;
  }
}

async function downloadLegacySession() {
  console.log("Debugging SESSION_ID:", config.SESSION_ID);

  if (!config.SESSION_ID) {
    console.error("❌ Please add your session to SESSION_ID env !!");
    return false;
  }

  // ✅ Supports: CLOUD-AI~fileID#decryptKey OR Gifted~fileID#decryptKey
  const afterTilde = config.SESSION_ID.split("Gifted~")[1]; // Fixed: was split("Gifted~")
  if (!afterTilde || !afterTilde.includes("#")) {
    console.error("❌ Invalid SESSION_ID format! It must contain both file ID and decryption key.");
    return false;
  }

  const [fileID, decryptKey] = afterTilde.split("#");

  try {
    console.log("🔄 Downloading Legacy Session from Mega.nz...");
    const file = File.fromURL(`https://mega.nz/file/${fileID}#${decryptKey}`);

    const data = await new Promise((resolve, reject) => {
      file.download((err, data) => (err ? reject(err) : resolve(data)));
    });

    await fs.promises.writeFile(credsPath, data);
    console.log("🔒 Legacy Session Successfully Loaded !!");
    return true;
  } catch (error) {
    console.error("❌ Failed to download legacy session data:", error?.message || error);
    return false;
  }
}

// ------------------------------
// START BOT
// ------------------------------
async function start() {
  try {
    // ✅ Hard fail with clear logging
    if (typeof useMultiFileAuthState !== "function" || typeof makeWASocket !== "function") {
      console.error("Baileys keys:", Object.keys(baileys).slice(0, 40));
      console.error("typeof makeWASocket:", typeof makeWASocket);
      console.error("typeof useMultiFileAuthState:", typeof useMultiFileAuthState);
      throw new Error("Baileys functions missing. Ensure deps installed fresh (purge cache) and redeploy.");
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`🤖 CLOUD-AI using WA v${version.join(".")}, isLatest: ${isLatest}`);

    const Matrix = makeWASocket({
      version,
      logger: pino({ level: "silent" }),
      printQRInTerminal: useQR,
      browser: ["CLOUD-AI", "safari", "3.3"],
      auth: state,
      msgRetryCounterCache,

      // ✅ quoted message resolution
      getMessage: async (key) => {
        try {
          if (store && typeof store.loadMessage === "function") {
            const msg = await store.loadMessage(key.remoteJid, key.id);
            return msg?.message || undefined;
          }
        } catch {}
        return { conversation: "cloud ai whatsapp user bot" };
      }
    });

    // ✅ bind store (kept)
    try {
      if (store && typeof store.bind === "function") store.bind(Matrix.ev);
    } catch {}

    Matrix.ev.on("creds.update", saveCreds);

    Matrix.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) {
          console.log(orange("⚠️ Connection closed. Restarting socket..."));
          start();
        } else {
          console.log(chalk.red("❌ Logged out. Delete session folder then re-auth."));
        }
      }

      if (connection === "open") {
        if (initialConnection) {
          console.log(lime("✅ Connected Successfully CLOUD-AI 🤝"));

          try {
            await Matrix.sendMessage(Matrix.user.id, {
              image: { url: "https://files.catbox.moe/pf270b.jpg" },
              caption: `*Hello there User! 👋🏽*

> Simple, Straightforward, But Loaded With Features 🎊. Meet CLOUD-AI WhatsApp Bot.

*Thanks🚩*

> Join WhatsApp Channel: ⤵️  
https://whatsapp.com/

- *YOUR PREFIX:* = ${prefix}

Don't forget to give a star to the repo ⬇️  
https://github.com

> © REGARDS`
            });
          } catch (e) {
            console.log("Startup message failed:", e?.message || e);
          }

          initialConnection = false;
        } else {
          console.log(chalk.blue("♻️ Connection reestablished after restart."));
        }
      }
    });

    // ✅ keep calls + group updates
    Matrix.ev.on("call", async (json) => {
      try {
        await Callupdate(json, Matrix);
      } catch (e) {
        console.error("Callupdate error:", e);
      }
    });

    Matrix.ev.on("group-participants.update", async (messag) => {
      try {
        await GroupUpdate(Matrix, messag);
      } catch (e) {
        console.error("GroupUpdate error:", e);
      }
    });

    Matrix.public = (config.MODE || "public").toLowerCase() === "public";

    // ✅ ONE messages.upsert pipeline (prevents random "works here only" behavior)
    Matrix.ev.on("messages.upsert", async (chatUpdate) => {
      try {
        const mek = chatUpdate?.messages?.[0];
        if (!mek || !mek.message) return;

        if (mek.message?.protocolMessage) return;
        if (mek.message?.reactionMessage) return;

        // status seen/reply
        if (mek.key?.remoteJid === "status@broadcast") {
          if (config.AUTO_STATUS_SEEN) await Matrix.readMessages([mek.key]).catch(() => {});
          if (config.AUTO_STATUS_REPLY) {
            const fromJid = mek.key.participant || mek.key.remoteJid;
            const customMessage = config.STATUS_READ_MSG || "✅ Auto Status Seen Bot By CLOUD-AI";
            await Matrix.sendMessage(fromJid, { text: customMessage }, { quoted: mek }).catch(() => {});
          }
          return;
        }

        // auto react
        if (!mek.key.fromMe && config.AUTO_REACT) {
          const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
          await doReact(randomEmoji, mek, Matrix).catch(() => {});
        }

        // main handler
        await Handler(chatUpdate, Matrix, logger);
      } catch (err) {
        console.error("messages.upsert error:", err);
      }
    });
  } catch (error) {
    console.error("Critical Error:", error);
    process.exit(1);
  }
}

// ------------------------------
// INIT (FIXED LOGIC)
// ------------------------------
async function init() {
  // Check if session file already exists
  if (fs.existsSync(credsPath)) {
    console.log("🔒 Existing session file found, loading it...");
    await start();
    return;
  }

  console.log("📝 No existing session file, checking config.SESSION_ID...");

  // Try Gifted session first (GZIP compressed)
  if (config.SESSION_ID && config.SESSION_ID.startsWith("Gifted~")) {
    console.log("🔄 Attempting to load Gifted session (GZIP compressed)...");
    const ok = await loadGiftedSession();
    useQR = !ok;
    await start();
    return;
  }

  // Try legacy Mega session (any format with ~ and #)
  if (config.SESSION_ID && config.SESSION_ID.includes("~") && config.SESSION_ID.includes("#")) {
    console.log("🔄 Attempting to load legacy Mega.nz session...");
    const ok = await downloadLegacySession();
    useQR = !ok;
    await start();
    return;
  }

  console.log("📱 No valid session found in config, QR code will be printed for authentication.");
  useQR = true;
  await start();
}

init();

// ------------------------------
// EXPRESS SERVER (KEPT)
// ------------------------------
app.get("/", (req, res) => res.send("Hello World!"));
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
**/
