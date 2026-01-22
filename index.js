import dotenv from 'dotenv';
dotenv.config();

import {
    makeWASocket,
    Browsers,
    fetchLatestBaileysVersion,
    DisconnectReason,
    useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Handler, Callupdate, GroupUpdate } from './data/index.js';
import express from 'express';
import pino from 'pino';
import fs from 'fs';
import { File } from 'megajs';
import NodeCache from 'node-cache';
import path from 'path';
import chalk from 'chalk';
import moment from 'moment-timezone';
import axios from 'axios';
import config from './config.cjs';
import pkg from './lib/autoreact.cjs';
import zlib from 'zlib';
import { promisify } from 'util';
import qrcode from 'qrcode'; // Add this import

const { emojis, doReact } = pkg;
const prefix = process.env.PREFIX || config.PREFIX;
const sessionName = "session";
const app = express();
const orange = chalk.bold.hex("#FFA500");
const lime = chalk.bold.hex("#32CD32");
let useQR = false;
let initialConnection = true;
const PORT = process.env.PORT || 3000;

const MAIN_LOGGER = pino({
    timestamp: () => `,"time":"${new Date().toJSON()}"`
});
const logger = MAIN_LOGGER.child({});
logger.level = "trace";

const msgRetryCounterCache = new NodeCache();

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const sessionDir = path.join(__dirname, 'session');
const credsPath = path.join(sessionDir, 'creds.json');

if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

// Add QR code endpoint for web scanning
let currentQR = null;
app.get('/qr', async (req, res) => {
    try {
        if (currentQR) {
            // Return QR code as PNG image
            const qrBuffer = await qrcode.toBuffer(currentQR);
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': qrBuffer.length
            });
            res.end(qrBuffer);
        } else {
            res.status(404).send('QR code not available yet. Wait a few seconds and refresh.');
        }
    } catch (error) {
        console.error('QR endpoint error:', error);
        res.status(500).send('Error generating QR code');
    }
});

app.get('/qr-page', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Scan WhatsApp QR Code</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    text-align: center; 
                    padding: 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                }
                .container {
                    background: white;
                    padding: 30px;
                    border-radius: 15px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                    max-width: 400px;
                    width: 100%;
                }
                h1 { 
                    color: #333; 
                    margin-bottom: 20px;
                }
                #qr-container {
                    margin: 20px 0;
                    padding: 15px;
                    background: #f8f9fa;
                    border-radius: 10px;
                }
                img {
                    max-width: 100%;
                    height: auto;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                }
                .status {
                    margin-top: 15px;
                    padding: 10px;
                    border-radius: 5px;
                    font-weight: bold;
                }
                .waiting { background: #fff3cd; color: #856404; }
                .ready { background: #d4edda; color: #155724; }
                .error { background: #f8d7da; color: #721c24; }
                .instructions {
                    margin-top: 20px;
                    text-align: left;
                    background: #e9ecef;
                    padding: 15px;
                    border-radius: 8px;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Scan WhatsApp QR Code</h1>
                <div id="qr-container">
                    <img id="qr-image" src="" alt="QR Code">
                </div>
                <div id="status" class="status waiting">
                    Waiting for QR code...
                </div>
                <div class="instructions">
                    <h3>Instructions:</h3>
                    <ol>
                        <li>Open WhatsApp on your phone</li>
                        <li>Tap Menu → Linked Devices</li>
                        <li>Tap Link a Device</li>
                        <li>Point your camera at the QR code</li>
                        <li>This page will auto-refresh every 5 seconds</li>
                    </ol>
                </div>
            </div>
            <script>
                let checkAttempts = 0;
                const maxAttempts = 60; // 5 minutes max
                
                function updateQR() {
                    checkAttempts++;
                    if (checkAttempts > maxAttempts) {
                        document.getElementById('status').innerHTML = 
                            '<div class="error">Timeout: No QR code generated. Restart the bot.</div>';
                        return;
                    }
                    
                    // Add timestamp to prevent caching
                    const qrUrl = '/qr?' + new Date().getTime();
                    document.getElementById('qr-image').src = qrUrl;
                    
                    fetch('/qr')
                        .then(response => {
                            if (response.ok) {
                                document.getElementById('status').innerHTML = 
                                    '<div class="ready">✓ QR code loaded. Scan with WhatsApp!</div>';
                            } else {
                                document.getElementById('status').innerHTML = 
                                    '<div class="waiting">Waiting for QR code... (Attempt ' + checkAttempts + '/' + maxAttempts + ')</div>';
                                setTimeout(updateQR, 5000);
                            }
                        })
                        .catch(error => {
                            console.error('Error fetching QR:', error);
                            document.getElementById('status').innerHTML = 
                                '<div class="error">Error loading QR. Retrying in 5 seconds...</div>';
                            setTimeout(updateQR, 5000);
                        });
                }
                
                // Initial load
                updateQR();
                
                // Auto-refresh every 5 seconds
                setInterval(updateQR, 5000);
            </script>
        </body>
        </html>
    `);
});

async function loadGiftedSession() {
    console.log("Checking SESSION_ID format...");
    
    if (!config.SESSION_ID) {
        console.error('No SESSION_ID provided in config!');
        return false;
    }
    
    // Check if session starts with "Zenor~"
    if (config.SESSION_ID.startsWith("Zenor~")) {
        console.log("Detected Gifted session format (GZIP compressed)");
        
        // Extract Base64 part (everything after "Gifted~")
        const compressedBase64 = config.SESSION_ID.substring("Zenor~".length);
        console.log("Compressed Base64 length:", compressedBase64.length);
        
        try {
            // Decode Base64
            const compressedBuffer = Buffer.from(compressedBase64, 'base64');
            console.log("Decoded buffer length:", compressedBuffer.length);
            
            // Check if it's GZIP compressed
            if (compressedBuffer[0] === 0x1f && compressedBuffer[1] === 0x8b) {
                console.log("✅ Detected GZIP compression");
                
                // Decompress using GZIP
                const gunzip = promisify(zlib.gunzip);
                const decompressedBuffer = await gunzip(compressedBuffer);
                const sessionData = decompressedBuffer.toString('utf-8');
                
                console.log("Decompressed session data (first 200 chars):");
                console.log(sessionData.substring(0, 200));
                
                // Try to parse as JSON
                try {
                    const parsedSession = JSON.parse(sessionData);
                    console.log("Successfully parsed JSON session");
                    console.log("Session keys:", Object.keys(parsedSession));
                } catch (parseError) {
                    console.log("Session data is not JSON, saving as raw string");
                }
                
                // Save session to file
                await fs.promises.writeFile(credsPath, sessionData);
                console.log("Session saved to file successfully");
                return true;
            } else {
                console.log("Not a valid GZIP file (missing magic bytes)");
                return false;
            }
        } catch (error) {
            console.error('Failed to process Gifted session:', error.message);
            console.error('Error details:', error);
            return false;
        }
    } else {
        console.log("SESSION_ID does not start with Gifted~");
        return false;
    }
}

async function downloadLegacySession() {
    console.log("Debugging SESSION_ID:", config.SESSION_ID);

    if (!config.SESSION_ID) {
        console.error('Please add your session to SESSION_ID env !!');
        return false;
    }

    const sessdata = config.SESSION_ID.split("Zenor~")[1];

    if (!sessdata || !sessdata.includes("#")) {
        console.error('Invalid SESSION_ID format! It must contain both file ID and decryption key.');
        return false;
    }

    const [fileID, decryptKey] = sessdata.split("#");

    try {
        console.log("Downloading Legacy Session from Mega.nz...");
        const file = File.fromURL(`https://mega.nz/file/${fileID}#${decryptKey}`);

        const data = await new Promise((resolve, reject) => {
            file.download((err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        await fs.promises.writeFile(credsPath, data);
        console.log("Legacy Session Successfully Loaded !!");
        return true;
    } catch (error) {
        console.error('Failed to download legacy session data:', error);
        return false;
    }
}

async function start() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Buddy-XTR using WA v${version.join('.')}, isLatest: ${isLatest}`);
        
        const Matrix = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: useQR,
            browser: ["Buddy-XTR", "safari", "3.3"],
            auth: state,
            getMessage: async (key) => {
                if (store) {
                    const msg = await store.loadMessage(key.remoteJid, key.id);
                    return msg.message || undefined;
                }
                return { conversation: "whatsapp user bot" };
            }
        });

        Matrix.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            // Handle QR code generation
            if (qr) {
                console.log(chalk.yellow('QR code received! Scan it to authenticate.'));
                console.log(chalk.blue('Or scan at: https://' + process.env.HEROKU_APP_NAME + '.herokuapp.com/qr-page'));
                currentQR = qr;
                
                // Also show in terminal if needed
                if (useQR) {
                    console.log('Terminal QR:', qr);
                }
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
                console.log(chalk.red(`Connection closed. Reason: ${lastDisconnect.error?.output?.statusCode || 'unknown'}`));
                
                if (shouldReconnect) {
                    console.log(chalk.yellow('Reconnecting in 5 seconds...'));
                    setTimeout(start, 5000);
                } else {
                    console.log(chalk.red('Logged out. Please scan QR code again.'));
                    // Clear session file on logout
                    try {
                        if (fs.existsSync(credsPath)) {
                            fs.unlinkSync(credsPath);
                        }
                    } catch (err) {
                        console.error('Error clearing session:', err);
                    }
                    // Restart to show QR again
                    setTimeout(start, 5000);
                }
            } else if (connection === 'open') {
                currentQR = null; // Clear QR once connected
                if (initialConnection) {
                    console.log(chalk.green("Connected Successfully"));
                    try {
                        await Matrix.sendMessage(Matrix.user.id, { 
                            image: { url: "https://files.catbox.moe/oaus7r.jpg" }, 
                            caption: `*Bot Activated* 

> Welcome to Zenor_XMD
*Enjoy our New whatsapp Bot*

> Thanks to Carl William`
                        });
                    } catch (sendError) {
                        console.error('Failed to send welcome message:', sendError);
                    }
                    initialConnection = false;
                } else {
                    console.log(chalk.blue("Connection reestablished after restart."));
                }
            }
        });
        
        Matrix.ev.on('creds.update', saveCreds);

        Matrix.ev.on("messages.upsert", async chatUpdate => await Handler(chatUpdate, Matrix, logger));
        Matrix.ev.on("call", async (json) => await Callupdate(json, Matrix));
        Matrix.ev.on("group-participants.update", async (messag) => await GroupUpdate(Matrix, messag));

        if (config.MODE === "public") {
            Matrix.public = true;
        } else if (config.MODE === "private") {
            Matrix.public = false;
        }

        Matrix.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages[0];
                console.log(mek);
                if (!mek.key.fromMe && config.AUTO_REACT) {
                    console.log(mek);
                    if (mek.message) {
                        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                        await doReact(randomEmoji, mek, Matrix);
                    }
                }
            } catch (err) {
                console.error('Error during auto reaction:', err);
            }
        });
        
        Matrix.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages[0];
                const fromJid = mek.key.participant || mek.key.remoteJid;
                if (!mek || !mek.message) return;
                if (mek.key.fromMe) return;
                if (mek.message?.protocolMessage || mek.message?.ephemeralMessage || mek.message?.reactionMessage) return; 
                if (mek.key && mek.key.remoteJid === 'status@broadcast' && config.AUTO_STATUS_SEEN) {
                    await Matrix.readMessages([mek.key]);
                    
                    if (config.AUTO_STATUS_REPLY) {
                        const customMessage = config.STATUS_READ_MSG || 'Auto Status Seen Bot By Zenor-XMD';
                        await Matrix.sendMessage(fromJid, { text: customMessage }, { quoted: mek });
                    }
                }
            } catch (err) {
                console.error('Error handling messages.upsert event:', err);
            }
        });

    } catch (error) {
        console.error('Critical Error in start():', error);
        console.error('Stack trace:', error.stack);
        // Don't exit the process - retry after delay
        console.log(chalk.yellow('Retrying connection in 10 seconds...'));
        setTimeout(start, 10000);
    }
}

async function init() {
    // Always use QR code on Heroku since session files are ephemeral
    const isHeroku = !!process.env.DYNO;
    
    if (isHeroku) {
        console.log(chalk.cyan('Running on Heroku - QR code mode enabled'));
        console.log(chalk.cyan('Visit: https://' + (process.env.HEROKU_APP_NAME || 'your-app') + '.herokuapp.com/qr-page'));
        useQR = false; // We'll use web QR instead
    }
    
    if (fs.existsSync(credsPath)) {
        console.log("Existing session file found, loading it...");
        await start();
    } else {
        console.log("No existing session file, checking config.SESSION_ID...");
        
        if (config.SESSION_ID && config.SESSION_ID.startsWith("Zenor~")) {
            console.log("Attempting to load Gifted session (GZIP compressed)...");
            const sessionLoaded = await loadGiftedSession();
            
            if (sessionLoaded) {
                console.log("Session loaded successfully!");
                await start();
            } else {
                console.log("Failed to load Gifted session, falling back to QR code.");
                console.log(chalk.green("Please scan the QR code at /qr-page"));
                useQR = true;
                await start();
            }
        } else if (config.SESSION_ID && config.SESSION_ID.includes("Gifted~")) {
            console.log("🔍 Attempting to load legacy Mega.nz session...");
            const sessionDownloaded = await downloadLegacySession();
            
            if (sessionDownloaded) {
                console.log("Legacy session downloaded, starting bot.");
                await start();
            } else {
                console.log("Failed to download legacy session, using QR code.");
                console.log(chalk.green("Please scan the QR code at /qr-page"));
                useQR = true;
                await start();
            }
        } else {
            console.log(chalk.yellow("No valid session found in config."));
            console.log(chalk.green("Please scan the QR code at /qr-page to authenticate."));
            useQR = true;
            await start();
        }
    }
}

// Add global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    console.error(chalk.red('Uncaught Exception:'), error);
    console.error(chalk.red('Stack trace:'), error.stack);
    // Don't exit - keep the process alive
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Rejection at:'), promise);
    console.error(chalk.red('Reason:'), reason);
});

// Start the bot
init();

// Update the existing route
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Buddy-XTR Bot</title>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    text-align: center; 
                    padding: 50px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                }
                .container {
                    background: white;
                    padding: 40px;
                    border-radius: 15px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                    max-width: 500px;
                }
                h1 { 
                    color: #333; 
                    margin-bottom: 20px;
                }
                .status {
                    padding: 15px;
                    border-radius: 8px;
                    margin: 20px 0;
                    font-weight: bold;
                }
                .online { background: #d4edda; color: #155724; }
                .setup { background: #fff3cd; color: #856404; }
                .btn {
                    display: inline-block;
                    background: #667eea;
                    color: white;
                    padding: 12px 24px;
                    text-decoration: none;
                    border-radius: 5px;
                    margin: 10px;
                    font-weight: bold;
                    transition: background 0.3s;
                }
                .btn:hover {
                    background: #5a6fd8;
                }
                .instructions {
                    text-align: left;
                    margin-top: 25px;
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 8px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Buddy-XTR WhatsApp Bot</h1>
                <div class="status ${currentQR ? 'setup' : 'online'}">
                    ${currentQR ? '⚠️ Scan QR Code to Connect' : '✅ Bot is Running'}
                </div>
                <a href="/qr-page" class="btn">Scan QR Code</a>
                <a href="/qr" class="btn">QR Image Only</a>
                <div class="instructions">
                    <h3>How to Connect:</h3>
                    <ol>
                        <li>Click "Scan QR Code" button</li>
                        <li>Open WhatsApp on your phone</li>
                        <li>Go to Settings → Linked Devices → Link a Device</li>
                        <li>Scan the QR code shown on the next page</li>
                        <li>The bot will connect automatically</li>
                    </ol>
                    <p><strong>Note:</strong> On Heroku, you need to scan QR after each restart.</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(chalk.green(`Server is running on port ${PORT}`));
    console.log(chalk.cyan(`Visit http://localhost:${PORT} for QR code`));
    if (process.env.HEROKU_APP_NAME) {
        console.log(chalk.cyan(`Or visit: https://${process.env.HEROKU_APP_NAME}.herokuapp.com`));
    }
});
