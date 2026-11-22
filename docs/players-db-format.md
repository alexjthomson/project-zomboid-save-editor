# `players.db` and the Project Zomboid player BLOB

This document records what the editor knows about Project Zomboid's `players.db`
file and, more importantly, the binary player BLOB stored inside it.

Everything here was derived by reading the decompiled game source (Build 42,
`worldversion` 249) and verified against a real `players.db` by round-tripping
every player record byte-for-byte. Source citations are given as
`class.method — path:line` so each claim can be re-checked.

**Nothing in this document is a guessed offset.** Where a value is not
understood, it is explicitly listed as unknown.

---

## 1. Terminology

| Term | Meaning |
| --- | --- |
| BLOB | The `data` column: the serialized `IsoPlayer` produced by `IsoPlayer.save`. |
| world version | The `worldversion` column. Governs the BLOB layout. |
| body part | One of the 17 `BodyPartType` entries tracked by `BodyDamage`. |
| registry ID | `WorldDictionary` short id identifying an item type. |

---

## 2. Database schema

`players.db` is an ordinary SQLite 3 database. Both tables are created by
`PlayerDBHelper.createPlayerTables` — `zombie/savefile/PlayerDBHelper.java:38`.

### 2.1 `localPlayers`

Used by single-player and by the host of a co-op game.
Written by `zombie/savefile/PlayerDB.java`.

```sql
CREATE TABLE localPlayers (
    id           INTEGER PRIMARY KEY NOT NULL,
    world        TEXT,
    wx           INTEGER,
    wy           INTEGER,
    x            FLOAT,
    y            FLOAT,
    z            FLOAT,
    worldversion INTEGER,
    data         BLOB,
    isDead       BOOLEAN,
    name         STRING
);
```

### 2.2 `networkPlayers`

Used by dedicated servers and by clients connecting to them.
Written by `zombie/savefile/ServerPlayerDB.java` and read by
`zombie/savefile/ClientPlayerDB.java`.

```sql
CREATE TABLE networkPlayers (
    id           INTEGER PRIMARY KEY NOT NULL,
    world        TEXT,
    username     TEXT,
    playerIndex  INTEGER,
    name         STRING,
    steamid      STRING,
    x            FLOAT,
    y            FLOAT,
    z            FLOAT,
    worldversion INTEGER,
    data         BLOB,
    isDead       BOOLEAN
);

CREATE INDEX inpusername ON networkPlayers (username);
```

### 2.3 Column notes

| Column | Notes |
| --- | --- |
| `id` | Row primary key. The only stable identifier for a record. |
| `world` | Save/world name, e.g. `B42`. |
| `username` | Multiplayer account name. Not unique — `playerIndex` distinguishes a player's several characters. |
| `playerIndex` | Which of the account's character slots this row is (0-3). |
| `name` | `forename + " " + surname`, duplicated from the descriptor inside the BLOB. |
| `steamid` | Steam ID as text, `0` when Steam is not in use. |
| `x` / `y` / `z` | Duplicated from the BLOB so the server can locate a player without deserializing. Kept in sync on export. |
| `wx` / `wy` | `localPlayers` only: chunk coordinates, `floor(x / 8)`. Recomputed on export when the character has moved. |
| `worldversion` | **Required to parse `data`.** See §4. |
| `data` | The player BLOB. See §5 onward. |
| `isDead` | **The authoritative persistent death flag.** See §8. |

### 2.4 The queries the game runs

| Operation | SQL | Source |
| --- | --- | --- |
| Load a network character | `SELECT id, x, y, z, worldversion, data, isDead FROM networkPlayers WHERE world = ? AND username = ? AND playerIndex = ?` | `ServerPlayerDB.serverLoadNetworkCharacter` |
| Save a network character | `UPDATE networkPlayers SET x=?, y=?, z=?, worldversion=?, data=?, isDead=? WHERE id=?` | `ServerPlayerDB.saveNetworkCharacter` |
| Load a local character | `SELECT id, wx, wy, x, y, z, worldversion, data, isDead FROM localPlayers WHERE world = ?` | `PlayerDB.loadPlayer` |

The editor mirrors the `UPDATE` statements exactly, so an exported database is
indistinguishable from one the game wrote.

---

## 3. Primitive encoding

The BLOB is written with `java.nio.ByteBuffer`, which defaults to **big-endian**
and is never switched to little-endian anywhere in the save path.

| Reader/writer method | Java call | Bytes |
| --- | --- | --- |
| `int8` | `put(byte)` | 1 |
| `bool` | `put((byte)(b ? 1 : 0))` | 1 |
| `int16` | `putShort` | 2 |
| `int32` | `putInt` | 4 |
| `int64` | `putLong` | 8 |
| `float32` | `putFloat` | 4 |
| `float64` | `putDouble` | 8 |
| `char` | `putChar` | 2 (UTF-16BE code unit) |

### 3.1 Strings

`GameWindow.WriteString` / `ReadString` — `zombie/GameWindow.java:1111` and
`:1126`, implemented by `GameWindow.StringUTF` at `:1265` / `:1279`.

```
int16 byteLength      // number of UTF-8 BYTES, not characters
byte[byteLength]      // UTF-8
```

`null` and `""` are both written as length `0`, so they are indistinguishable
after a round-trip. The editor normalises both to `""`.

### 3.2 The UTF-16 exception

`PlayerCraftHistory` does **not** use `GameWindow.WriteString`. It writes an
int32 *character* count followed by raw `putChar` calls, i.e. UTF-16BE:

```
int32 charCount
char[charCount]
```

This is a genuine inconsistency in the game, not a mistake in this document.

### 3.3 Lua `modData` tables

`modData` is a `KahluaTable`, whose codec lives in `se.krka.kahlua`
(`KahluaTableImpl`), outside the decompiled `zombie` tree. Format:

```
int32 entryCount
per entry:
    int8 keyType,   key
    int8 valueType, value
```

Types: `0` = String, `1` = float64, `2` = nested table, `3` = boolean.

---

## 4. Save version handling

**The BLOB contains no version number.** The `worldversion` column is passed
into `IsoPlayer.load(ByteBuffer, int worldVersion)` by the loader, so the BLOB
can only be parsed alongside its row.

(The standalone `map_p.bin` file written by the no-argument `IsoPlayer.save()`
*does* start with a `PLYR` magic and an int32 version, but that is a different
file and is not what `players.db` stores.)

Current version constant: **251** (`IsoWorld.WorldVersion`, also written by
`IsoPlayer.save`). The parser was originally derived from the version **249**
build, and the source line numbers cited throughout this document are from that
build.

**World versions 250 and 251** were then checked against the version 251
build's source:

* Every `load` method mirrored here (`IsoMovingObject`, `IsoGameCharacter`,
  `IsoPlayer`, `SurvivorDesc`, `HumanVisual`, `ItemVisual`, `ItemContainer`,
  `CompressIdenticalItems`, `Stats`, `BodyDamage`, `Thermoregulator`, `XP`,
  `CharacterTraits`, `Nutrition`, `Fitness`, `PlayerCraftHistory`,
  `PlayerCheats`, `KahluaTableImpl`) reads the same fields in the same order as
  §5 and §6 describe, and `CharacterStat.ORDERED_STATS` is unchanged.
* None of those classes, nor anything else under `zombie/characters`,
  `zombie/inventory` or `zombie/savefile`, has a `worldVersion >= 250` or
  `>= 251` branch. The newest gate in the player BLOB is still
  `Thermoregulator`'s `>= 249`.
* The two constants the new versions introduced,
  `WorldVersion_VehicleTowedByID` (250) and `WorldVersion_AttemptedKeyDrop`
  (251), are not referenced by any of those classes.
* The death logic in §8 is unchanged: `isDead()`, `calculateOverallHealth()`
  and the `isDead` column override in `PlayerDB` / `ServerPlayerDB`.
* A real version 251 single-player save (one `localPlayers` row) parses with
  zero trailing bytes and re-serializes byte-for-byte, and a character revived
  from it loaded in the game.

Versions above 251 stay disabled. Independently of the version, the editor
round-trips every BLOB when a file is opened and disables editing for any
character that does not reproduce exactly; such a BLOB is written back
unchanged.

### 4.1 Version gates in the player BLOB

| Gate | Version | Effect | Source |
| --- | --- | --- | --- |
| `fishingCheat` | ≥ 202 | extra cheat byte | `IsoGameCharacter.java:5966` |
| `voiceType` | ≥ 203 | int8 after `knownMediaLines` | `IsoPlayer.java:1333` |
| `brushToolAndFastMove` | ≥ 217 | two extra cheat bytes | `IsoGameCharacter.java:5970` |
| `timeToSneezeOrCough` | ≥ 222 | float32 in `BodyDamage` main fields | `BodyDamage.java:321` |
| `readPrintMedia` | ≥ 222 | string list | `IsoGameCharacter.java:5993` |
| `bodyPartHerbalFactors` | ≥ 227 | three float32 per body part | `BodyDamage.java:220` |
| `craftHistory` | ≥ 228 | `PlayerCraftHistory` block | `IsoPlayer.java:1336` |
| `unlimitedAmmoAndRecipes` | ≥ 230 | two extra cheat bytes | `IsoGameCharacter.java:5978` |
| `playerCheats` | ≥ 231 | `PlayerCheats` block | `IsoGameCharacter.java:6004` |
| `autoDrink` | ≥ 239 | int8 | `IsoPlayer.java:1295` |
| `thermoNodeInsulation` | ≥ 241 | per-node insulation float | `Thermoregulator.load` |
| `thermoWetness` | ≥ 243 | metabolicRateReal + per-node wind/wetness | `Thermoregulator.load` |
| `thermoDuration` | ≥ 249 | `thermalDuration` float | `Thermoregulator.load` |

**Asymmetry warning.** Several fields are written unconditionally by `save` but
read conditionally by `load`. `BodyDamage.saveMainFields` always writes
`timeToSneezeOrCough`, and the herbal factors are always written, yet both are
only read above their gate version. The editor mirrors the *save* side, because
that is what determines the bytes in the file.

---

## 5. Top-level BLOB layout

Call chain, outermost first:

```
IsoPlayer.save(ByteBuffer, boolean)      characters/IsoPlayer.java:1456
  IsoGameCharacter.save(ByteBuffer)      characters/IsoGameCharacter.java:6024
    IsoMovingObject.save(ByteBuffer)     iso/IsoMovingObject.java:686
```

`IsoMovingObject.load` does **not** call `IsoObject.load`, so none of the
`IsoObject` sprite/attached-sprite data appears in a player BLOB.

The first two bytes are written by `IsoMovingObject.save` but consumed by
`IsoPlayer.load` before it delegates to `super.load`
(`IsoPlayer.java:1238-1240`), which is why they appear at the very front.

### 5.1 Field order (world version 249)

| # | Field | Type | Notes |
| --- | --- | --- | --- |
| 1 | `serialize` | int8 | `IsoObject.Serialize()`; 1 for players |
| 2 | `objectID` | int8 | `factoryGetClassID("player")` |
| 3 | `offsetX`, `offsetY` | 2 × float32 | |
| 4 | `x`, `y`, `z` | 3 × float32 | mirrored into the SQL columns |
| 5 | `direction` | int32 | `IsoDirections` ordinal |
| 6 | `hasModData` | bool | followed by a Kahlua table when set |
| 7 | `hasDescriptor` | bool | followed by `SurvivorDesc` (§6.1) |
| 8 | `visual` | `HumanVisual` | §6.2 |
| 9 | `inventory` | `ItemContainer` | §6.3 |
| 10 | `asleep` | bool | |
| 11 | `forceWakeUpTime` | float32 | |
| 12 | `stats` | `Stats` | §6.4 |
| 13 | `bodyDamage` | `BodyDamage` | §6.5 |
| 14 | `xp` | `IsoGameCharacter.XP` | §6.6, includes traits |
| 15 | `leftHandItem`, `rightHandItem` | 2 × int32 | inventory indices, -1 for none |
| 16 | `onFire` | bool | |
| 17 | depress/beta/pain/sleeping-tablet effects | 8 × float32 | drug effect + delta pairs |
| 18 | `readBooks` | int32 count, then `{string fullType, int32 pages}` | |
| 19 | `reduceInfectionPower` | float32 | |
| 20 | `knownRecipes` | int32 count, then strings | |
| 21 | `lastHourSleeped` | int32 | |
| 22 | `timeSinceLastSmoke`, `beardGrowTiming`, `hairGrowTiming` | 3 × float32 | |
| 23 | cheat flags | 6–11 × bool | version dependent, see §4.1 |
| 24 | `sneaking`, `deathDragDown` | 2 × bool | |
| 25 | `readLiterature` | int32 count, then `{string, int32 day}` | |
| 26 | `readPrintMedia` | int32 count, then strings | ≥ 222 |
| 27 | `lastAnimalPet` | int64 | |
| 28 | `playerCheats` | block | ≥ 231 |
| 29 | `hoursSurvived` | float64 | back in `IsoPlayer` |
| 30 | `zombieKills` | int32 | |
| 31 | `wornItems` | **int8** count, then `{string bodyLocation, int16 index}` | |
| 32 | `primaryHandItem`, `secondaryHandItem` | 2 × int16 | indices into the saved item list |
| 33 | `survivorKills` | int32 | |
| 34 | `nutrition` | 5 × float32 | calories, proteins, lipids, carbohydrates, weight |
| 35 | `allChatMuted` | bool | |
| 36 | `tagPrefix` | string | |
| 37 | `tagColor` r/g/b | 3 × float32 | |
| 38 | `displayName` | string | |
| 39 | `showTag`, `factionPvp` | 2 × bool | |
| 40 | `autoDrink` | bool | ≥ 239 |
| 41 | `extraInfoFlags` | int8 | god mode / ghost / invisible bitfield |
| 42 | `hasVehicle` | bool | then `{float32 x, float32 y, int8 seat, bool running}` |
| 43 | `mechanicsItem` | int32 count, then `{int64, int64}` | |
| 44 | `fitness` | block | |
| 45 | `alreadyReadBook` | **int16** count, then int16 registry IDs | |
| 46 | `knownMediaLines` | **int16** count, then strings | |
| 47 | `voiceType` | int8 | ≥ 203 |
| 48 | `craftHistory` | block, UTF-16 keys | ≥ 228 |

Note the mixed count widths at 31, 45 and 46 — a common source of parser drift.

---

## 6. Nested structures

### 6.1 `SurvivorDesc` — `characters/SurvivorDesc.java`

```
int32  id
string forename
string surname
string torso                    // model name, default "Base_Torso"
int32  gender                   // 1 == FEMALE, anything else == MALE
string profession               // ResourceLocation, e.g. "base:unemployed"
int32  extraFlag                // 1 when the extra list is non-empty
    [int32 count, string × count]
int32  xpBoostCount
    { string perkId, int32 level } × count
--- worldVersion >= 208 ---
string voicePrefix
float32 voicePitch
int32  voiceType
```

**Hazard:** an empty `profession` string makes `ResourceLocation.of("")` throw
when the game loads the character. The editor never writes an empty profession.

**Not persisted:** the personality floats are re-randomised on load, so they
cannot be edited here.

### 6.2 `HumanVisual` — `characters/HumanVisual.java`

Flag-byte driven. The order colours are *read* differs from the order the flag
bits are *built*, which is preserved exactly:

```
int8 flags
  0x04 hair colour     (3 × float32)
  0x02 beard colour    (3 × float32)
  0x08 skin colour     (3 × float32)
int8 bodyHair, skinTexture, zombieRotStage
  0x40 skinTextureName (string)
  0x10 beardModel      (string)
  0x20 hairModel       (string)
int8 bloodCount,  byte × count     // 18 BloodBodyPartType entries
int8 dirtCount,   byte × count
int8 holesCount,  byte × count
int8 bodyVisualCount               // int8 here, NOT the int16 ItemVisuals uses
  ItemVisual × count
string nonAttachedHair
int8 flags2
  0x04 naturalHairColor (3 × float32)
  0x02 naturalBeardColor(3 × float32)
```

### 6.3 `ItemContainer` — `inventory/ItemContainer.java:2409` / `:2422`

```
string type
int8   explored
int16  groupCount                          // CompressIdenticalItems
  per group:
    int32 identical                        // run length
    int32 dataLen                          // InventoryItem.saveWithSize
      int16 registryID
      int8  saveType                       // always -1
      int32 id
      byte[dataLen - 7]                    // opaque item body
    int32 duplicateId × (identical - 1)
int8   hasBeenLooted
int32  capacity
```

Identical items are run-length compressed
(`inventory/CompressIdenticalItems.java`): one serialized copy plus the distinct
`id` of every additional copy.

**This is the single most important structural discovery in the format.**
Because `InventoryItem.saveWithSize` (`InventoryItem.java:3658`) writes an int32
byte length before every item — precisely so the game can skip items whose type
no longer exists — a parser can step over any item it does not understand and
write the original bytes straight back. That is what lets this editor reach the
health data, which sits *after* the inventory in the stream, without decoding
the very large, subclass-dependent item format.

The editor decodes only the leading, subclass-independent part of an item for
display (see `decodeItemHeader`), and always writes item bodies verbatim.

**Item names cannot be resolved from `players.db` alone.** The registry ID to
`Base.Axe` mapping lives in `WorldDictionary.bin` in the same save folder.

### 6.4 `Stats` — `characters/Stats.java`

24 × float32 in `CharacterStat` registration order
(`characters/CharacterStat.java:12-35`):

```
Anger, Boredom, Discomfort, Endurance, Fatigue, Fitness, FoodSickness, Hunger,
Idleness, Intoxication, Morale, NicotineWithdrawal, Pain, Panic, Poison, Sanity,
Sickness, Stress, Temperature, Thirst, Unhappiness, Wetness, ZombieFever,
ZombieInfection
```

The health-relevant ones are `Pain`, `Panic`, `Poison`, `Sickness`,
`FoodSickness`, `ZombieInfection`, `ZombieFever` and `Intoxication`.

### 6.5 `BodyDamage` — `characters/BodyDamage/BodyDamage.java:243` (save) / `:174` (load)

17 body parts in `BodyPartType` constructor order:

```
Hand_L, Hand_R, ForeArm_L, ForeArm_R, UpperArm_L, UpperArm_R,
Torso_Upper, Torso_Lower, Head, Neck, Groin,
UpperLeg_L, UpperLeg_R, LowerLeg_L, LowerLeg_R, Foot_L, Foot_R
```

Per part:

```
bool  cut, bitten, scratched, bandaged, bleeding, deepWounded, fakeInfected, infected
float32 health                        // 0..100
[float32 bandageLife]                 // only when bandaged
bool  infectedWound
[float32 woundInfectionLevel]         // only when infectedWound
float32 cutTime, biteTime, scratchTime, bleedingTime
float32 alcoholLevel, additionalPain, deepWoundTime
bool  haveGlass, getBandageXp, stitched
float32 stitchTime
bool  getStitchXp, getSplintXp
float32 fractureTime
bool  splint
[float32 splintFactor]                // only when splint
bool  haveBullet
float32 burnTime
bool  needBurnWash
float32 lastTimeBurnWash
string splintItem, bandageType
float32 cutTime                       // written a SECOND time, see below
float32 wetness, stiffness
float32 comfreyFactor, garlicFactor, plantainFactor   // read only when >= 227
```

Then the main fields (`saveMainFields` at `:304`, `loadMainFields` at `:318`):

```
float32 catchACold
bool    hasACold
float32 coldStrength
float32 timeToSneezeOrCough           // always written; read only when >= 222
bool    reduceFakeInfection
float32 healthFromFoodTimer
float32 painReduction, coldReduction
float32 infectionTime                 // -1 == never infected
float32 infectionMortalityDuration    // -1 == unset
float32 coldDamageStage
```

Then `Thermoregulator`, with its own version gates (§4.1).

#### Quirks

* **`cutTime` is written twice.** Once in position, and again after
  `bandageType`. `load` assigns both to `setCutTime`, so the second copy wins.
  The editor keeps both (`cutTime` / `cutTime2`) so the BLOB reproduces exactly.
* **Conditional payloads.** `bandageLife`, `woundInfectionLevel` and
  `splintFactor` are only present when their preceding boolean is set. Toggling
  the boolean changes the BLOB length, so the editor adjusts the payload
  automatically.
* **`overallBodyHealth` is not serialized.** See §8.
* **`isInfected` is not serialized.** See §8.

#### Body part damage modifiers

Used by `calculateOverallHealth`; the second float argument to the
`BodyPartType` constructor:

| Part | Modifier | Part | Modifier |
| --- | --- | --- | --- |
| Hand (×2) | 0.1 | Head | 0.6 |
| ForeArm (×2) | 0.2 | Neck | 0.7 |
| UpperArm (×2) | 0.3 | Groin | 0.4 |
| Torso_Upper | 0.35 | UpperLeg (×2) | 0.3 |
| Torso_Lower | 0.4 | LowerLeg (×2) | 0.2 |
| | | Foot (×2) | 0.2 |

### 6.6 `IsoGameCharacter.XP` — `characters/IsoGameCharacter.java:18349`

```
CharacterTraits:   int32 count, string × count      // ResourceLocations
float32 totalXp
int32   level, lastLevel
int32   xpMapCount     { string perkId, float32 xp }
int32   perkListCount  { string perkId, int32 level }
int32   multiplierCount{ string perkId, float32 multiplier, int8 min, int8 max }
```

Perk ids are written by `XP.savePerk` (`IsoGameCharacter.java:18288`); a null
perk becomes the empty string and is dropped on load.

### 6.7 Other blocks

| Block | Layout |
| --- | --- |
| `Nutrition` | 5 × float32: calories, proteins, lipids, carbohydrates, weight |
| `Fitness` | see `characters/Fitness.java` |
| `PlayerCheats` | int32 count, then `{int32 cheatOrdinal, bool}` |
| `PlayerCraftHistory` | int32 count, then UTF-16 keys (§3.2) |

---

## 7. Fields that are NOT understood

Honest accounting of what this editor deliberately does not decode:

| Area | Status | Consequence |
| --- | --- | --- |
| Item bodies | **Opaque** | Preserved byte-for-byte via the `dataLen` prefix. Inventory is read-only. |
| Nested bag contents | **Opaque** | Same. Bags round-trip but cannot be inspected. |
| `Fitness` internals | Parsed structurally, semantics not mapped | Round-trips; no UI. |
| `Thermoregulator` per-node values | Parsed, physical meaning partially mapped | `thermalDamage` is exposed; nodes are not. |
| `HumanVisual` blood/dirt/hole arrays | Parsed as raw byte arrays | Round-trip safe, no UI. |
| Personality floats | Not persisted by the game | Cannot be edited. |
| Item registry ID → name | Requires `WorldDictionary.bin` | Inventory shows numeric IDs. |

Anything the parser cannot consume is retained as `trailingBytes` and written
back unchanged, so an unfamiliar version degrades to "preserve everything"
rather than "corrupt the save". For all three players in the sample database,
`trailingBytes` is empty — the parser consumes every byte.

---

## 8. Death semantics — what "revive" really requires

This is the most important section for the editor's headline feature.

### 8.1 What makes a character dead

```java
// IsoGameCharacter.isDead() — characters/IsoGameCharacter.java:5616
return this.health <= 0 || this.bodyDamage.getHealth() <= 0;
```

Neither operand is stored in the BLOB:

* `IsoGameCharacter.health` is a transient field defaulting to `1.0F`
  (`IsoGameCharacter.java:542`). It is never serialized.
* `BodyDamage.getHealth()` returns `overallBodyHealth`, which is **not
  serialized either**. It is recomputed at the end of `BodyDamage.load` by
  `calculateOverallHealth()` (`BodyDamage.java:2458`):

```java
totalDamage = Σ (100 - bodyPart[i].health) * BodyPartType.getDamageModifyer(i)
totalDamage += getDamageFromPills()          // runtime only, not persisted
overallBodyHealth = 100 - min(totalDamage, 100)
```

**Therefore the only persistent thing in the BLOB that makes a character load
as dead is the set of 17 body-part health values.** Setting them all to 100
gives an overall health of 100.

### 8.2 The SQL `isDead` column overrides everything

```java
// PlayerDB.loadPlayer — savefile/PlayerDB.java:244
// ServerPlayerDB.serverLoadNetworkCharacter — savefile/ServerPlayerDB.java:279
if (isDead) {
    player.getBodyDamage().setOverallBodyHealth(0);
    player.setHealth(0);
}
```

This runs immediately after `load(...)`, so a character whose row has
`isDead = 1` is dead no matter how healthy the BLOB is. **Reviving requires
clearing the column as well as repairing the body parts.** The editor does both.

### 8.3 Zombie infection is re-derived, not stored

`BodyDamage.isInfected` is not serialized. `BodyDamage.update()` re-derives it
each tick (`BodyDamage.java:2166`):

```java
for (int i = 0; i < BodyPartType.ToIndex(BodyPartType.MAX); i++)
    if (this.IsInfected(i)) this.setInfected(true);
```

Once infected, `update()` applies death (`BodyDamage.java:2381`, `:2394`):

* mortality mode 1: `ReduceGeneralHealth(110)` — instant death
* otherwise: a timed death driven by `infectionTime` and
  `infectionMortalityDuration`

So removing zombie infection means clearing the **per-body-part** `infected` and
`fakeInfected` flags, and resetting `infectionTime` /
`infectionMortalityDuration` to `-1`. Clearing the `ZombieInfection` stat alone
achieves nothing.

### 8.4 Other persistent state that kills or damages

Every item below was traced to a specific damage call site.

| State | Effect | Source |
| --- | --- | --- |
| body part `health` | drives `overallBodyHealth` | `BodyDamage.java:2458` |
| per-part `infected` / `fakeInfected` | zombie infection death | `BodyDamage.java:2166`, `:2381` |
| `infectionTime`, `infectionMortalityDuration` | infection death timer | `BodyDamage.java:2385-2390` |
| `coldDamageStage` | `maxHealth = 100 - stage*100`; **calls `setHealth(0)` when that reaches 0** | `BodyDamage.java:2538-2543` |
| per-part `bleeding` / `bleedingTime` | per-tick damage, plus level-4 BLEEDING moodle damage | `BodyPart.java:168`, `BodyDamage.java:2303` |
| `Poison` stat | damage while the SICK moodle is set | `BodyDamage.java:2264` |
| `FoodSickness` stat | level-4 SICK moodle damage | `BodyDamage.java:2290` |
| `Hunger` stat | level-4 HUNGRY moodle damage | `BodyDamage.java:2285` |
| `Thirst` stat | level-4 THIRST moodle damage | `BodyDamage.java:2308` |
| `Nutrition.weight` < 35 | LOWWEIGHT damage | `Nutrition.java:340` |
| `onFire` | resumes burning | `IsoGameCharacter.save` |
| `deathDragDown` | restores the zombie drag-down death animation state | `IsoGameCharacter` |
| `Thermoregulator.thermalDamage` | accumulated hypo/hyperthermia damage | `Thermoregulator` |
| fracture / burn / deep wound / lodged glass / lodged bullet timers | ongoing pain and damage | `BodyPart.DamageUpdate` |

### 8.5 What `Revive Player` does

Implemented in `src/save/ops/health.ts`.

1. Every body part: `health = 100`; clear `cut`, `bitten`, `scratched`,
   `deepWounded`, `bleeding`, `infected`, `fakeInfected`, `infectedWound`,
   `haveGlass`, `haveBullet`; zero `cutTime`, `biteTime`, `scratchTime`,
   `bleedingTime`, `deepWoundTime`, `fractureTime`, `burnTime`,
   `additionalPain`, `stiffness`; clear bandage/stitch/splint state and their
   conditional payloads; zero the topical treatment factors.
2. `infectionTime = -1`, `infectionMortalityDuration = -1`,
   `reduceFakeInfection = false`.
3. `coldDamageStage = 0`, `hasACold = false`, `coldStrength = 0`,
   `catchACold = 0`, `coldReduction = 0`, `painReduction = 0`,
   `timeToSneezeOrCough = -1`.
4. `Thermoregulator.thermalDamage = 0`, `damageCounter = 0`.
5. Stats reset to their registered defaults: `Pain`, `Panic`, `Poison`,
   `Sickness`, `FoodSickness`, `ZombieInfection`, `ZombieFever`,
   `Intoxication`, `Stress`, `Wetness`.
6. Survival stats reset: `Hunger`, `Thirst`, `Fatigue`, `Endurance`
   (revive only — `Restore Full Health` leaves these alone).
7. `onFire = false`, `deathDragDown = false`, `asleep = false`.
8. `Nutrition.weight` raised to 35 only if it is below that.
9. **The SQL `isDead` column is cleared.**

Nothing else is touched. Name, appearance, clothing, inventory bytes, traits,
perks, XP, kills, profession, coordinates, hours survived, Steam ID and mod data
are all preserved — there are tests asserting exactly this.

`Restore Full Health` performs steps 1-5, 7 and 8 only: it repairs the body
without touching death state or survival needs.

---

## 9. Round-trip verification

The decisive correctness test. For every player in the sample database:

```ts
const player = parsePlayerBlob(record.data, record.worldVersion);
const bytes  = serializePlayerBlob(player);
assert(bytes is byte-for-byte identical to record.data);
```

**Result: all three sample players round-trip exactly**, at 7897, 10020 and
7157 bytes, with zero trailing bytes. See `tests/blob.test.ts`.

No normalisation is needed and no bytes are discarded, because:

* unknown item bodies are retained as raw slices,
* the duplicated `cutTime` is preserved as two fields,
* fields that `save` writes unconditionally are written unconditionally here,
  regardless of what `load` would read.

The field trace shown in the Raw BLOB tab is generated by the serializer itself
rather than by a second implementation, so displayed offsets are guaranteed to
match the real file. A test asserts the trace covers every byte contiguously.

---

## 10. Sample database

The `players.db` committed at the repository root, used as the test fixture:

| id | username | name | isDead | BLOB | overall health |
| --- | --- | --- | --- | --- | --- |
| 1 | `QuackyBoi` | Alex Thomson | 0 | 7897 B | **0.0** |
| 2 | `Gen. Waste` | Olin Parrott | 0 | 10020 B | 67.7 |
| 3 | `盲獣mōjū` | Leon Kennedy | 0 | 7157 B | 94.4 |

World `B42`, `worldversion` 249, 0 rows in `localPlayers`.

Player 1 is a perfect illustration of §8: every body part is at ~0 health, so
`IsoGameCharacter.isDead()` returns true and the character is unplayable, even
though the SQL `isDead` column says `0`. This is exactly the kind of broken
state `Revive Player` exists to repair, and it is what the revive tests run
against.
