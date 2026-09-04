import 'dotenv/config';
import { DiscordRequest } from './utils.js';
import { buildAssignmentsWithIds, buildChoreChartContent, loadAssignments, saveAssignments } from './build-chore-chart-utils.js';
import { getMonday, addDays, getWeekKey, getWeekRangeLabel } from './date-utils.js';

const SUNDAY = 'Fri';
const THURSDAY = 'Fri';
const REMINDER_HOUR = 16;
const REMINDER_MINUTE = 0;
const RECYCLING_ANCHOR = '2026-09-04';
const CHANNEL_ID = process.env.CHORE_CHANNEL_ID || null;
const GUILD_ID = process.env.GUILD_ID || null;
const state = {
  lastAnnouncementKey: null,
  lastGarbageReminderKey: null,
  currentAssignments: null,
};

function parseIdList(rawIds) {
  return rawIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function getRotationMembers() {
  const configured = parseIdList(
    process.env.CHORE_ROTATING_USER_IDS || ''
  );

  return configured.map((id) => ({
    id,
    username: '',
  }));
}

async function sendChoreChart(weekStartDate, assignmentsWithIds) {
  const weekLabel = getWeekRangeLabel(weekStartDate);
  const content = buildChoreChartContent(
    assignmentsWithIds,
    weekLabel
  );

  await DiscordRequest(`channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    body: {
      content,
    },
  });
}

function canSendChoreMessages() {
  return Boolean(GUILD_ID && CHANNEL_ID);
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

function shouldRunScheduledTask(scheduledDay = String) {
  const parts = getPacificDateParts();

  const isScheduledDay = parts.weekday === scheduledDay;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  return isScheduledDay && (hour > REMINDER_HOUR ||
    (hour === REMINDER_HOUR && minute >= REMINDER_MINUTE));
}

function getPacificToday() {
  const parts = getPacificDateParts();

  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  );
}

function isRecyclingWeek(date = new Date()) {
  const anchor = new Date(`${RECYCLING_ANCHOR}T00:00:00`);
  const target = new Date(date);

  // Get the Friday of the target week
  const day = target.getDay(); // Sunday = 0, Friday = 5
  const daysSinceFriday = (day - 5 + 7) % 7;

  target.setDate(target.getDate() - daysSinceFriday);
  target.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (target - anchor) / (1000 * 60 * 60 * 24)
  );

  const weeksSinceAnchor = Math.round(diffDays / 7);

  return weeksSinceAnchor % 2 === 0;
}

async function announceNextWeek() {
  const pacificToday = getPacificToday();
  const nextWeekStart = addDays(getMonday(pacificToday), 7);

  const members = getRotationMembers();

  const assignmentsWithIds = buildAssignmentsWithIds(members, nextWeekStart);

  saveAssignments(nextWeekStart, assignmentsWithIds);

  await sendChoreChart(nextWeekStart, assignmentsWithIds);
}

async function sendGarbageReminder() {
  const savedData = loadAssignments();

  if (!savedData || !savedData.assignments) {
    console.log('Garbage reminder: No saved assignments found.');
    return;
  }

  const garbageAssignment = savedData.assignments.find(
    ({ chore }) => chore.toLowerCase() === 'garbage'
  );

  if (!garbageAssignment || !garbageAssignment.assigneeId) {
    console.log('Garbage reminder: No garbage assignee found.');
    return;
  }

  var content =
    `### 🗑️ Garbage reminder!` +
    `\n<@${garbageAssignment.assigneeId}> ` +
    `please take the trash to the curb **before tomorrow morning at 8:00 AM**.`;

  if (isRecyclingWeek()) {
    content += '\n♻️ **This is a recycling week**, ' + 
      'so please also take the recycling to the curb.';
  }

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

function scheduleAnnouncement({
  day,
  getKey,
  stateKey,
  task,
}) {
  setInterval(async () => {
    const key = getKey();
    
    if (!canSendChoreMessages() ||
        !shouldRunScheduledTask(day) ||
        state[stateKey] === key) {
      return;
    }

    try {
      await task();

      state[stateKey] = key;

      console.log(`Scheduled task completed for ${key}`);
    } catch (error) {
      console.error('Scheduled task failed', error);
    }
  }, 60_000);
}

export function scheduleSundayChoreAnnouncement() {
  scheduleAnnouncement({
    day: SUNDAY,

    getKey: () => {
      const now = new Date();

      return getPacificWeekKey(
        new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      );
    },

    stateKey: 'lastAnnouncementKey',
    task: announceNextWeek,
  });
}

export function scheduleThursdayGarbageAnnouncement() {
   scheduleAnnouncement({
    day: THURSDAY,
    getKey: () => getWeekKey(getPacificToday()),
    stateKey: 'lastGarbageReminderKey',
    task: sendGarbageReminder,
  });
}
