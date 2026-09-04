import fs from 'fs';
import 'dotenv/config';
import { CHORE_INSTRUCTIONS } from './chore-instructions.js';

const ASSIGNMENTS_FILE = './assignments.json';

export const DISHES_SCHEDULE = [
  { day: 'Monday', userId: '482048258630221824' },
  { day: 'Tuesday', userId: '451798259057557529' },
  { day: 'Wednesday', userId: '885797282241470484' },
  { day: 'Thursday', userId: '797002059744018453' },
  { day: 'Friday', userId: '210306607987425280' },
];

const CHORE_LIST = [
  'Guest bathroom',
  'Kitchen',
  'Living room',
  'Floors',
  'Garbage',
];

function shuffleMembers(members) {
  const items = [...members];

  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

function buildDishesSchedule() {
  const lines = DISHES_SCHEDULE.map(({ day, userId }) => {
    return `- ${day}: <@${userId}>`;
  });

  return `## 🍽️ Dishes Schedule\n${lines.join('\n')}`;
}

function buildAssignmentMessageWithMentions(assignments, weekLabel) {
  const lines = assignments.map(({ chore, assigneeId }) => {
    return `- ${chore}: <@${assigneeId}>`;
  });
  return `## 🧹 Chore Chart - ${weekLabel}\n${lines.join('\n')}`;
}

export function saveAssignments(weekStartDate, assignments) {
  const data = {
    weekStart: weekStartDate.toISOString(),
    assignments,
  };

  fs.writeFileSync(
    ASSIGNMENTS_FILE,
    JSON.stringify(data, null, 2)
  );
}

export function loadAssignments() {
  if (!fs.existsSync(ASSIGNMENTS_FILE)) {
    return null;
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(ASSIGNMENTS_FILE, 'utf8')
    );

    return data;
  } catch (error) {
    console.error('Failed to read assignments.json:', error);
    return null;
  }
}

export function buildAssignmentsWithIds(members) {
  if (!members || !members.length) {
    return CHORE_LIST.map((chore) => ({
      chore,
      assigneeId: null,
      assigneeName: 'No members found',
    }));
  }

  const rotation = shuffleMembers(members);

  return CHORE_LIST.map((chore, index) => {
    const member = rotation[index % rotation.length];

    return {
      chore,
      assigneeId: member.id || null,
    };
  });
}

export function buildChoreChartContent(assignmentsWithIds, weekLabel) {
  const dishesScheduleText = buildDishesSchedule();

  return `${buildAssignmentMessageWithMentions(assignmentsWithIds, weekLabel)} 
    \n${dishesScheduleText}`;
}

export function buildChoreInstructions(choreName) {
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