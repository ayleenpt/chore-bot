import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseType,
  InteractionResponseFlags,
  InteractionType,
  verifyKeyMiddleware,
} from 'discord-interactions';
import fs from 'fs';
import path from 'path';
import { DiscordRequest } from './utils.js';
import { CHORE_INSTRUCTIONS } from './chore-instructions.js';

const app = express();
const PORT = process.env.PORT || 3000;
const CHORE_LIST = parseChoreList(process.env.CHORES || 'Guest bathroom, Kitchen, Living room, Floors, Garbage');
const SUNDAY_HOUR = Number(process.env.CHORE_ANNOUNCEMENT_HOUR || 21);
const SUNDAY_MINUTE = Number(process.env.CHORE_ANNOUNCEMENT_MINUTE || 0);
const CHANNEL_ID = process.env.CHORE_CHANNEL_ID || null;
const GUILD_ID = process.env.GUILD_ID || null;
const state = { lastAnnouncementKey: null };
const DATA_FILE = path.resolve(process.cwd(), 'chore-data.json');

function parseChoreList(rawChores) {
  return rawChores
    .split(',')
    .map((chore) => chore.trim())
    .filter(Boolean);
}

function parseIdList(rawIds) {
  return rawIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function getWeekRangeLabel(startDate) {
  const endDate = addDays(startDate, 6);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function getWeekKey(date) {
  return getMonday(date).toISOString().slice(0, 10);
}

function getDeterministicShuffle(members, seed) {
  const items = [...members];
  let stableSeed = Math.abs(seed) % 2147483647;

  for (let i = items.length - 1; i > 0; i -= 1) {
    stableSeed = (stableSeed * 16807) % 2147483647;
    const j = stableSeed % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

function buildChoreInstructions(choreName) {
  const instructions = CHORE_INSTRUCTIONS[choreName];

  if (!instructions) {
    return 'No instructions found for this chore.';
  }

  const title = choreName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const bullets = instructions
    .map(instruction => `- ${instruction}`)
    .join('\n');

  return `## ${title}\n${bullets}`;
}

function buildAssignmentsWithIds(members, chores, weekStart) {
  if (!members || !members.length) {
    return chores.map((chore) => ({ chore, assigneeId: null, assigneeName: 'No members found' }));
  }

  const rotation = getDeterministicShuffle(members, weekStart.getTime());

  return chores.map((chore, index) => {
    const member = rotation[index % rotation.length];
    return {
      chore,
      assigneeId: member.id || null,
    };
  });
}

function buildAssignmentMessageWithMentions(assignments, weekLabel) {
  const lines = assignments.map(({ chore, assigneeId }) => {
    return `- ${chore}: <@${assigneeId}>`;
  });
  return `## Chore Chart - ${weekLabel}\n${lines.join('\n')}`;
}

async function getRotationMembers(guildId) {
  const configured = parseIdList(process.env.CHORE_ROTATING_USER_IDS || '');
  return configured.map((id) => ({ id, username: '' }));
}

const DISHES_SCHEDULE = [
  '## Dishes Schedule',
  '- **Monday**: Ayleen',
  '- **Tuesday**: Seth',
  '- **Wednesday**: Ashley',
  '- **Thursday**: Arielle',
  '- **Friday**: Jayson',
]

async function buildChoreChartResponse(guildId, weekStartDate) {
  const members = await getRotationMembers(guildId);
  const memberObjs = members.length
    ? members.map((member) => ({ id: member.id }))
    : [];

  const assignmentsWithIds = buildAssignmentsWithIds(
    memberObjs,
    CHORE_LIST,
    weekStartDate
  );

  const weekLabel = getWeekRangeLabel(weekStartDate);
  const content = buildChoreChartContent(assignmentsWithIds, weekLabel);

  const mentionUserIds = assignmentsWithIds
    .map((a) => a.assigneeId)
    .filter(Boolean);

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: InteractionResponseFlags.EPHEMERAL,
      allowed_mentions: mentionUserIds.length
        ? { users: mentionUserIds }
        : { parse: [] },
    },
  };
}

function buildChoreChartContent(assignmentsWithIds, weekLabel) {
  const dishesScheduleText = DISHES_SCHEDULE.join('\n');

  return `${buildAssignmentMessageWithMentions(assignmentsWithIds, weekLabel)}
${dishesScheduleText}`;
}

async function sendChoreChart(guildId, weekStartDate, label) {
  const members = await getRotationMembers(guildId);
  const memberObjs = members.length
    ? members.map((member) => ({ id: member.id }))
    : [];

  const assignmentsWithIds = buildAssignmentsWithIds(
    memberObjs,
    CHORE_LIST,
    weekStartDate
  );

  const weekLabel = getWeekRangeLabel(weekStartDate);
  const content = buildChoreChartContent(assignmentsWithIds, weekLabel);

  const mentionUserIds = assignmentsWithIds
    .map((a) => a.assigneeId)
    .filter(Boolean);

  const body = {
    content,
    allowed_mentions: mentionUserIds.length
      ? { users: mentionUserIds }
      : { parse: [] },
  };

  // This is used by the Sunday automatic announcement.
  await DiscordRequest(`channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    body,
  });
}

async function announceNextWeek() {
  const nextWeekStart = addDays(getMonday(new Date()), 7);
  await sendChoreChart(GUILD_ID, nextWeekStart, 'Next week');
}

function shouldRunWeeklyAnnouncement() {
  const now = new Date();
  return (
    now.getDay() === 0 &&
    now.getHours() >= SUNDAY_HOUR &&
    now.getMinutes() >= SUNDAY_MINUTE
  );
}

function scheduleSundayAnnouncements() {
  setInterval(async () => {
    if (!process.env.GUILD_ID) return;

    if (!CHANNEL_ID) return;

    if (!shouldRunWeeklyAnnouncement()) {
      return;
    }

    const weekKey = getWeekKey(addDays(getMonday(new Date()), 7));
    if (state.lastAnnouncementKey === weekKey) {
      return;
    }

    try {
      await announceNextWeek();
      state.lastAnnouncementKey = weekKey;
      console.log(`Posted next week's chore chart for ${weekKey}`);
    } catch (error) {
      console.error('Could not send the scheduled chore chart', error);
    }
  }, 60_000);
}

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
      const targetGuildId = guild_id || GUILD_ID;

      if (!targetGuildId) {
        return res.status(400).json({ error: 'No guild configured.' });
      }

      const thisWeekStart = getMonday(new Date());

      try {
        return res.send(
          await buildChoreChartResponse(
            targetGuildId,
            thisWeekStart,
          )
        );
      } catch (err) {
        console.error('Failed to build chore chart', err);
        return res.status(500).json({
          error: 'failed to build chore chart',
        });
      }
    }

    if (name === 'help') {
      const helpText = `
        ## Chore Bot Help
        - The chore bot will post a new chore chart every Sunday at 9pm.
        - Use the /chorechart command to get a reminder of this week's chore chart.
        - Use the /kitchen, /guest-bathroom, /living-room, /floors, and /garbage commands to get instructions for each chore.
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

scheduleSundayAnnouncements();

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
  if (!process.env.GUILD_ID || !process.env.CHORE_CHANNEL_ID) {
    console.log('Chore channel automation is off until GUILD_ID and CHORE_CHANNEL_ID are set in .env.');
  }
});
