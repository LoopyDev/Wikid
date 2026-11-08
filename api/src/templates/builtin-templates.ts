// The templates every workspace starts with. Written as Markdown (with Wikid's sections for
// columns and toggles, and "[Image to add: …]" for an image placeholder), read with the same
// converter as the Markdown API. They can't be edited; "Copy to my templates" makes one that can.

export type BuiltinTemplate = { id: string; title: string; icon: string; description: string; markdown: string };

export const BUILTIN_PREFIX = 'builtin:';

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: `${BUILTIN_PREFIX}meeting-notes`,
    title: 'Meeting notes',
    icon: '🗓️',
    description: 'Agenda, notes, decisions and actions',
    markdown: `> 🗓️ Date, time, and who's there.

## Agenda
1. First topic
2. Second topic

## Notes
What was discussed, under each topic.

## Decisions
- What was agreed

## Actions
- [ ] Who does what, by when`,
  },
  {
    id: `${BUILTIN_PREFIX}project-brief`,
    title: 'Project brief',
    icon: '🎯',
    description: 'Goals, scope, timeline and risks',
    markdown: `> 🎯 In a sentence: what this project is, and why it matters.

## Goals
- What success looks like

## Scope
::: columns
### In scope
- What's included

::: column
### Out of scope
- What isn't
:::

## Timeline
| Milestone | Date | Owner |
| --- | --- | --- |
| Kick-off | | |
| First release | | |

## Risks
- What could go wrong, and what we'd do about it

[Image to add: A sketch or mock-up of what's being built]`,
  },
  {
    id: `${BUILTIN_PREFIX}how-to-guide`,
    title: 'How-to guide',
    icon: '🧭',
    description: 'Steps to get something done, with troubleshooting',
    markdown: `> 💡 What this guide helps you do, and who it's for.

## Before you start
- [ ] What you need first

## Steps
1. First step
2. Second step
3. Third step

[Image to add: A screenshot of the finished result]

## Troubleshooting
::: toggle
### It didn't work
What to check, and what to try next.
:::`,
  },
  {
    id: `${BUILTIN_PREFIX}decision-record`,
    title: 'Decision record',
    icon: '📌',
    description: 'A decision, the options, and why',
    markdown: `> 📌 Status: proposed. Date: . Decided by: .

## Context
What's the situation, and why does it need a decision?

## Options
| Option | For | Against |
| --- | --- | --- |
| Option A | | |
| Option B | | |

## Decision
What was chosen, and why.

## Consequences
- What changes as a result`,
  },
];

export const findBuiltinTemplate = (id: string) => BUILTIN_TEMPLATES.find((template) => template.id === id) ?? null;
