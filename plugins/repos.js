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
import config from '../config.cjs';

const play = async (m, gss) => {
  const prefix = config.PREFIX;
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  const args = m.body.slice(prefix.length + cmd.length).trim().split(" ");

  if (cmd === "play") {
    try {
      if (!args.length) return m.reply("*Example:* .play shape of you");
      
      const query = args.join(" ");
      m.reply(`*Searching:* ${query}`);
      
      const search = await yts(query);
      const video = search.videos[0];
      if (!video) return m.reply("*No song found*");
      
      const title = video.title;
      const videoId = video.videoId;
      
      m.reply(`*Processing:* ${title}`);
      
      // FIXED: Use the correct URL format that your API expects
      // Your API might need the full YouTube URL
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const apiUrl = `https://apiskeith.vercel.app/download/audio?url=${encodeURIComponent(youtubeUrl)}`;
      
      console.log("API Request URL:", apiUrl);
      
      // Get the audio stream URL
      const response = await axios.get(apiUrl, { timeout: 30000 });
      console.log("API Response:", JSON.stringify(response.data, null, 2));
      
      if (!response.data?.status || !response.data?.result) {
        return m.reply("*❌ API returned invalid data*");
      }
      
      const audioStreamUrl = response.data.result;
      console.log("Audio Stream URL:", audioStreamUrl);
      
      // Validate the stream URL
      if (!audioStreamUrl.startsWith('http')) {
        return m.reply("*❌ Invalid audio URL received*");
      }
      
      // Test if the stream URL is accessible
      try {
        await axios.head(audioStreamUrl, { timeout: 10000 });
      } catch (testError) {
        console.log("Stream URL test failed:", testError.message);
        return m.reply("*❌ Audio stream is not accessible*");
      }
      
      // Send the audio - SIMPLIFIED version
      await gss.sendMessage(
        m.from,
        {
          audio: { url: audioStreamUrl },
          // Remove mimetype and fileName to let WhatsApp detect automatically
          ptt: false,
        },
        { quoted: m }
      );
      
      m.reply(`✅ *${title}* sent successfully!`);
      
    } catch (error) {
      console.error("Full error:", error);
      
      if (error.response) {
        console.log("Response status:", error.response.status);
        console.log("Response data:", error.response.data);
        m.reply(`*❌ API Error ${error.response.status}:* ${JSON.stringify(error.response.data)}`);
      } else if (error.code === 'ECONNABORTED') {
        m.reply("*❌ Timeout. Try a shorter song.*");
      } else {
        m.reply(`*❌ Error:* ${error.message}`);
      }
    }
  }
};

export default play;
