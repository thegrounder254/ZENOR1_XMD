// lib/Serializer.js
import { fileTypeFromBuffer } from 'file-type';
import fs from 'fs';
import pino from 'pino';
import path from 'path';
import PhoneNumber from 'awesome-phonenumber';
import config from '../config.cjs';
import { imageToWebp, videoToWebp, writeExifImg, writeExifVid } from '../lib/exif.cjs';
import { getBuffer, getSizeMedia } from '../lib/myfunc.cjs';

// Helper function to import baileys/xmd-baileys properly
async function importBaileys() {
    try {
        // Try importing xmd-baileys as ESM
        const baileys = await import('@whiskeysockets/baileys');
        return baileys.default || baileys;
    } catch (e) {
        console.error('Failed to import baileys:', e);
        throw e;
    }
}

// Initialize baileys imports
let baileys;
let store;

// Create a self-executing async function to handle async imports
(async () => {
    try {
        baileys = await importBaileys();
        
        // Get all required functions from baileys
        const {
            getContentType,
            jidDecode,
            downloadMediaMessage,
            downloadContentFromMessage,
            generateWAMessage,
            areJidsSameUser,
            generateForwardMessageContent,
            generateWAMessageFromContent,
            proto,
            makeInMemoryStore
        } = baileys;

        // Make them available globally in this module
        global.baileysExports = {
            getContentType,
            jidDecode,
            downloadMediaMessage,
            downloadContentFromMessage,
            generateWAMessage,
            areJidsSameUser,
            generateForwardMessageContent,
            generateWAMessageFromContent,
            proto
        };

        // Initialize store if makeInMemoryStore exists
        if (makeInMemoryStore && typeof makeInMemoryStore === 'function') {
            store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
        } else {
            // Create a simple fallback store
            console.warn('makeInMemoryStore not found, using fallback store');
            store = createFallbackStore();
        }
    } catch (error) {
        console.error('Error initializing baileys:', error);
        // Create fallback exports
        global.baileysExports = createFallbackExports();
        store = createFallbackStore();
    }
})();

// Fallback exports if baileys fails to load
function createFallbackExports() {
    return {
        getContentType: () => 'conversation',
        jidDecode: (jid) => ({ user: jid.split('@')[0], server: jid.split('@')[1] }),
        downloadMediaMessage: async () => Buffer.from([]),
        downloadContentFromMessage: async function* () { yield Buffer.from([]); },
        generateWAMessage: async () => ({}),
        areJidsSameUser: (a, b) => a === b,
        generateForwardMessageContent: async () => ({}),
        generateWAMessageFromContent: async () => ({}),
        proto: { WebMessageInfo: { fromObject: (obj) => obj } }
    };
}

// Fallback store implementation
function createFallbackStore() {
    return {
        contacts: {},
        chats: {},
        messages: {},
        loadMessage: function(jid, id, sock) {
            return this.messages[jid]?.[id] || null;
        },
        saveMessage: function(msg) {
            if (!msg.key) return;
            const { remoteJid, id } = msg.key;
            if (!this.messages[remoteJid]) this.messages[remoteJid] = {};
            this.messages[remoteJid][id] = msg;
        },
        bind: function(sock) {
            sock.ev?.on('messages.upsert', (data) => {
                data.messages?.forEach(msg => this.saveMessage(msg));
            });
            sock.ev?.on('contacts.update', (updates) => {
                updates.forEach(update => {
                    if (update.id) {
                        this.contacts[update.id] = { id: update.id, name: update.notify || update.name };
                    }
                });
            });
        }
    };
}

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

// Wait for baileys to be initialized before defining these functions
function decodeJid(jid) {
    const { jidDecode } = global.baileysExports || {};
    if (!jidDecode) return jid;
    const { user, server } = jidDecode(jid) || {};
    return user && server ? `${user}@${server}`.trim() : jid;
}

const downloadMedia = async message => {
    const { downloadContentFromMessage } = global.baileysExports || {};
    if (!downloadContentFromMessage) return Buffer.from([]);
    
    let type = Object.keys(message)[0];
    let m = message[type];
    if (type === "buttonsMessage" || type === "viewOnceMessageV2") {
        if (type === "viewOnceMessageV2") {
            m = message.viewOnceMessageV2?.message;
            type = Object.keys(m || {})[0];
        } else type = Object.keys(m || {})[1];
        m = m[type];
    }
    const stream = await downloadContentFromMessage(
        m,
        type.replace("Message", "")
    );
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
};

function serialize(m, sock, logger) {
    // Ensure baileys exports are available
    const {
        getContentType,
        jidDecode,
        downloadMediaMessage,
        generateWAMessage,
        areJidsSameUser,
        generateForwardMessageContent,
        generateWAMessageFromContent,
        proto
    } = global.baileysExports || {};

    // Ensure store is bound to socket
    if (store && !store.bound) {
        store.bind(sock);
        store.bound = true;
    }

    // downloadFile function
    async function downloadFile(m) {
        try {
            const buffer = await downloadMediaMessage(
                m,
                "buffer",
                {},
                { logger, reuploadRequest: sock.updateMediaMessage }
            );
            return buffer;
        } catch (error) {
            console.error('Error downloading media:', error);
            return null;
        }
    }

    // React function
    async function React(emoji) {
        let reactm = {
            react: {
                text: emoji,
                key: m.key,
            },
        };
        await sock.sendMessage(m.from, reactm);
    }

    // Define the decodeJid function for socket
    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        } else {
            return jid;
        }
    };

    // Define event listener for contacts update
    sock.ev?.on('contacts.update', update => {
        for (let contact of update) {
            let id = sock.decodeJid(contact.id);
            if (store && store.contacts) {
                store.contacts[id] = { id, name: contact.notify };
            }
        }
    });

    // Define the getName function
    sock.getName = (jid, withoutContact = false) => {
        jid = sock.decodeJid(jid);
        withoutContact = sock.withoutContact || withoutContact;
        let v;
        if (jid.endsWith("@g.us")) {
            return new Promise(async (resolve) => {
                v = store.contacts[jid] || {};
                if (!(v.name || v.subject)) v = await sock.groupMetadata(jid) || {};
                resolve(v.name || v.subject || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international'));
            });
        } else {
            v = jid === '0@s.whatsapp.net' ? {
                id: jid,
                name: 'WhatsApp'
            } : jid === sock.decodeJid(sock.user.id) ?
                sock.user :
                (store.contacts[jid] || {});
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
        }
    };

    // Define the sendContact function
    sock.sendContact = async (jid, kon, quoted = '', opts = {}) => {
        let list = [];
        for (let i of kon) {
            let name = config.OWNER_NAME;
            list.push({
                displayName: name,
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${await sock.getName(i + "@s.whatsapp.net")}\nFN:${name}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:Click here to chat\nEND:VCARD`
            });
        }
        sock.sendMessage(jid, { contacts: { displayName: `${list.length} Kontak`, contacts: list }, ...opts }, { quoted });
    };

    // sendImageAsSticker function
    sock.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await getBuffer(path)) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        let buffer
        if (options && (options.packname || options.author)) {
            buffer = await writeExifImg(buff, options)
        } else {
            buffer = await imageToWebp(buff)
        }

        await sock.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted })
        return buffer
    }

    // sendVideoAsSticker function
    sock.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await getBuffer(path)) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        let buffer
        if (options && (options.packname || options.author)) {
            buffer = await writeExifVid(buff, options)
        } else {
            buffer = await videoToWebp(buff)
        }

        await sock.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted })
        return buffer
    }

    // sendPoll function
    sock.sendPoll = (jid, name = '', values = [], selectableCount = 1) => {
        return sock.sendMessage(jid, { poll: { name, values, selectableCount } })
    }

    // sendMedia function
    sock.sendMedia = async (jid, path, fileName = '', caption = '', quoted = '', options = {}) => {
        let types = await sock.getFile(path, true)
        let { mime, ext, res, data, filename } = types
        let type = '', mimetype = mime, pathFile = filename
        if (options.asDocument) type = 'document'
        if (options.asSticker || /webp/.test(mime)) {
            let { writeExif } = await import('../lib/exif.cjs');
            let media = { mimetype: mime, data }
            pathFile = await writeExif(media, { packname: options.packname || 'My Pack', author: options.author || 'Me', categories: options.categories || [] })
            await fs.promises.unlink(filename)
            type = 'sticker'
            mimetype = 'image/webp'
        } else if (/image/.test(mime)) type = 'image'
        else if (/video/.test(mime)) type = 'video'
        else if (/audio/.test(mime)) type = 'audio'
        else type = 'document'
        await sock.sendMessage(jid, { [type]: { url: pathFile }, caption, mimetype, fileName, ...options }, { quoted, ...options })
        return fs.promises.unlink(pathFile)
    }

    // getFile function
    sock.getFile = async (PATH, save) => {
        let res, filename
        let data = Buffer.isBuffer(PATH) ? PATH : /^data:.*?\/.*?;base64,/i.test(PATH) ? Buffer.from(PATH.split`,`[1], 'base64') : /^https?:\/\//.test(PATH) ? (res = await getBuffer(PATH)) : fs.existsSync(PATH) ? (filename = PATH, fs.readFileSync(PATH)) : typeof PATH === 'string' ? PATH : Buffer.alloc(0)
        if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer')
        let type = await fileTypeFromBuffer(data) || {
            mime: 'application/octet-stream',
            ext: '.bin'
        }
        if (data && save && !filename) {
            filename = path.join(__dirname, './' + new Date * 1 + '.' + type.ext);
            await fs.promises.writeFile(filename, data);
        }
        return {
            res,
            filename,
            size: await getSizeMedia(data),
            ...type,
            data
        }
    }

    // downloadAndSaveMediaMessage function
    sock.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
        const { downloadContentFromMessage } = global.baileysExports || {};
        let quoted = message.msg ? message.msg : message;
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(quoted, messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        const type = await fileTypeFromBuffer(buffer);
        const trueFileName = attachExtension ? `${filename}.${type.ext}` : filename;
        await fs.promises.writeFile(trueFileName, buffer);
        return trueFileName;
    }

    // downloadMediaMessage function
    sock.downloadMediaMessage = async (message) => {
        const { downloadContentFromMessage } = global.baileysExports || {};
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(message, messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    }

    // copyNForward function
    sock.copyNForward = async (jid, message, forceForward = false, options = {}) => {
        if (!generateForwardMessageContent || !generateWAMessageFromContent) {
            throw new Error('Baileys functions not available');
        }

        let vtype
        if (options.readViewOnce) {
            message.message = message.message && message.message.ephemeralMessage && message.message.ephemeralMessage.message ? message.message.ephemeralMessage.message : (message.message || undefined)
            vtype = Object.keys(message.message.viewOnceMessage.message)[0]
            delete(message.message && message.message.ignore ? message.message.ignore : (message.message || undefined))
            delete message.message.viewOnceMessage.message[vtype].viewOnce
            message.message = {
                ...message.message.viewOnceMessage.message
            }
        }

        let mtype = Object.keys(message.message)[0]
        let content = await generateForwardMessageContent(message, forceForward)
        let ctype = Object.keys(content)[0]
        let context = {}
        if (mtype != "conversation") context = message.message[mtype].contextInfo
        content[ctype].contextInfo = {
            ...context,
            ...content[ctype].contextInfo
        }
        const waMessage = await generateWAMessageFromContent(jid, content, options ? {
            ...content[ctype],
            ...options,
            ...(options.contextInfo ? {
                contextInfo: {
                    ...content[ctype].contextInfo,
                    ...options.contextInfo
                }
            } : {})
        } : {})
        await sock.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id })
        return waMessage
    }

    // cMod function
    sock.cMod = (jid, copy, text = '', sender = sock.user.id, options = {}) => {
        let mtype = Object.keys(copy.message)[0]
        let isEphemeral = mtype === 'ephemeralMessage'
        if (isEphemeral) {
            mtype = Object.keys(copy.message.ephemeralMessage.message)[0]
        }
        let msg = isEphemeral ? copy.message.ephemeralMessage.message : copy.message
        let content = msg[mtype]
        if (typeof content === 'string') msg[mtype] = text || content
        else if (content.caption) content.caption = text || content.caption
        else if (content.text) content.text = text || content.text
        if (typeof content !== 'string') msg[mtype] = {
            ...content,
            ...options
        }
        if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant
        else if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant
        if (copy.key.remoteJid.includes('@s.whatsapp.net')) sender = sender || copy.key.remoteJid
        else if (copy.key.remoteJid.includes('@broadcast')) sender = sender || copy.key.remoteJid
        copy.key.remoteJid = jid
        copy.key.fromMe = sender === sock.user.id

        return proto.WebMessageInfo.fromObject(copy)
    }

    // Process message object
    if (m.key) {
        m.id = m.key.id;
        m.isSelf = m.key.fromMe;
        m.from = decodeJid(m.key.remoteJid);
        m.isGroup = m.from.endsWith("@g.us");
        m.sender = m.isGroup
            ? decodeJid(m.key.participant)
            : m.isSelf
            ? decodeJid(sock.user.id)
            : m.from;
    }

    if (m.message) {
        m.type = getContentType ? getContentType(m.message) : 'conversation';
        if (m.type === "ephemeralMessage") {
            m.message = m.message[m.type].message;
            const tipe = Object.keys(m.message)[0];
            m.type = tipe;
            if (tipe === "viewOnceMessageV2") {
                m.message = m.message[m.type].message;
                m.type = getContentType(m.message);
            }
        }
        if (m.type === "viewOnceMessageV2") {
            m.message = m.message[m.type].message;
            m.type = getContentType(m.message);
        }
        m.messageTypes = type => ["videoMessage", "imageMessage"].includes(type);
        
        try {
            const quoted = m.message[m.type]?.contextInfo;
            if (quoted && quoted.quotedMessage) {
                if (quoted.quotedMessage["ephemeralMessage"]) {
                    const tipe = Object.keys(quoted.quotedMessage.ephemeralMessage.message)[0];
                    if (tipe === "viewOnceMessageV2") {
                        m.quoted = {
                            type: "view_once",
                            stanzaId: quoted.stanzaId,
                            participant: decodeJid(quoted.participant),
                            message: quoted.quotedMessage.ephemeralMessage.message.viewOnceMessageV2.message
                        };
                    } else {
                        m.quoted = {
                            type: "ephemeral",
                            stanzaId: quoted.stanzaId,
                            participant: decodeJid(quoted.participant),
                            message: quoted.quotedMessage.ephemeralMessage.message
                        };
                    }
                } else if (quoted.quotedMessage["viewOnceMessageV2"]) {
                    m.quoted = {
                        type: "view_once",
                        stanzaId: quoted.stanzaId,
                        participant: decodeJid(quoted.participant),
                        message: quoted.quotedMessage.viewOnceMessageV2.message
                    };
                } else {
                    m.quoted = {
                        type: "normal",
                        stanzaId: quoted.stanzaId,
                        participant: decodeJid(quoted.participant),
                        message: quoted.quotedMessage
                    };
                }
                m.quoted.isSelf = m.quoted.participant === decodeJid(sock.user.id);
                m.quoted.mtype = Object.keys(m.quoted.message).filter(
                    v => v.includes("Message") || v.includes("conversation")
                )[0];
                m.quoted.text = m.quoted.message[m.quoted.mtype]?.text ||
                    m.quoted.message[m.quoted.mtype]?.description ||
                    m.quoted.message[m.quoted.mtype]?.caption ||
                    m.quoted.message[m.quoted.mtype]?.hydratedTemplate?.hydratedContentText ||
                    m.quoted.message[m.quoted.mtype] ||
                    "";
                m.quoted.key = {
                    id: m.quoted.stanzaId,
                    fromMe: m.quoted.isSelf,
                    remoteJid: m.from
                };
                m.quoted.download = () => downloadMedia(m.quoted.message);
            } else {
                m.quoted = null;
            }
        } catch {
            m.quoted = null;
        }
        
        m.body = m.message?.conversation ||
            m.message?.[m.type]?.text ||
            m.message?.[m.type]?.caption ||
            (m.type === "listResponseMessage" && m.message?.[m.type]?.singleSelectReply?.selectedRowId) ||
            (m.type === "buttonsResponseMessage" && m.message?.[m.type]?.selectedButtonId) ||
            (m.type === "templateButtonReplyMessage" && m.message?.[m.type]?.selectedId) ||
            "";
        m.reply = text => sock.sendMessage(m.from, { text }, { quoted: m });
        m.mentions = [];
        if (m.quoted?.participant) m.mentions.push(m.quoted.participant);
        const array = m?.message?.[m.type]?.contextInfo?.mentionedJid || [];
        m.mentions.push(...array.filter(Boolean));
        m.download = () => downloadMedia(m.message);
        m.downloadFile = () => downloadFile(m);
        m.React = (emoji) => React(emoji);
    }

    // getQuotedObj function
    m.getQuotedObj = async () => {
        if (!m.quoted) return null;
        let qKey = m.message.extendedTextMessage?.contextInfo?.stanzaId;
        if (!qKey) return null;
        let qMsg = store.loadMessage(m.from, qKey, sock);
        return serialize(qMsg, sock, logger);
    };

    // copy function
    m.copy = () => {
        // This would need the actual implementation
        console.warn('m.copy() not fully implemented');
        return m;
    };

    m.copyNForward = (jid = m.from, forceForward = false, options = {}) =>
        sock.copyNForward(jid, m, forceForward, options);

    sock.appenTextMessage = async (text, chatUpdate) => {
        if (!generateWAMessage) return;
        let messages = await generateWAMessage(m.from, { text: text, mentions: m.mentionedJid }, {
            userJid: sock.user.id,
            quoted: m.quoted && m.quoted.fakeObj
        })
        messages.key.fromMe = areJidsSameUser(m.sender, sock.user.id)
        messages.key.id = m.key.id
        messages.pushName = m.pushName
        if (m.isGroup) messages.participant = m.sender
        let msg = {
            ...chatUpdate,
            messages: [proto.WebMessageInfo.fromObject(messages)],
            type: 'append'
        }
        sock.ev.emit('messages.upsert', msg)
    }

    return m;
}

// Export functions
export { decodeJid, serialize };

// Export a function to check if baileys is loaded
export function isBaileysLoaded() {
    return !!global.baileysExports;
}
export { decodeJid, serialize };
