const { App , AwsLambdaReceiver } = require('@slack/bolt');
const dotenv = require('dotenv');
dotenv.config();
const fs = require('fs');

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
}

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

async function initialScheduling() {
  // read prompts from the prompt_config.json file
  const { oneTimePrompts, repeatedPrompts, timesPerWeek, probabilityRepeat } =
    await readJSON("prompt_config.json");
  console.log(oneTimePrompts);
  
  // initial date: tomorrow at 8am
  let startDate = addDays(new Date(), 1);
  startDate.setHours(12, 0, 0); // 12pm utc = 8am est

  while (oneTimePrompts.length > 0) {
    // generate timesPerWeek days in the next week
    const nextTimes = getWeeklySchedule(startDate, timesPerWeek);

    for (const time of nextTimes) {
      if (oneTimePrompts.length === 0) break;
      
      // get a prompt randomly with probability
      const isOneTime = Math.random() > probabilityRepeat;
      const prompt = isOneTime ? getRandomPrompt(oneTimePrompts, true) : getRandomPrompt(repeatedPrompts, false);

      // get the next time
      const nextTime = addDays(startDate, time); // TODO make this not 8am every day

      // schedule message
      await app.client.chat.scheduleMessage({
        channel: "bereal",
        text: `it's time to BeSiege!\ntoday's prompt: ${prompt}`,
        post_at: Math.floor(nextTime.getTime() / 1000),
      });

      console.log(`scheduled ${prompt} for ${nextTime.toString()}`);
    }

    // go to the next week
    startDate = addDays(startDate, 7);
  }
}

// command, get the next scheduled bereal times
app.command("/schedule", async ({ command, say, ack }) => {
  try {
    const scheduled =
      (await app.client.chat.scheduledMessages.list()).scheduled_messages ?? [];

    const schedule = scheduled
      .sort((a, b) => a.post_at - b.post_at)
      .map((message) => new Date(message.post_at * 1000).toString());

    const message =
      "next scheduled times:\n" +
      schedule.reduce((prev, next) => prev + "\n" + next, "");

    await say(message);
    await ack();
  } catch (error) {
    console.error(error);
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
  }
});

app.message("hi", () => {
  initialScheduling();
  app.client.chat.postMessage({
    channel: "bereal",
    text: "running initial scheduling...",
  });
});

(async () => {
  // Start the app
  console.log("we are running");
  await app.start(process.env.PORT || 3000);

  console.log("⚡️ Bolt app is running!");
})();
