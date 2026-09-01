import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

// Chorechart command
const CHORECHART_COMMAND = {
  name: 'chorechart',
  description: 'Post this week\'s chore chart',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const ALL_COMMANDS = [CHORECHART_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
