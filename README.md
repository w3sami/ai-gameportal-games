# ai-gameportal-games

Games published on the [AI game portal](https://games.bigbools.fi).

This repository is a **mirror**, not the publishing channel. Games are uploaded
through the portal's MCP server and served from `game.bigbools.fi`; a job on the
portal's host pushes the resulting files here so there is an off-site copy and a
history of how each game changed.

## Layout

```
games.json                       metadata for every game
games/<owner>/<game-id>/...      the files a game is built from
```

`<game-id>` is the id the portal assigns; the human-readable name is the `slug`
in `games.json`. Each game folder is self-contained — entry file plus whatever
it imports — so a game can be run by serving its folder.

## What is deliberately absent

The portal's user records are not mirrored here. They hold email addresses,
Google account identifiers and publish tokens, and a publish token is a live
credential: anyone holding it could publish as that user. Secrets survive in git
history even after deletion, so they are excluded at the source rather than
removed later.

## Licence

Game code on the portal is open source so that others can build on it. The exact
terms live in the portal's own terms of use; this file will name the licence
once that text is published.
