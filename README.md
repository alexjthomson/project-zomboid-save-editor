# Project Zomboid Save Editor

A browser-based editor for Project Zomboid's `players.db` save file.

Its purpose is not to expose SQLite columns — it is to **decode, safely modify
and re-serialize the binary player BLOB** stored inside the database, so that
broken characters can be repaired and loaded again by the game.

Everything runs client-side. Your save file is never uploaded anywhere.

---

## What it does

* Opens `players.db` in the browser (SQLite compiled to WebAssembly).
* Decodes the serialized `IsoPlayer` BLOB into structured, named fields.
* **Revive Player** — restores a dead character to a clean, playable state.
* **Restore Full Health** — repairs injuries without touching death state.
* Edits health, body parts, infection, stats, position, perks, XP, traits,
  nutrition and identity.
* Shows exactly which semantic fields changed, and a byte-level diff.
* Advanced BLOB view: offsets, sizes, types, values, save-version conditions and
  the decompiled source line that justifies each interpretation.
* Undo at both levels: **Reset player** and **Reset all changes**.
* Exports a modified `players.db` you can drop back into your save folder.

### Round-trip guarantee

An unmodified player BLOB re-serializes **byte-for-byte identically**. This is
enforced by automated tests against a real `players.db`, and it is what makes
partial edits safe: anything the parser does not understand is preserved
verbatim rather than rewritten from guesses.

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Then drag your `players.db` onto the page.

`players.db` lives in your save folder:

| OS | Path |
| --- | --- |
| Windows | `%UserProfile%\Zomboid\Saves\<mode>\<save>\players.db` |
| Linux | `~/Zomboid/Saves/<mode>/<save>/players.db` |
| macOS | `~/Zomboid/Saves/<mode>/<save>/players.db` |

For a dedicated server, it is in the server's `Saves/Multiplayer/<server>/`
folder.

### Using it

1. Open `players.db`.
2. Pick a character from the sidebar. Dead characters are badged.
3. Go to **Health** and press **Revive Player** (or edit fields directly).
4. Review the change list on the right — every modified field is listed with its
   before and after value.
5. Press **Export players.db** and replace the original file.

**Back up your save first.** The editor never writes to your disk on its own,
but you are replacing a save file.

Project Zomboid must not be running when you replace `players.db`, and for a
server the server must be stopped.

---

## How it works

```
players.db  →  sql.js (SQLite/WASM)  →  player row  →  data BLOB
                                                          ↓
                                              parsePlayerBlob(blob, worldVersion)
                                                          ↓
                                                  structured player model
                                                          ↓
                                                  edit / revive / heal
                                                          ↓
                                              serializePlayerBlob(player)
                                                          ↓
                                    UPDATE ... SET data = ?, isDead = ?  →  export
```

The parser mirrors the game's own serialization methods, traced from decompiled
Build 42 source. Each block cites its origin:

```ts
// Mirrors BodyDamage.save(ByteBuffer)
// zombie/characters/BodyDamage/BodyDamage.java:243
```

Full details, including the exact byte layout and the death semantics behind
`Revive Player`, are in **[`docs/players-db-format.md`](docs/players-db-format.md)**.

### Why "revive" is not one boolean

`IsoGameCharacter.isDead()` is `health <= 0 || bodyDamage.getHealth() <= 0`, and
*neither value is stored in the file*. Overall health is recomputed after
loading from the 17 individual body-part health values. Separately, the SQL
`isDead` column forces health to zero immediately after load.

So a correct revive must clear the `isDead` column **and** restore body-part
health **and** clear the infection, cold-damage, bleeding and wound state that
would otherwise kill the character again on the next tick. That full list was
derived from the game's damage code — see §8 of the format document.

---

## Project layout

```
src/
  save/
    BinaryReader.ts        big-endian ByteBuffer-compatible reader
    BinaryWriter.ts        matching writer + field-trace collector
    LuaTable.ts            Kahlua modData codec
    SaveVersion.ts         version gates and support levels
    PlayersDatabase.ts     sql.js layer: open / enumerate / update / export
    PlayerBlobCodec.ts     top-level parse + serialize + trace
    blocks/                SurvivorDesc, HumanVisual, Inventory, Stats,
                           BodyDamage, Xp, Misc
    ops/
      health.ts            revivePlayer / restoreFullHealth
      diff.ts              semantic and byte diffs
  ui/                      the editor interface
tests/                     database, round-trip, revive and trace tests
docs/players-db-format.md  the reverse-engineering record
```

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Type-check and build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the test suite |
| `npm run typecheck` | Type-check only |

---

## Tests

```bash
npm test
```

Covers the full definition of done:

* the sample database opens, and non-SQLite files are rejected
* the schema is described and players are enumerated
* every player BLOB parses with **zero unconsumed bytes**
* every player BLOB **round-trips byte-for-byte**
* decoded values agree with the database's own `name` / `x` / `y` / `z` columns
* the field trace covers every byte contiguously and carries source citations
* a dead character is detected, revived, and every death-causing field cleared
* identity, XP, traits, perks, appearance, position, worn items, mod data and
  **every inventory item byte** survive a revive untouched
* a modified BLOB is written back into SQLite, exported, and re-opened
* `Restore Full Health` is idempotent and leaves survival needs alone

---

## Deploying to GitHub Pages

The repository includes `.github/workflows/deploy.yml`, which builds and
publishes on every push to `main`.

1. Push the repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. The site appears at
   `https://<user>.github.io/<repo>/`.

The Vite `base` defaults to `/project-zomboid-save-editor/`. If your repository
has a different name, either rename it or build with:

```bash
PZ_EDITOR_BASE=/your-repo-name/ npm run build
```

For a user/organisation site served from the domain root, use
`PZ_EDITOR_BASE=/`.

To host anywhere else, `npm run build` and upload `dist/` — it is entirely
static, with no server-side component.

---

## Limitations

* Verified against **world version 249** (Build 42). Other versions are detected;
  newer ones disable editing rather than guessing.
* **Inventory is read-only.** Item bodies use a large, subclass-dependent bit-header
  format that is not fully decoded. They are preserved byte-for-byte, so they are
  never corrupted, but they cannot be edited and item *names* cannot be shown —
  the registry-ID-to-name mapping lives in `WorldDictionary.bin`, not in
  `players.db`.
* Traits can be removed but not added, since valid registry ids vary per build.
* A character's world state (the `map_*.bin` chunk files) is not touched. Moving
  a character to coordinates in an ungenerated area is safe, but reviving does
  not clean up a corpse already written into the world.

---

## Credits and disclaimer

Format knowledge was obtained by reading decompiled Project Zomboid source for
research and interoperability purposes. No game code or assets are included in
this repository.

Not affiliated with or endorsed by The Indie Stone. Use at your own risk, and
keep backups.
