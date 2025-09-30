// core dependencies
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const mcDataLoader = require('minecraft-data');

// database setup
const dbFile = path.join(__dirname, 'cooldowns.sqlite');
const db = new sqlite3.Database(dbFile);

// create cooldowns table if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      username TEXT PRIMARY KEY,
      expiresAt INTEGER
    )
  `);
});

// usernames exempt from cooldown logic
const skipCooldownUsers = ['_404notfound___'];

// utility: wait function
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// utility: generate a random spam tag
function generateAntiSpam() {
  return `${Math.random().toString(36).substring(2, 12)}`;
}

// store cooldown for user
function setCooldown(user, minutes = 1440) {
  if (skipCooldownUsers.includes(user)) {
    console.log(`${user} is in skipCooldown list. Skipping cooldown.`);
    return;
  }

  const expiresAt = Date.now() + minutes * 60 * 1000;
  db.run(`
    INSERT OR REPLACE INTO cooldowns (username, expiresAt)
    VALUES (?, ?)
  `, [user, expiresAt]);
}

// check if user is on cooldown
function isOnCooldown(user) {
  return new Promise(resolve => {
    if (skipCooldownUsers.includes(user)) return resolve(false);

    db.get(`SELECT expiresAt FROM cooldowns WHERE username = ?`, [user], (err, row) => {
      if (err) {
        console.error(err);
        return resolve(false);
      }
      if (!row) return resolve(false);
      resolve(Date.now() < row.expiresAt);
    });
  });
}

// main chat handler
function chatHandler(bot) {


  const recentMessages = []; // to track chat messages
  const teleportStates = {
    active: false,
    currentUser: null,
    timeout: null,
  };

  // store incoming chat messages
  bot.on('message', (jsonMsg) => {
    const msg = jsonMsg.toString();
    if (recentMessages.length > 6) recentMessages.shift();
    recentMessages.push(msg);
  });

  // wait for specific message to appear
  function waitForMessageMatch(expected, tries = 5) {
    return new Promise(async (resolve) => {
      for (let i = 0; i < tries; i++) {
        await wait(1000);
        if (recentMessages.some(msg => msg.includes(expected))) return resolve(true);
      }
      resolve(false);
    });
  }

  async function handleTeleportRequest(user) {
    const onCooldown = await isOnCooldown(user);
    if (onCooldown) {
      console.log(`${user} is on cooldown. Denying Request.`);
      bot.chat(`/tpn ${user}`);
      return;
    }

    if (teleportStates.active) {
      console.log(`Currently handling ${teleportStates.currentUser}, Denying ${user}`);
      bot.chat(`/tpn ${user}`);
      return;
    }

    teleportStates.active = true;
    teleportStates.currentUser = user;

    console.log(`Processing teleport request for: ${user}`);
    const antiSpam = generateAntiSpam();
    bot.chat(`/w ${user} hey please reply with a border 0+,0-,+0,-0,++,+-,-+, --, e-- borders starting with e are end borders.${antiSpam}`);

    // Failsafe: auto-reset after 2 minutes
    teleportStates.timeout = setTimeout(() => {
      console.warn(`Failsafe triggered: ${user} did not complete teleport in 2 minutes`);
      setCooldown(user);
      teleportStates.active = false;
      teleportStates.currentUser = null;
      teleportStates.timeout = null;
      bot.removeListener('message', timeoutListener);
      bot.removeListener('whisper', whisperHandler);
    }, 2 * 60 * 1000);

    // Server-side timeout detection
    const timeoutListener = (jsonMsg) => {
      const msg = jsonMsg.toString();
      if (msg === `Your teleport request from ${user} timed out.` || msg === `Your teleport request from  timed out.`) {
        console.warn(`Server-side teleport timeout detected for ${user}`);
        setCooldown(user, 60);
        bot.chat(`/w ${user} You Failed to select a border. Try after an hour. ${antiSpam}`);
        teleportStates.active = false;
        teleportStates.currentUser = null;
        if (teleportStates.timeout) {
          clearTimeout(teleportStates.timeout);
          teleportStates.timeout = null;
        }
        bot.removeListener('message', timeoutListener);
        bot.removeListener('whisper', whisperHandler);

      }
    };
    bot.on('message', timeoutListener);

    // Handle user whispering a valid border
    const whisperHandler = async (username, message) => {
      if (username !== user) return;

      const borderOptions = ['0+', '0-', '+0', '-0', '++', '+-', '-+', '--', 'e--'];
      const border = message.trim();
      if (!borderOptions.includes(border)) return;

      console.log(`Received valid border "${border}" from ${username}`);
      bot.removeListener('message', timeoutListener);
      bot.removeListener('whisper', whisperHandler);

      bot.chat(`/home ${border}`);
      const homeConfirmed = await waitForMessageMatch(`Teleporting to ${border} in 15 seconds.`);
      if (!homeConfirmed) bot.chat(`/home ${border}`);
      await wait(3000);

      // Recursive function to retry /tpy
      const tryTpy = async () => {
        bot.chat(`/tpy ${username}`);
        console.log(`Trying to accept TP from ${username}`);
        const accepted = await waitForMessageMatch(`Request from ${username} accepted!`);
        if (!accepted) {
          const noRequest = recentMessages.some(msg =>
            msg === `There is no request to accept from ${username}!` ||
            msg === `There is no request to accept from  !` ||
            msg === `Player not found!` ||
            msg === `<yellow>Teleport failed!` ||
            msg === `Teleport failed!`
          );
          if (noRequest) {
            console.warn(`BUG: No teleport request to accept from ${username} or they left before`);
            bot.chat(`/w ${username} Teleport request not found. Try again in an hour. ${antiSpam}`);
            setCooldown(username, 60);
            teleportStates.active = false;
            teleportStates.currentUser = null;
            if (teleportStates.timeout) {
              clearTimeout(teleportStates.timeout);
              teleportStates.timeout = null;
            }
            return;
          }
          await tryTpy(); // retry
        }
      };
      await tryTpy();

      // Final listener to confirm success/failure
      const finalListener = (jsonMsg) => {
        const msg = jsonMsg.toString();

        if (msg === `${username} teleported to you!`) {
          console.log(`${username} has successfully teleported.`);
          bot.chat(`/w ${username} Thankyou for using the bot you will be able to use it again in 24h. ${antiSpam}`);
          setCooldown(username);
          
        } else if (msg === 'Teleport failed!' || msg ==='<yellow>Teleport failed!') {
          console.warn(`Teleport failed for ${username}`);
          bot.chat(`/w ${username} Teleport Failed. You have been timed out for an hour. ${antiSpam}`);
          setCooldown(username, 60);

        } else {
          return; // Ignore unrelated messages
        }

        // Cleanup
        teleportStates.active = false;
        teleportStates.currentUser = null;
        if (teleportStates.timeout) {
          clearTimeout(teleportStates.timeout);
          teleportStates.timeout = null;
        }
        bot.removeListener('message', finalListener);
      };
      bot.on('message', finalListener);
    };

    bot.on('whisper', whisperHandler);
  }

  // main chat listener for teleport requests
  bot.on('message', async (jsonMsg) => {
    const msg = jsonMsg.toString();
    const match = msg.match(/(\w+) wants to teleport to you\./);

    // new teleport request detected
    if (match) {
      const username = match[1];
      console.log(`Detected teleport request from ${username}`);
      await handleTeleportRequest(username);
    }
  });
}

// export handler
module.exports = { initialize: chatHandler };
