/**
 * TelegramNotifier — sends messages via Telegram Bot API.
 *
 * Bot token is read from Firebase Functions config:
 *   firebase functions:config:set telegram.bot_token="YOUR_TOKEN"
 *
 * Usage:
 *   const { sendMessage } = require('./TelegramNotifier');
 *   await sendMessage('123456789', 'Hello!');
 */

const https = require('https');

/**
 * Returns the bot token from Firebase Functions config.
 * Falls back to TELEGRAM_BOT_TOKEN env var for local testing.
 */
function getBotToken() {
    try {
        const token = require('firebase-functions').config().telegram?.bot_token;
        if (token) return token;
    } catch (_) { /* not in Functions context */ }
    return process.env.TELEGRAM_BOT_TOKEN || '';
}

/**
 * Send a Telegram message to a chat.
 * @param {string} chatId  - Telegram chat ID
 * @param {string} text    - Message text (plain text or HTML)
 * @returns {Promise<void>}
 * @throws {Error} on non-2xx response or network failure
 */
async function sendMessage(chatId, text) {
    const token = getBotToken();
    if (!token) throw new Error('Telegram bot token is not configured');

    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${token}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve();
                } else {
                    reject(new Error(`Telegram API error ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

module.exports = { sendMessage };
