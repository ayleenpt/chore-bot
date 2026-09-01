# Chore Bot for Discord

This app turns a basic Discord starter bot into a weekly chore rotation bot. It rotates chores across members in the server, posts a chore chart on demand, and sends a Sunday night reminder for the upcoming Monday-Sunday cycle.

## Features

- `/chorechart` posts the current week's chores to the active channel
- Weekly assignments rotate based on a deterministic schedule for each week
- Sunday night automation posts next week's chore chart to a configured channel
- Chore names and announcement timing are configurable through environment variables

## Required environment variables

Create a `.env` file in the project root with values like:

```env
APP_ID=your_discord_application_id
PUBLIC_KEY=your_discord_public_key
DISCORD_TOKEN=your_bot_token
GUILD_ID=your_discord_server_id
CHORE_CHANNEL_ID=the_channel_where_weekly_updates_should_post
CHORES=Dishes, Trash, Vacuum, Bathroom, Kitchen, Laundry
CHORE_ANNOUNCEMENT_HOUR=21
CHORE_ANNOUNCEMENT_MINUTE=0
PORT=3000
```

Notes:
- `GUILD_ID` is used to fetch the roster for the weekly rotation.
- `CHORE_CHANNEL_ID` is used for automated Sunday night posts.
- The default announcement time is Sunday at 9:00 PM in the server's local time.

## Install dependencies

```bash
npm install
```

## Register slash commands

```bash
npm run register
```

## Start the app

```bash
npm start
```

For local development, you can also use:

```bash
npm run dev
```

## Slash command usage

- `/chorechart` - posts the current week's chore assignments to the channel where it was used.

## How the weekly rotation works

- The bot fetches the members in the target Discord server and filters out bots.
- It rotates through the roster in a deterministic order based on the week start date.
- Each chore is assigned to a different member in the cycle, with repeats when the list is longer than the member roster.
- On Sunday night, the bot posts the next week's chart so the household knows what is scheduled for Monday through Sunday.

## Deployment notes

Because Discord interactions require a public HTTPS endpoint, you will typically run this behind a tunnel such as ngrok when developing locally:

```bash
ngrok http 3000
```

Then set the Interactions Endpoint URL in your Discord app to your forwarded URL plus `/interactions`.
