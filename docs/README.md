# Wikid docs

How Wikid works, for people running it or contributing to it. Setup steps are in the [main README](../README.md).

## Architecture

- [Overview](architecture/overview.md): the services, databases and storage, and how they connect
- [Tech stack](architecture/tech-stack.md)
- [Collab persistence](architecture/collab-persistence.md): how Yjs state is stored in Postgres and written back to pages
- [Collab document](architecture/collab-document.md): what's inside a page's Yjs document
- [Database collab structure](architecture/database-collab-structure.md): how database pages are represented in Yjs
- [Block IDs](architecture/block-ids.md): stable per-document block IDs

## Features

- [Block types](features/block-types.md): editor blocks and their menu options
- [Synced blocks](features/synced-blocks.md)
- [Save state](features/save-state.md): the save indicator during collaborative editing
- [Document URLs](features/document-urls.md)
- [Workspaces](features/workspaces.md): ownership rules
- [AI markdown](features/ai-markdown.md): formatting round-trips for AI edits
- [AI block summary cache](features/ai-block-summary-cache.md): reducing token use on large pages

## Compliance

- [Setup](compliance/setup.md): bringing up the compliance database, including the optional immutability guards
- [Design](compliance/design.md): records, revisions, workflows and audit rules
- [Collab decisions](compliance/collab-decisions.md): where live collaboration fits with compliant records
- [Architecture diagram](compliance/architecture.png) ([source](compliance/architecture.mmd))

## Guides

- [Maintenance template](guides/maintenance-template.md): setting up compliant inventory and maintenance databases

## Development

- [Debug commands](dev/debug-commands.md): browser console flags for debugging

See also the [glossary](glossary.md).
