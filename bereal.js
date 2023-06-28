const { WebClient } = require("@slack/web-api");

const webClient = new WebClient(process.env.SLACK_BOT_TOKEN);

async function scheduleBeReal(beRealChannelId) {
  // get new date
  const nextMessage = new Date();
  nextMessage.setDate(nextMessage.getDate() + 1); // for the next day
  const randomHour = Math.floor(Math.random() * 12) + 9; // 9am to 9pm
  const randomMinute = Math.floor(Math.random() * 60);
  const randomSecond = Math.floor(Math.random() * 60);
  nextMessage.setHours(randomHour, randomMinute, randomSecond);

  try {
    // Call the chat.scheduleMessage method using the WebClient
    const result = await webClient.chat.scheduleMessage({
      channel: beRealChannelId,
      text: "Looking towards the future",
      post_at: nextMessage.getTime() / 1000,
    });

    console.log(result);
  } catch (error) {
    console.error(error);
  }
}

module.exports = { scheduleBeReal };
