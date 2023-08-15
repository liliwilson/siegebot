const { App, AwsLambdaReceiver } = require("@slack/bolt");
const dotenv = require("dotenv");
dotenv.config();
const fs = require("fs");

// Initialize your custom receiver
const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Initializes app with bot token and signing secret
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  ignoreSelf: false,
  receiver: awsLambdaReceiver,
});

// Handle the Lambda function event
module.exports.handler = async (event, context, callback) => {
  const handler = await awsLambdaReceiver.start();
  return handler(event, context, callback);
};

// given a filename, returns parsed JSON contents
async function readJSON(filename) {
  try {
    const data = await fs.promises.readFile(filename, "utf8");
    const jsonData = JSON.parse(data);
    return jsonData;
  } catch (error) {
    console.error("error reading/parsing json file:", error);
    throw error;
  }
}

// generate a schedule for a week of messages
// returns a list of numbers [0-6] that represents day offsets from the current day
function getWeeklySchedule(startDate, timesPerWeek) {
  // this represents offsets of the current date
  const weekDates = [0, 1, 2, 3, 4, 5, 6];
  const chosenDates = new Set();

  // get weekend date
  const daysUntilSat = 6 - startDate.getDay();
  const daysUntilSun = (daysUntilSat + 1) % 7;
  chosenDates.add(Math.random() < 0.5 ? daysUntilSat : daysUntilSun);

  // fill up the rest of our dates
  while (chosenDates.size < timesPerWeek) {
    chosenDates.add(weekDates[Math.floor(Math.random() * weekDates.length)]);
  }
  return Array.from(chosenDates).sort();
}

// get a random prompt from promptList, remove it if removePrompt is true
function getRandomPrompt(promptList, removePrompt) {
  const index = Math.floor(Math.random() * promptList.length);
  const prompt = promptList[index];
  if (removePrompt) promptList.splice(index, 1);
  return prompt;
}

// add days to a date
function addDays(startDate, days) {
  const newDate = new Date(startDate.valueOf());
  newDate.setDate(newDate.getDate() + days);
  return newDate;
}

async function schedulePrompts(startDate, promptList = []) {
  const { oneTimePrompts, repeatedPrompts, timesPerWeek, probabilityRepeat } =
    await readJSON("prompt_config.json");

  // if we didn't input a prompt list, use the one from config
  const prompts = promptList.length === 0 ? oneTimePrompts : promptList;

  while (prompts.length > 0) {
    // generate timesPerWeek days in the next week
    const nextTimes = getWeeklySchedule(startDate, timesPerWeek);

    for (const time of nextTimes) {
      if (prompts.length === 0) break;

      // get a prompt randomly with probability
      const isOneTime = Math.random() > probabilityRepeat;
      const prompt = isOneTime
        ? getRandomPrompt(prompts, true)
        : getRandomPrompt(repeatedPrompts, false);

      // get the next time
      const nextTime = addDays(startDate, time);
      nextTime.setHours(
        12 + Math.random() * 4,
        Math.floor(Math.random() * 60),
        0
      );

      // schedule message
      await app.client.chat.scheduleMessage({
        channel: "bereal",
        text: `🦛 it's time to BeSiege! 🦛\n\ntoday's prompt is: *${prompt}*`,
        post_at: Math.floor(nextTime.getTime() / 1000),
        parse: "full"
      });
    }

    // go to the next week
    startDate = addDays(startDate, 7);
  }
}

async function initialScheduling() {
  // set start date to be next day 8am
  let startDate = addDays(new Date(), 1);
  startDate.setHours(12, 0, 0);

  schedulePrompts(startDate);
}

// command, get the next scheduled bereal times
app.command("/schedule", async ({ command, say, ack }) => {
  try {
    const scheduled =
      (await app.client.chat.scheduledMessages.list()).scheduled_messages ?? [];

    const schedule = scheduled
      .sort((a, b) => a.post_at - b.post_at)
      .map((message) => {
        const timeString = new Date(message.post_at * 1000).toLocaleString(
          "en-US",
          { timeZone: "America/New_York" }
        );
        return `"${message.text.replace(/[\r\n]+/gm, " ")}" at ${timeString} (id: ${message.id})`;
      });

    const message =
      "next scheduled times:\n" +
      schedule.reduce((prev, next) => prev + "\n" + next, "");

    await say(message);
    await ack();
  } catch (error) {
    console.error(error);
    await say(`schedule failed with error ${error}`);
    await ack();
  }
});

// command, clear the prompt schedule
app.command("/clear-schedule", async ({ command, say, ack }) => {
  try {
    const scheduled =
      (await app.client.chat.scheduledMessages.list()).scheduled_messages ?? [];

    for (const message of scheduled) {
      app.client.chat.deleteScheduledMessage({
        channel: message.channel_id,
        scheduled_message_id: message.id,
      });
    }

    await say("cleared bereal schedule");
    await ack();
  } catch (error) {
    console.error(error);
    await say(`clear failed with error ${error}`);
    await ack();
  }
});

// command, initialize the prompt schedule
app.command("/initialize", async ({ command, say, ack }) => {
  try {
    initialScheduling();
    await say("running initial scheduling...");
    await ack();
  } catch (error) {
    console.error(error);
    await say(`initialize failed with error ${error}`);
    await ack();
  }
});

// command, delete prompt(s) given a list of prompt ids
app.command("/delete", async ({ command, say, ack }) => {
  try {
    const messageIds = command.text.split(",").map((id) => id.trimStart());

    const scheduled =
      (await app.client.chat.scheduledMessages.list()).scheduled_messages ?? [];

    // if there is anything in scheduled
    let responseString;
    if (scheduled && messageIds.length > 0) {
      const channel_id = scheduled[0].channel_id;
      responseString = "deleted:\n";
      console.log("messageids", messageIds);
      const responses = await Promise.all(
        messageIds.map((messageId) =>
          app.client.chat.deleteScheduledMessage({
            channel: channel_id,
            scheduled_message_id: messageId,
          })
        )
      );

      responseString =
        "deleted:\n" +
        responses
          .map((val, i) =>
            val["ok"]
              ? `successfully deleted ${messageIds[i]}`
              : `failed to delete ${messageIds[i]}`
          )
          .join("\n");
    } else {
      responseString =
        "failed to delete, no messages scheduled right now or no message IDs provided.";
    }

    await say(responseString);
    await ack();
  } catch (error) {
    console.error(error);
    await say(
      `delete failed — check to make sure that your message ID is correct!`
    );
    await ack();
  }
});

// command, add a prompt to the schedule
app.command("/add", async ({ command, say, ack }) => {
  try {
    const prompts = command.text.split(",").map((prompt) => prompt.trimStart());

    const scheduled =
      (await app.client.chat.scheduledMessages.list()).scheduled_messages ?? [];
    const lastScheduled = scheduled.sort((a, b) => a.post_at - b.post_at).pop();

    const startDate = addDays(
      lastScheduled === undefined
        ? new Date()
        : new Date(lastScheduled.post_at * 1000),
      1
    ); // default to current date
    startDate.setHours(12, 0, 0);

    schedulePrompts(startDate, prompts);

    await say(`inserting prompts:\n${prompts.join("\n")}`);
    await ack();
  } catch (error) {
    console.error(error);
    await say(`add failed with error ${error}`);
    await ack();
  }
});

// command, add a prompt to the schedule
// takes input in the format "prompt", "yyyy-mm-dd"
app.command("/add-on-day", async ({ command, say, ack }) => {
  try {
    const inputs = command.text.split(",").map((val) => val.trimStart());

    let responseString;

    if (inputs.length !== 2) {
      responseString = "command must be of the form '<prompt>, yyyy-mm-dd'";
    } else {
      const regex = /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/;
      const match = inputs[1].match(regex);

      if (!match) {
        responseString = "command must be of the form '<prompt>, yyyy-mm-dd'";
      } else {
        const { year, month, day } = match.groups;

        // pick a random time on the given date to schedule the message
        const schedDate = new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          12 + Math.random() * 4,
          Math.floor(Math.random() * 60),
          0
        );

        await app.client.chat.scheduleMessage({
          channel: "bereal",
          text: `🦛 it's time to BeSiege! 🦛\n\ntoday's prompt is: *${inputs[0]}*`,
          post_at: Math.floor(schedDate.getTime() / 1000),
          parse: 'full'
        });

        responseString = `inserted prompt ${
          inputs[0]
        } at ${schedDate.toLocaleString("en-US", {
          timeZone: "America/New_York",
        })}`;
      }
    }
    await say(responseString);
    await ack();
  } catch (error) {
    console.error(error);
    await say(`add failed with error ${error}`);
    await ack();
  }
});

(async () => {
  // Start the app
  console.log("we are running");
  await app.start(process.env.PORT || 3000);

  console.log("⚡️ Bolt app is running!");
})();
