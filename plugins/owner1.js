import config from '../../config.cjs';

const ownerContact = async (m, gss) => {
    try {
        if (!m.body) return;
        if (m.key?.fromMe) return;

        const prefix = config.PREFIX;
        if (!m.body.startsWith(prefix)) return;

        const args = m.body.slice(prefix.length).trim().split(/\s+/);
        const cmd = args.shift()?.toLowerCase();

        if (cmd !== 'owner') return;

        const ownerNumber = '254740271632';
        const ownerName = '𝔠𝔞𝔯𝔩24𝔱𝔢𝔠𝔥';

        await gss.sendContact(
            m.from,
            [{ number: ownerNumber, name: ownerName }],
            m
        );

        // React success
        await gss.sendMessage(m.from, {
            react: {
                text: "🕵️",
                key: m.key
            }
        });

    } catch (error) {
        console.error('Error sending owner contact:', error);

        await gss.sendMessage(m.from, {
            text: '❌ Error sending owner contact.'
        }, { quoted: m });

        // React failure
        await gss.sendMessage(m.from, {
            react: {
                text: "❌",
                key: m.key
            }
        });
    }
};

export default ownerContact;
