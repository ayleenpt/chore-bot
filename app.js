import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseType,
  InteractionResponseFlags,
  InteractionType,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { CHORE_INSTRUCTIONS } from './chore-instructions.js';
import { getWeekRangeLabel } from './date-utils.js';
import { buildChoreChartContent, loadAssignments } from './build-chore-chart-utils.js';
import { scheduleSundayChoreAnnouncement, scheduleThursdayGarbageAnnouncement } from './automated-reminders-utils.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.post('/interactions', express.raw({ type: 'application/json' }), verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  let json;
  try {
    if (Buffer.isBuffer(req.body)) {
      json = JSON.parse(req.body.toString());
    } else if (typeof req.body === 'string') {
      json = JSON.parse(req.body);
    } else {
      // already-parsed object (some middleware populated it)
      json = req.body;
    }
  } catch (err) {
    console.error('Invalid interaction JSON', err);
    return res.status(400).json({ error: 'invalid json' });
  }

  const { type, data, guild_id } = json;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === 'chorechart') {
      console.log('Received /chorechart command');

      const savedData = loadAssignments();

      if (!savedData || !savedData.assignments) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'No chore chart has been generated yet.',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const weekStartDate = new Date(savedData.weekStart);
      const weekLabel = getWeekRangeLabel(weekStartDate);

      const content = buildChoreChartContent(
        savedData.assignments,
        weekLabel
      );

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content,
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
    }

    if (name === 'help') {
      const helpText = `
        ## Chore Bot Help
        - The chore bot will post a new chore chart every Sunday at 9pm.
        - Use the /chorechart command to get a reminder of this week's chore chart.
        - Use the /dishes, /kitchen, /guest-bathroom, /living-room, /floors, and /garbage commands to get instructions for each chore.
        `;
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { 
          content: helpText,
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
    }

    if (CHORE_INSTRUCTIONS[name]) {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: buildChoreInstructions(name),
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

scheduleSundayChoreAnnouncement();
scheduleThursdayGarbageAnnouncement();

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
  if (!process.env.GUILD_ID || !process.env.CHORE_CHANNEL_ID) {
    console.log('Chore channel automation is off until GUILD_ID and CHORE_CHANNEL_ID are set in .env.');
  }
});
