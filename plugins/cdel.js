import config from '../../config.cjs';

const deleteMessage = async (m, gss) => {
  try {
    // Get prefix from config with fallback
    const prefix = config.PREFIX || '/';
    const cmd = m.body.startsWith(prefix) 
      ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() 
      : '';
    
    // Expanded command variations
    const validCommands = ['del', 'delete', 'remove', 'purge'];
    
    if (validCommands.includes(cmd)) {
      // Check if we're in a group or personal chat
      const isGroup = m.from.endsWith('@g.us');
      
      // Get user permissions
      const botNumber = await gss.decodeJid(gss.user.id);
      const isCreator = [botNumber, config.OWNER_NUMBER + '@s.whatsapp.net'].includes(m.sender);
      const isBotMessage = m.quoted?.key?.fromMe || false;
      
      // In groups, check if user is admin
      let isGroupAdmin = false;
      if (isGroup) {
        const groupMetadata = await gss.groupMetadata(m.from).catch(() => null);
        if (groupMetadata) {
          const participant = groupMetadata.participants.find(p => p.id === m.sender);
          isGroupAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
        }
      }
      
      // Determine if user has permission to delete
      let hasPermission = false;
      let permissionReason = "";
      
      if (isCreator) {
        hasPermission = true;
        permissionReason = "owner";
      } else if (isGroup && isGroupAdmin && isBotMessage) {
        // Group admins can delete bot's messages in groups
        hasPermission = true;
        permissionReason = "group admin";
      } else if (!isGroup && isBotMessage) {
        // In personal chat, anyone can delete bot's messages
        hasPermission = true;
        permissionReason = "personal chat";
      } else if (isGroup && m.quoted?.key?.participant === m.sender && isGroupAdmin) {
        // Group admins can delete their own messages
        hasPermission = true;
        permissionReason = "own message";
      }
      
      // Check permission
      if (!hasPermission) {
        await m.React('❌');
        return await gss.sendMessage(m.from, {
          text: `❌ *PERMISSION DENIED*\n\nYou don't have permission to delete this message.\n\n• Owner: ${isCreator ? '✅' : '❌'}\n• Group Admin: ${isGroupAdmin ? '✅' : '❌'}\n• Your Message: ${m.quoted?.key?.participant === m.sender ? '✅' : '❌'}\n• Bot's Message: ${isBotMessage ? '✅' : '❌'}`
        }, { quoted: m });
      }
      
      // Check if message is quoted
      if (!m.quoted) {
        await m.React('❓');
        return await gss.sendMessage(m.from, {
          text: `📌 *USAGE*\n\nReply to a message with:\n• ${prefix}delete\n• ${prefix}del\n• ${prefix}remove\n\n*Permissions:*\n• Bot owner can delete any message\n• Group admins can delete bot's messages\n• Users can delete bot's messages in personal chats`
        }, { quoted: m });
      }
      
      // Prepare message key for deletion
      const key = {
        remoteJid: m.from,
        fromMe: m.quoted.key.fromMe || false,
        id: m.quoted.key.id,
        participant: m.quoted.key.participant || m.quoted.key.remoteJid
      };
      
      // Add reaction to indicate processing
      await m.React('⏳');
      
      // Try to delete the message
      const deleteResult = await gss.sendMessage(m.from, { delete: key });
      
      // Check if deletion was successful
      if (deleteResult) {
        await m.React('✅');
        
        // Optional: Send success confirmation (can be disabled)
        if (config.CONFIRM_DELETION !== false) {
          await gss.sendMessage(m.from, {
            text: `✅ *Message Deleted*\n\n• Deleted by: @${m.sender.split('@')[0]}\n• Permission: ${permissionReason}\n• Type: ${isBotMessage ? "Bot's message" : "User message"}\n• Chat: ${isGroup ? "Group" : "Personal"}`,
            mentions: [m.sender]
          });
        }
        
        console.log(`[DELETE] Message deleted by ${m.sender.split('@')[0]} (${permissionReason}) in ${isGroup ? 'group' : 'personal'}`);
      } else {
        throw new Error('Deletion failed without error');
      }
      
    }
  } catch (error) {
    console.error('Error in delete command:', error);
    
    // Specific error handling
    let errorMessage = '❌ *DELETE FAILED*\n\n';
    
    if (error.message?.includes('not found') || error.message?.includes('404')) {
      errorMessage += 'Message not found. It may have already been deleted or is too old.';
    } else if (error.message?.includes('forbidden') || error.message?.includes('403')) {
      errorMessage += 'You don\'t have permission to delete this message.';
    } else if (error.message?.includes('timeout')) {
      errorMessage += 'Request timed out. Please try again.';
    } else {
      errorMessage += `Error: ${error.message}`;
    }
    
    errorMessage += `\n\n*Note:*\n• You can only delete messages sent in the last 24 hours\n• Some messages cannot be deleted by bots`;
    
    await gss.sendMessage(m.from, {
      text: errorMessage
    }, { quoted: m });
    
    await m.React('❌');
  }
};

export default deleteMessage;
