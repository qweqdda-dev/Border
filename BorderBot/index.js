const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const spamBot = require('./spamBot'); // spam prevention logic
const chatHandler = require('./chatHandler');
let bot;
let isRestarting = false;
function initializeBot() {
    bot = mineflayer.createBot({
        host: '6b6t.org',
        username: 'hardikbagaria0@gmail.com',
        version: '1.20.1',
        auth: 'microsoft',
    });

    bot.on('login', () => {

        console.log(`Logged in as ${bot.username}`);
        setupMessageHandlers(bot);
        chatHandler.initialize(getBot());
    });
    bot.on('end', () => {
        console.log('Disconnected.');
        if (isRestarting) {
            console.log('Waiting 10 minutes before reconnecting due to server restart...');
            setTimeout(() => {
                isRestarting = false;
                initializeBot();
            }, 7 * 60 * 1000);
        } else {
            console.log('Reconnecting in 5 seconds...');
            setTimeout(initializeBot, 5000);
        }
    });
    spamBot.initialize(bot);
    bot.on('kicked', (reason) => {
        console.log(`Kicked: ${reason}`);
    });

    bot.on('error', (err) => {
        console.log(`Error: ${err}`);
    });

    return bot;
}

bot = initializeBot();

function setupMessageHandlers(bot) {
    bot.on('message', async (jsonMsg) => {
        const message = jsonMsg.toString();
        if (message === 'Server restarts in 60s' ||
            message === 'Server restarts in 30s' ||
            message === 'Server restarts in 15s' ||
            message === 'Server restarts in 10s' ||
            message === 'Server restarts in 5s' ||
            message === 'Server restarts in 4s' ||
            message === 'Server restarts in 3s' ||
            message === 'Server restarts in 2s' ||
            message === 'Server restarts in 1s' ||
            message === 'The target server is offline now! You have been sent to the backup server while it goes back online.' ||
            message === 'You were kicked from main-server: Server closed' ||
            message === 'The main server is restarting. We will be back soon! Join our Discord with /discord command in the meantime.') {
            console.log('Server restart detected. Disconnecting bot...');
            isRestarting = true;
            bot.end();
        }
    });
    bot.on('whisper', (username, message) => {
        if (!['_404notfound___', 'hardik1026'].includes(username)) return;
        if (!message.startsWith('! ')) return;

        const toSay = message.slice(2).trim(); // Remove "!chat " and trim whitespace
        if (toSay.length > 0) {
            bot.chat(toSay);
        }
    });
}

function getBot() {
    return bot;
}
module.exports = { getBot };