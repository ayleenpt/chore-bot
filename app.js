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

app.use(express.json({
  verify: (req, res, buffer) => {
    req.rawBody = buffer;
  },
}));

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
  // members: array of { id, name }
  if (!members || !members.length) {
    return chores.map((chore) => ({ chore, assigneeId: null, assigneeName: 'No members found' }));
  }

  const rotation = getDeterministicShuffle(members, weekStart.getTime());

  return chores.map((chore, index) => {
    const member = rotation[index % rotation.length];
    return {
      chore,
      assigneeId: member.id || null,
      assigneeName: member.name || member.username || 'Unknown',
    };
  });
}

function buildAssignmentMessageWithMentions(assignments, weekLabel, leadInText = 'This week') {
  const lines = assignments.map(({ chore, assigneeId, assigneeName }) => {
    if (assigneeId) {
      return `- ${chore}: <@${assigneeId}> (${assigneeName})`;
    }
    return `- ${chore}: ${assigneeName}`;
  });
  return `**${leadInText} chore chart (${weekLabel})**\n${lines.join('\n')}`;
}

function getMemberDisplayName(member) {
  if (!member) return 'Unknown member';
  return member.nick || member.user?.global_name || member.user?.username || 'Unknown member';
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

const DISHES_SCHEDULE = [
  '### Dishes Schedule',
  '- **Monday**: Ayleen',
  '- **Tuesday**: Seth',
  '- **Wednesday**: Ashley',
  '- **Thursday**: Arielle',
  '- **Friday**: Jayson',
]

async function getChannelByName(guildId, name) {
  if (!guildId) return null;

  try {
    const res = await DiscordRequest(`guilds/${guildId}/channels`, { method: 'GET' });
    const channels = await res.json();
    if (!Array.isArray(channels)) return null;

    const match = channels.find((c) => c && c.name && c.name.toLowerCase() === name.toLowerCase());
    return match ? match.id : null;
  } catch (err) {
    console.error('Failed to resolve channel by name', err);
    return null;
  }
}

async function resolveChoreChannel(guildId) {
  if (process.env.CHORE_CHANNEL_ID) return process.env.CHORE_CHANNEL_ID;
  const name = 'test-chores';
  return await getChannelByName(guildId, name);
}

function buildAssignmentMessage(assignments, weekLabel, leadInText = 'This week') {
  const lines = assignments.map(({ chore, assignee }) => `- ${chore}: ${assignee}`);
  const intro = `**${leadInText} chore chart (${weekLabel})**\n${lines.join('\n')}`;
  return intro;
}

async function sendChoreChart(channelId, guildId, weekStartDate, label) {
  // Prefer explicit joiners if present, otherwise fall back to guild members
  const joiners = getGuildJoiners(guildId);
  let memberObjs = [];
  if (joiners && joiners.length) {
    memberObjs = joiners.map((u) => ({ id: u.id, name: u.username || u.name || u.id }));
  } else {
    const members = await getGuildMembers(guildId);
    memberObjs = members.length ? members.map((member) => ({ id: member.id, name: getMemberDisplayName(member) })) : [];
  }

  const assignmentsWithIds = buildAssignmentsWithIds(memberObjs, CHORE_LIST, weekStartDate);
  const weekLabel = getWeekRangeLabel(weekStartDate);

  // Build dishes schedule (this section does not ping users)
  const dishesScheduleText = DISHES_SCHEDULE.join('\n');

  const content = `${buildAssignmentMessageWithMentions(assignmentsWithIds, weekLabel, label)}\n\n${dishesScheduleText}`;

  const mentionUserIds = assignmentsWithIds.map((a) => a.assigneeId).filter(Boolean);
  const body = { content, allowed_mentions: mentionUserIds.length ? { users: mentionUserIds } : { parse: [] } };

  await DiscordRequest(`channels/${channelId}/messages`, { method: 'POST', body });
}

async function announceNextWeek(guildId, channelId) {
  const nextWeekStart = addDays(getMonday(new Date()), 7);
  await sendChoreChart(channelId, guildId, nextWeekStart, 'Next week');
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

    const channelId = await resolveChoreChannel(process.env.GUILD_ID);
    if (!channelId) return;

    if (!shouldRunWeeklyAnnouncement()) {
      return;
    }

    const weekKey = getWeekKey(addDays(getMonday(new Date()), 7));
    if (state.lastAnnouncementKey === weekKey) {
      return;
    }

    try {
      await announceNextWeek(process.env.GUILD_ID, channelId);
      state.lastAnnouncementKey = weekKey;
      console.log(`Posted next week's chore chart for ${weekKey}`);
    } catch (error) {
      console.error('Could not send the scheduled chore chart', error);
    }
  }, 60_000);
}

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  const { type, data, guild_id, channel_id } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === 'chorechart') {
      const targetGuildId = guild_id || process.env.GUILD_ID;
      let targetChannelId = channel_id || process.env.CHORE_CHANNEL_ID;
      if (!targetChannelId) {
        targetChannelId = await resolveChoreChannel(targetGuildId);
      }

      if (!targetChannelId) {
        return res.status(400).json({ error: 'No channel configured for chore announcements. Set CHORE_CHANNEL_ID or create a channel named "chores".' });
      }

      const thisWeekStart = getMonday(new Date());
      await sendChoreChart(targetChannelId, targetGuildId, thisWeekStart, 'This week');

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'The chore chart has been posted to the channel.',
        },
      });
    }
    if (name === 'join') {
      const targetGuildId = guild_id || process.env.GUILD_ID;
      if (!targetGuildId) {
        return res.status(400).json({ error: 'No guild configured.' });
      }

      const user = req.body.member?.user || req.body.user;
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
