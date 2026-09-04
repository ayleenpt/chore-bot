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
  return `## 🧹 Chore Chart - ${weekLabel}\n${lines.join('\n')}`;
}

function getRotationMembers(guildId) {
  const configured = parseIdList(
    process.env.CHORE_ROTATING_USER_IDS || ''
  );

  return configured.map((id) => ({
    id,
    username: '',
  }));
}

const DISHES_SCHEDULE = [
  { day: 'Monday', userId: '482048258630221824' },
  { day: 'Tuesday', userId: '451798259057557529' },
  { day: 'Wednesday', userId: '885797282241470484' },
  { day: 'Thursday', userId: '797002059744018453' },
  { day: 'Friday', userId: '210306607987425280' },
];

function buildDishesSchedule() {
  const lines = DISHES_SCHEDULE.map(({ day, userId }) => {
    return `- ${day}: <@${userId}>`;
  });

  return `## 🍽️ Dishes Schedule\n${lines.join('\n')}`;
}

function buildChoreChartContent(assignmentsWithIds, weekLabel) {
  const dishesScheduleText = buildDishesSchedule();

  return `${buildAssignmentMessageWithMentions(assignmentsWithIds, weekLabel)} 
    \n${dishesScheduleText}`;
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

  const body = {
    content,
  };

  // This is used by the Sunday automatic announcement.
  await DiscordRequest(`channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    body,
  });
}

async function sendGarbageReminder() {
  const parts = getPacificDateParts();

  const pacificToday = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  );

  const weekStartDate = getMonday(pacificToday);

  const members = getRotationMembers(GUILD_ID);

  const assignmentsWithIds = buildAssignmentsWithIds(
    members,
    CHORE_LIST,
    weekStartDate
  );

  const garbageAssignment = assignmentsWithIds.find(
    ({ chore }) => chore.toLowerCase() === 'garbage'
  );

  if (!garbageAssignment || !garbageAssignment.assigneeId) {
    console.log('Garbage reminder: No garbage assignee found.');
    return;
  }

  const content =
    `<@${garbageAssignment.assigneeId}> ` +
    `🗑️ **Garbage reminder!** Please take the trash to the curb ` +
    `**before tomorrow morning at 8:00 AM**.`;

  await DiscordRequest(`channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    body: {
      content,
    },
  });

  console.log(
    `Sent garbage reminder to ${garbageAssignment.assigneeId}`
  );
}

async function announceNextWeek() {
  const parts = getPacificDateParts();

  const pacificToday = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  );

  const nextWeekStart = addDays(getMonday(pacificToday), 7);

  await sendChoreChart(GUILD_ID, nextWeekStart, 'Next week');
}


function getPacificDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);

  return Object.fromEntries(
    parts
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value])
  );
}

function getPacificWeekKey(date = new Date()) {
  const parts = getPacificDateParts(date);

  // Create a date using the Pacific calendar date.
  const localDate = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  );

  return getWeekKey(localDate);
}

function shouldRunWeeklyAnnouncement() {
  const parts = getPacificDateParts();

  const isSunday = parts.weekday === 'Sun';
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  // Run any time from 9:00 PM onward on Sunday.
  return isSunday && (hour > SUNDAY_HOUR ||
    (hour === SUNDAY_HOUR && minute >= SUNDAY_MINUTE));
}

function scheduleSundayAnnouncements() {
  setInterval(async () => {
    if (!process.env.GUILD_ID) return;
    if (!CHANNEL_ID) return;

    if (!shouldRunWeeklyAnnouncement()) {
      return;
    }

    // Use the Pacific calendar date when determining which week's
    // announcement has already been posted.
    const now = new Date();
    const weekKey = getPacificWeekKey(
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    );

    if (state.lastAnnouncementKey === weekKey) {
      return;
    }

    try {
      await announceNextWeek();

      state.lastAnnouncementKey = weekKey;

      console.log(
        `Posted next week's chore chart for ${weekKey}`
      );
    } catch (error) {
      console.error(
        'Could not send the scheduled chore chart',
        error
      );
    }
  }, 60_000);
}

function scheduleThursdayGarbageReminder() {
  setInterval(async () => {
    const parts = getPacificDateParts();

    const isThursday = parts.weekday === 'Thu';
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);

    if (!process.env.GUILD_ID) return;
    if (!CHANNEL_ID) return;

    // Thursday at 8:00 PM or later
    const isReminderTime =
      isThursday && (hour > 20 || (hour === 20 && minute >= 0));

    if (!isReminderTime) {
      return;
    }

    // Use the current week's Monday as the unique key.
    const pacificToday = new Date(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day)
    );

    const weekKey = getWeekKey(pacificToday);

    // Don't send the reminder more than once during the same week.
    if (state.lastGarbageReminderKey === weekKey) {
      return;
    }

    try {
      await sendGarbageReminder();

      state.lastGarbageReminderKey = weekKey;

      console.log(
        `Posted garbage reminder for ${weekKey}`
      );
    } catch (error) {
      console.error(
        'Could not send the garbage reminder',
        error
      );
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
  console.log('Received /chorechart command');

  const weekStartDate = getMonday(new Date());
  const members = getRotationMembers(guild_id);

  const assignmentsWithIds = buildAssignmentsWithIds(
    members,
    CHORE_LIST,
    weekStartDate
  );

  const weekLabel = getWeekRangeLabel(weekStartDate);

  const content = buildChoreChartContent(
    assignmentsWithIds,
    weekLabel
  );

  console.log('/chorechart content:', content);

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

scheduleSundayAnnouncements();
scheduleThursdayGarbageReminder();

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
  if (!process.env.GUILD_ID || !process.env.CHORE_CHANNEL_ID) {
    console.log('Chore channel automation is off until GUILD_ID and CHORE_CHANNEL_ID are set in .env.');
  }
});
