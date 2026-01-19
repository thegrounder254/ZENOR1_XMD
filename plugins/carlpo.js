import pkg, { prepareWAMessageMedia } from '@whiskeysockets/baileys';
const { generateWAMessageFromContent } = pkg;
import axios from 'axios';

const handleRepoCommand = async (m, Matrix) => {
  try {
    // Repository information
    const repoOwner = 'carl24tech';
    const repoName = 'Buddy-XTR';
    const repoLink = `https://github.com/${repoOwner}/${repoName}`;
    
    // Fetch repository data from GitHub API
    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}`;
    
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'WhatsApp-Bot',
        'Accept': 'application/vnd.github.v3+json'
      },
      timeout: 10000 // 10 second timeout
    });

    const repoData = response.data;
    
    // Format dates
    const createdDate = new Date(repoData.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const updatedDate = new Date(repoData.updated_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const fetchedDate = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });

    // Get additional information about forks and watchers
    const forksCount = repoData.forks_count || 0;
    const starsCount = repoData.stargazers_count || 0;
    const watchersCount = repoData.watchers_count || 0;
    const openIssues = repoData.open_issues_count || 0;
    const sizeKB = Math.round(repoData.size / 1024 * 100) / 100;
    
    // Owner information
    const ownerName = repoData.owner?.login || repoOwner;
    const ownerAvatar = repoData.owner?.avatar_url || '';

    // Create styled message
    const messageText = 
      `╭─╼「✨ *${repoName.toUpperCase()} REPOSITORY* ✨」\n` +
      `│\n` +
      `│ 📂 *Repository:* ${repoName}\n` +
      `│ 👑 *Owner:* ${ownerName}\n` +
      `│ 🌐 *URL:* ${repoLink}\n` +
      `│\n` +
      `│ 📊 *Statistics:*\n` +
      `│ ⭐ *Stars:* ${starsCount}\n` +
      `│ 🍴 *Forks:* ${forksCount}\n` +
      `│ 👀 *Watchers:* ${watchersCount}\n` +
      `│ 🐛 *Open Issues:* ${openIssues}\n` +
      `│ 💾 *Size:* ${sizeKB} MB\n` +
      `│\n` +
      `│ 📅 *Created:* ${createdDate}\n` +
      `│ 🔄 *Last Updated:* ${updatedDate}\n` +
      `│\n` +
      `│ 📍 *Fetched:* ${fetchedDate}\n` +
      `│\n` +
      `╰─「🛠️ *Developed by ${ownerName}*」\n\n` +
      `💡 *Get Started:*\n` +
      `🔗 Clone: \`git clone ${repoLink}.git\`\n` +
      `📖 Read the README for setup instructions!\n\n` +
      `🌟 *Support the Project:*\n` +
      `• Star the repository ⭐\n` +
      `• Fork and contribute 🍴\n` +
      `• Report issues 🐛\n` +
      `• Share with others 🔄`;

    // Try to send with image if available
    try {
      if (ownerAvatar) {
        // Download owner avatar
        const imageResponse = await axios.get(ownerAvatar, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');
        
        // Prepare message with image
        const msg = generateWAMessageFromContent(m.from, {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2
              },
              imageMessage: {
                url: ownerAvatar,
                mimetype: 'image/jpeg',
                caption: messageText,
                fileSha256: imageBuffer,
                fileLength: imageBuffer.length,
                height: 480,
                width: 480,
                mediaKey: '',
                fileEncSha256: imageBuffer,
                directPath: '',
                mediaKeyTimestamp: Date.now(),
                jpegThumbnail: imageBuffer.toString('base64'),
                contextInfo: {
                  mentionedJid: [m.sender],
                  forwardingScore: 999,
                  isForwarded: true,
                  externalAdReply: {
                    title: `${repoName} Repository`,
                    body: `By ${ownerName}`,
                    mediaType: 1,
                    thumbnailUrl: ownerAvatar,
                    sourceUrl: repoLink
                  }
                }
              }
            }
          }
        }, { quoted: m });
        
        await Matrix.relayMessage(m.from, msg.message, { messageId: msg.key.id });
      } else {
        // Send text-only message
        await Matrix.sendMessage(m.from, {
          text: messageText,
          contextInfo: {
            mentionedJid: [m.sender],
            forwardingScore: 999,
            isForwarded: true,
            externalAdReply: {
              title: `${repoName} Repository`,
              body: `GitHub Repository Information`,
              mediaType: 1,
              thumbnailUrl: `https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png`,
              sourceUrl: repoLink
            }
          }
        }, { quoted: m });
      }
    } catch (imageError) {
      console.log('Image sending failed, sending text only:', imageError.message);
      // Fallback to text-only message
      await Matrix.sendMessage(m.from, {
        text: messageText,
        contextInfo: {
          mentionedJid: [m.sender],
          forwardingScore: 999,
          isForwarded: true
        }
      }, { quoted: m });
    }
    
    await m.React('✅');
    
  } catch (error) {
    console.error('Error fetching repository data:', error);
    
    // Fallback message with basic info
    const fallbackMessage = 
      `🌐 *${repoName} Repository*\n\n` +
      `👑 *Owner:* ${repoOwner}\n` +
      `🔗 *Repository:* ${repoName}\n` +
      `📂 *URL:* https://github.com/${repoOwner}/${repoName}\n\n` +
      `📖 *Description:* WhatsApp Bot with advanced features\n` +
      `🛠️ *Language:* JavaScript/Node.js\n\n` +
      `⚠️ *Note:* Could not fetch live stats from GitHub API\n` +
      `Direct link: https://github.com/${repoOwner}/${repoName}`;
    
    await Matrix.sendMessage(m.from, {
      text: fallbackMessage,
      contextInfo: {
        mentionedJid: [m.sender],
        forwardingScore: 999,
        isForwarded: true
      }
    }, { quoted: m });
    
    await m.React('⚠️');
  }
};

const searchRepo = async (m, Matrix) => {
  // Use config prefix if available, otherwise default
  try {
    const config = await import('../../config.cjs');
    var prefix = config.default?.PREFIX || config.PREFIX || '/';
  } catch {
    var prefix = '/';
  }
  
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  const validCommands = ['repo', 'sc', 'script', 'github', 'source'];
  
  if (validCommands.includes(cmd)) {
    await handleRepoCommand(m, Matrix);
  }
};

export default searchRepo;
