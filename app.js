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

const app = express();
const PORT = process.env.PORT || 3000;
const CHORE_LIST = parseChoreList(process.env.CHORES || 'Guest bathroom, Kitchen, Living room, Floors, Garbage');
const SUNDAY_HOUR = Number(process.env.CHORE_ANNOUNCEMENT_HOUR || 21);
const SUNDAY_MINUTE = Number(process.env.CHORE_ANNOUNCEMENT_MINUTE || 0);
const CHANNEL_ID = process.env.CHORE_CHANNEL_ID || null;
const GUILD_ID = process.env.GUILD_ID || null;
const state = { lastAnnouncementKey: null };
const DATA_FILE = path.resolve(process.cwd(), 'chore-data.json');

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { guilds: {} };
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '{"guilds":{}}');
  } catch (err) {
    console.error('Failed to load data file', err);
    return { guilds: {} };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save data file', err);
  }
}

function getGuildJoiners(guildId) {
  const d = loadData();
  return (d.guilds && d.guilds[guildId]) || [];
}

function addGuildJoiner(guildId, user) {
  const d = loadData();
  d.guilds = d.guilds || {};
  d.guilds[guildId] = d.guilds[guildId] || [];
  if (d.guilds[guildId].some((u) => u.id === user.id)) return false;
  d.guilds[guildId].push(user);
  saveData(d);
  return true;
}

function parseChoreList(rawChores) {
  return rawChores
    .split(',')
    .map((chore) => chore.trim())
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

function buildAssignments(members, chores, weekStart) {
  if (!members.length) {
    return chores.map((chore) => ({ chore, assignee: 'No members found' }));
  }

  const rotation = getDeterministicShuffle(members, weekStart.getTime());

  return chores.map((chore, index) => ({
    chore,
    assignee: rotation[index % rotation.length],
  }));
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

async function getGuildMembers(guildId) {
  if (!guildId) {
    return [];
  }

  try {
    const response = await DiscordRequest(`guilds/${guildId}/members?limit=100`, { method: 'GET' });
    const members = await response.json();

    return (Array.isArray(members) ? members : [])
      .filter((member) => member?.user && !member.user.bot)
      .map((member) => ({
        id: member.user.id,
        username: member.user.username,
        nick: member.nick,
        global_name: member.user.global_name,
      }));
  } catch (error) {
    console.error('Failed to load guild members for chore rotation', error);
    return [];
  }
}

function parseIdList(rawIds) {
  return rawIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

async function getRotationMembers(guildId) {
  // Priority: explicit env list of user IDs, then persisted joiners, then guild members
  const configured = parseIdList(process.env.CHORE_ROTATING_USER_IDS || '');
  if (configured.length) {
    return configured.map((id) => ({ id, username: '' }));
  }

  const joiners = getGuildJoiners(guildId);
  if (joiners && joiners.length) {
    return joiners.map((u) => ({ id: u.id, username: u.username || '' }));
  }

  // Fallback to guild members via API
  return await getGuildMembers(guildId);
}

const DISHES_SCHEDULE = [
  '## Dishes Schedule',
  '- **Monday**: Ayleen',
  '- **Tuesday**: Seth',
  '- **Wednesday**: Ashley',
  '- **Thursday**: Arielle',
  '- **Friday**: Jayson',
]

async function sendChoreChart(guildId, weekStartDate, label) {
  // Resolve rotation members (env CHORE_ROTATING_USER_IDS -> joiners -> guild members)
  const members = await getRotationMembers(guildId);
  const memberObjs = members.length ? members.map((member) => ({ id: member.id })) : [];

  const assignmentsWithIds = buildAssignmentsWithIds(memberObjs, CHORE_LIST, weekStartDate);
  const weekLabel = getWeekRangeLabel(weekStartDate);

  // Build dishes schedule (this section does not ping users)
  const dishesScheduleText = DISHES_SCHEDULE.join('\n');

  const content = `${buildAssignmentMessageWithMentions(assignmentsWithIds, weekLabel, label)}\n${dishesScheduleText}`;

  const mentionUserIds = assignmentsWithIds.map((a) => a.assigneeId).filter(Boolean);
  const body = { content, allowed_mentions: mentionUserIds.length ? { users: mentionUserIds } : { parse: [] } };

  await DiscordRequest(`channels/${CHANNEL_ID}/messages`, { method: 'POST', body });
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

        if (!CHANNEL_ID) {
          return res.status(400).json({ error: 'No channel configured for chore announcements. Set CHORE_CHANNEL_ID in .env.' });
        }

        const thisWeekStart = getMonday(new Date());
        try {
          await sendChoreChart(targetGuildId, thisWeekStart, 'This week');
        } catch (err) {
          console.error('Failed to post chore chart', err);
          return res.status(500).json({ error: 'failed to post chore chart' });
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'The chore chart has been posted to the channel.' },
        });
    }

    if (name === 'join') {
      const targetGuildId = guild_id || GUILD_ID;
      if (!targetGuildId) {
        return res.status(400).json({ error: 'No guild configured.' });
      }

      const user = json.member?.user || json.user;
      if (!user || !user.id) {
        return res.status(400).json({ error: 'Could not determine user.' });
      }

      const added = addGuildJoiner(targetGuildId, { id: user.id, username: user.username || user.global_name || user.id });

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: added ? 'You have been added to the chore rotation.' : 'You are already in the chore rotation.',
          flags: InteractionResponseFlags.EPHEMERAL || 64,
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
