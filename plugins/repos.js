/**import axios from "axios";
import yts from "yt-search";
import config from '../config.cjs';

const play = async (m, gss) => {
  const prefix = config.PREFIX;
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  const args = m.body.slice(prefix.length + cmd.length).trim().split(" ");

  if (cmd === "play") {
    if (args.length === 0 || !args.join(" ")) {
      return m.reply("*Please provide a song name or keywords to search for.*");
    }

    const searchQuery = args.join(" ");
    m.reply("*🎧 Searching for the song...*");

    try {
      const searchResults = await yts(searchQuery);
      if (!searchResults.videos || searchResults.videos.length === 0) {
        return m.reply(`❌ No results found for "${searchQuery}".`);
      }

      const firstResult = searchResults.videos[0];
      const videoUrl = firstResult.url;

      // First API endpoint
      const apiUrl = `https://api.davidcyriltech.my.id/download/ytmp3?url=${videoUrl}`;
      const response = await axios.get(apiUrl);

      if (!response.data.success) {
        return m.reply(`❌ Failed to fetch audio for "${searchQuery}".`);
      }

      const { title, download_url } = response.data.result;

      // Send the audio file
      await gss.sendMessage(
        m.from,
        {
          audio: { url: download_url },
          mimetype: "audio/mp4",
          ptt: false,
        },
        { quoted: m }
      );

      m.reply(`✅ *${title}* has been downloaded successfully!`);
    } catch (error) {
      console.error(error);
      m.reply("❌ An error occurred while processing your request.");
    }
  }
};

export default play;**/













































import axios from "axios";
import yts from "yt-search";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import config from '../config.cjs';

const play = async (m, gss) => {
  const prefix = config.PREFIX;
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  const args = m.body.slice(prefix.length + cmd.length).trim().split(" ");

  if (cmd === "play") {
    if (!args.length) return m.reply("*.play <song name>*");

    const query = args.join(" ");
    m.reply(`*Searching:* ${query}`);

    try {
      const search = await yts(query);
      const video = search.videos[0];
      if (!video) return m.reply("*No results*");

      const title = video.title;
      m.reply(`*Downloading:* ${title}`);

      // Get audio URL from your API
      const apiUrl = `https://apiskeith.vercel.app/download/ytmp3?url=${encodeURIComponent(video.url)}`;
      const apiRes = await axios.get(apiUrl);
      
      if (!apiRes.data?.status || !apiRes.data?.result) {
        return m.reply("*API error*");
      }

      const audioUrl = apiRes.data.result;
      
      // Download audio to buffer
      m.reply("*Converting for WhatsApp...*");
      const audioRes = await axios.get(audioUrl, {
        responseType: 'arraybuffer',
        timeout: 60000
      });

      // Create temp file
      const tempPath = join(tmpdir(), `${Date.now()}_audio.mp3`);
      writeFileSync(tempPath, audioRes.data);

      // Import fs for reading
      const fs = await import('fs');
      const audioBuffer = fs.readFileSync(tempPath);

      // Send audio buffer
      await gss.sendMessage(
        m.from,
        {
          audio: audioBuffer,
          mimetype: "audio/mpeg",
          fileName: `${title.substring(0, 30)}.mp3`,
          ptt: false,
        },
        { quoted: m }
      );

      // Clean up
      unlinkSync(tempPath);
      
      m.reply(`✅ *${title}* sent!`);

    } catch (error) {
      console.error(error);
      m.reply("❌ Error: " + error.message);
    }
  }
};

export default play;
