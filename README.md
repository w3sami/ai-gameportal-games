# ai-gameportal-games

Every file uploaded to the [AI game portal](https://games.bigbools.fi) —
finished or not.

This repository is a **mirror**, not the publishing channel. Games are uploaded
through the portal's MCP server and served from `game.bigbools.fi`; a job on the
portal's host pushes the files here within seconds so there is an off-site copy
and a history of how each game changed.

Nothing is held back until a game is published. The portal's terms draw the line
at uploading rather than publishing, so a game that is still being built is
already here. That is deliberate: with nothing filtered, nothing can leak by
accident. Publishing a game on the portal only decides whether it is listed and
playable there.

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

Every game here is MIT licensed by **its own author**, not by the portal — the
single `LICENSE` file carries the terms, and `games.json` records who wrote
which game. The portal's terms of use are what grant the licence, and they do so
on upload. Authors keep
the copyright to their work: publishing on the portal grants this licence to
everyone else, but does not limit what the author may do with the same code
elsewhere, including selling a closed commercial version of it.

An MIT grant cannot be withdrawn, so a version once published here stays
forkable even if its author later moves development elsewhere.
