import 'dotenv/config';
import { InstallGuildCommands } from './utils.js';

const COMMANDS = [
  {
    name: 'help',
    description: 'Show instructions',
    type: 1,
  },
  {
    name: 'chorechart',
    description: 'Post this week\'s chore chart',
    type: 1,
  },
  {
    name: 'kitchen',
    description: 'Show the kitchen chore instructions',
    type: 1,
  },
  {
    name: 'guest-bathroom',
    description: 'Show the guest bathroom chore instructions',
    type: 1,
  },
  {
    name: 'living-room',
    description: 'Show the living room chore instructions',
    type: 1,
  },
  {
    name: 'floors',
    description: 'Show the floor chore instructions',
    type: 1,
  },
  {
    name: 'garbage',
    description: 'Show the garbage chore instructions',
    type: 1,
  },
  {
    name: 'dishes',
    description: 'Show the dishes chore instructions',
    type: 1,
  }
];

InstallGuildCommands(process.env.APP_ID, process.env.GUILD_ID, COMMANDS);
