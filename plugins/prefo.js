import config from '../../config.cjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const setprefixCommand = async (m, Matrix) => {
    const prefix = config.PREFIX;
    const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
    
    if (cmd === 'setprefix') {
        // Get bot creator/owner
        const botNumber = await Matrix.decodeJid(Matrix.user.id);
        const isCreator = [botNumber, config.OWNER_NUMBER + '@s.whatsapp.net'].includes(m.sender);
        
        // Get the new prefix from message
        const args = m.body.slice(prefix.length + cmd.length).trim().split(' ');
        const newPrefix = args[0];

        if (!isCreator) {
            await Matrix.sendMessage(m.from, { 
                text: "❌ *ACCESS DENIED*\n\nOnly the bot owner can change the prefix!" 
            }, { quoted: m });
            return;
        }

        if (!newPrefix) {
            await Matrix.sendMessage(m.from, { 
                text: `📝 *USAGE*\n\n• ${prefix}setprefix [new_prefix]\n• Example: ${prefix}setprefix !\n\nCurrent prefix: "${prefix}"` 
            }, { quoted: m });
            return;
        }

        // Validate the new prefix
        if (newPrefix.length > 3) {
            await Matrix.sendMessage(m.from, { 
                text: "❌ *INVALID PREFIX*\n\nPrefix must be 1-3 characters long!" 
            }, { quoted: m });
            return;
        }

        try {
            // Get the config file path
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const configPath = path.join(__dirname, '../../config.cjs');
            
            // Read the config file
            let configContent = fs.readFileSync(configPath, 'utf8');
            
            // Update the PREFIX value in the config file
            const oldPrefix = config.PREFIX;
            const prefixRegex = /(PREFIX:\s*['"])([^'"]*)(['"])/;
            
            if (!configContent.match(prefixRegex)) {
                // Alternative regex pattern
                const altRegex = /(PREFIX\s*=\s*['"])([^'"]*)(['"])/;
                if (configContent.match(altRegex)) {
                    configContent = configContent.replace(altRegex, `$1${newPrefix}$3`);
                } else {
                    // Try to find PREFIX in any format
                    configContent = configContent.replace(
                        /(PREFIX\s*[:=]\s*['"]?)[^'"\n,}]*(["'\]?,?\n})/,
                        `$1${newPrefix}$2`
                    );
                }
            } else {
                configContent = configContent.replace(prefixRegex, `$1${newPrefix}$3`);
            }
            
            // Write the updated config back to file
            fs.writeFileSync(configPath, configContent, 'utf8');
            
            // Update the in-memory config
            config.PREFIX = newPrefix;
            
            // Send success message
            await Matrix.sendMessage(m.from, {
                text: `✅ *PREFIX UPDATED*\n\n• Old prefix: "${oldPrefix}"\n• New prefix: "${newPrefix}"\n\n⚠️ Note: Restart the bot for all modules to recognize the new prefix!`,
                contextInfo: {
                    mentionedJid: [m.sender],
                    forwardingScore: 999,
                    isForwarded: true
                }
            }, { quoted: m });
            
            // Add reaction
            await m.React('✅');
            
            // Log the change
            console.log(`[PREFIX] Changed from "${oldPrefix}" to "${newPrefix}" by ${m.sender.split('@')[0]}`);
            
        } catch (error) {
            console.error('Error updating prefix:', error);
            
            await Matrix.sendMessage(m.from, { 
                text: `❌ *ERROR*\n\nFailed to update prefix:\n\`\`\`${error.message}\`\`\`` 
            }, { quoted: m });
            
            await m.React('❌');
        }
    }
};

export default setprefixCommand;
