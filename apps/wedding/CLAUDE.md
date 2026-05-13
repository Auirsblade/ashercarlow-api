# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Vue 3 wedding website for a May 31st, 2026 wedding at Mercantile Hall in Burlington, WI. Features guest information, RSVP functionality, and personalized invitations.

## Tech Stack

- **Framework**: Vue 3 (Composition API with `<script setup>`)
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 4 with Vite plugin
- **Routing**: Vue Router 4
- **Package Manager**: npm

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (localhost:5173)
npm run build        # Production build to dist/
npm run preview      # Preview production build
```

No test or lint scripts are configured.

## Architecture

```
src/
├── main.js              # App initialization
├── routes.js            # Vue Router config
├── App.vue              # Root component
├── components/
│   ├── Home.vue         # Main landing page with wedding info
│   ├── Invite.vue       # Personalized guest invitations
│   ├── Countdown.vue    # Wedding countdown timer
│   └── DualSplitTile.vue
└── assets/
    ├── main.css         # Tailwind + custom theme (--color-beige: #F5DEC0)
    └── wedding_guest_list.json  # Guest data (name, plus_one, kids)
```

## Routing

- `/` → Home component (main info page)
- `/invite/:name` → Invite component (looks up guest by URL-decoded name in wedding_guest_list.json)

## Key Patterns

- Path alias: `@` → `./src` (configured in vite.config.js and jsconfig.json)
- Color theme: beige (`#F5DEC0`) and lime-green accents
- Responsive design: mobile-first with `lg:` breakpoint (1024px+)
- Guest personalization: JSON lookup by name for plus-one and kids info
