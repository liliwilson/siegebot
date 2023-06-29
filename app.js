const { App } = require("@slack/bolt");

require("dotenv").config();

console.log(process.env);
console.log(process.env.SLACK_APP_TOKEN);

// Initializes app with bot token and signing secret
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  ignoreSelf: false,
});

async function scheduleBeReal() {
  // get new date
  const nextMessage = new Date();
  nextMessage.setDate(nextMessage.getDate() + 1); // for the next day
  const randomHour = Math.floor(Math.random() * 12) + 13; // 9am to 9pm in est, this is in utc // todo check this for timezone
  const randomMinute = Math.floor(Math.random() * 60);
  const randomSecond = Math.floor(Math.random() * 60);
  nextMessage.setHours(randomHour, randomMinute, randomSecond);

  // nextMessage.setSeconds(nextMessage.getSeconds() + 60); // for testing purposes

  try {
    // check if any are scheduled already
    const scheduled =
      (await app.client.chat.scheduledMessages.list()).scheduled_messages ?? [];

    let needSchedule = true;

    // todo make a helper func
    for (const message of scheduled) {
      if (message.text === "it's time to BeReal! <!channel>") {
        const msgTime = new Date(message.post_at * 1000);

        // if they're the same day, don't redo it (convert to EST)
        first = new Date(msgTime.getTime());
        first.setHours(msgTime.getHours() - 4);
        second = new Date(nextMessage.getTime());
        second.setHours(nextMessage.getHours() - 4);

        if (
          first.getFullYear() === second.getFullYear() &&
          first.getMonth() === second.getMonth() &&
          first.getDate() === second.getDate()
        ) {
          needSchedule = false;
        }
      }
    }

    if (needSchedule) {
      await app.client.chat.scheduleMessage({
        channel: "bereal",
        text: "it's time to BeReal!",
        post_at: Math.floor(nextMessage.getTime() / 1000),
      });

      console.log(`scheduled next message for ${nextMessage.toString()}`);
    } else {
      console.log("not scheduling due to existing msg");
    }
  } catch (error) {
    console.error(error);
  }
}

// listen for when we send the bereal message
app.event("message", ({ event }) => {
  if (
    event.bot_profile !== undefined &&
    event.bot_profile.name === "siegebot"
  ) {
    if (event.text.includes("it's time to BeReal!")) {
      scheduleBeReal();
    }
  }
});

// command, get the next scheduled bereal times
app.command("/schedule", async ( { command, say }) => {
  try {
    const scheduled =
      (await app.client.chat.scheduledMessages.list()).scheduled_messages ?? [];

    const schedule = scheduled.sort((a,b) => a.post_at - b.post_at)
      .filter((message) => message.text === "it's time to BeReal!")
      .map((message) => new Date(message.post_at * 1000).toString());

    const message =
      "next scheduled time:\n" +
      schedule.reduce((prev, next) => prev + "\n" + next, "");

    await say(message);

  } catch (error) {
    console.error(error);
  }
});

app.message("hi", () => {
  app.client.chat.postMessage({
    channel: "bereal",
    text: "it's time to BeReal! <!channel>",
  });
});

(async () => {
  // Start the app
  console.log("we are running");
  await app.start(process.env.PORT || 3000);

  console.log("⚡️ Bolt app is running!");
})();
