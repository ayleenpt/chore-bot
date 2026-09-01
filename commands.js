import 'dotenv/config';
import { ClearGlobalCommands, InstallGuildCommands } from './utils.js';

const COMMANDS = [
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
]

await ClearGlobalCommands(process.env.APP_ID);

InstallGuildCommands(process.env.APP_ID, process.env.GUILD_ID, COMMANDS);
