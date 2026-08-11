/**
 * Save/world version handling.
 *
 * The version that governs player BLOB layout is the `worldversion` column on
 * the `localPlayers` / `networkPlayers` tables. It is passed straight into
 * `IsoPlayer.load(ByteBuffer, int worldVersion)` by
 * `zombie/savefile/PlayerDB.java:244` and
 * `zombie/savefile/ServerPlayerDB.java:253`, so the BLOB itself contains no
 * embedded version number — it must always be read alongside its row.
 *
 * (The standalone `map_p.bin` variant written by `IsoPlayer.save()` does embed
 * a "PLYR" magic plus an int32 version, but that file is not what lives in
 * `players.db`.)
 */

/** Version constant hard-coded in `IsoPlayer.save()` — zombie/characters/IsoPlayer.java:1526. */
export const CURRENT_WORLD_VERSION = 249;

/**
 * The oldest version this editor will attempt to parse. Older saves use
 * different layouts for several structures (notably `Thermoregulator`,
 * `BodyDamage.loadMainFields` and the cheat flags) and, more importantly, older
 * item serialization that we have not verified.
 */
export const MIN_SUPPORTED_WORLD_VERSION = 219;

/** Versions that have been checked field-by-field against the decompiled source. */
export const FULLY_SUPPORTED_WORLD_VERSIONS: readonly number[] = [249];

export type SupportLevel = 'full' | 'partial' | 'unsupported';

export interface VersionSupport {
    version: number;
    level: SupportLevel;
    message: string;
}

export function getVersionSupport(version: number): VersionSupport {
    if (FULLY_SUPPORTED_WORLD_VERSIONS.includes(version)) {
        return {
            version,
            level: 'full',
            message: `World version ${version} matches the version this editor was derived from (build 42).`,
        };
    }
    if (version > CURRENT_WORLD_VERSION) {
        return {
            version,
            level: 'unsupported',
            message:
                `World version ${version} is newer than the newest version this editor understands ` +
                `(${CURRENT_WORLD_VERSION}). The layout may have changed; editing is disabled.`,
        };
    }
    if (version >= MIN_SUPPORTED_WORLD_VERSION) {
        return {
            version,
            level: 'partial',
            message:
                `World version ${version} is older than ${CURRENT_WORLD_VERSION}. Version-conditional ` +
                `fields are handled, but this combination has not been verified against a real save. ` +
                `Round-trip verification will decide whether editing is allowed.`,
        };
    }
    return {
        version,
        level: 'unsupported',
        message:
            `World version ${version} is older than the minimum supported version ` +
            `(${MIN_SUPPORTED_WORLD_VERSION}). Editing is disabled.`,
    };
}

/**
 * Version gates used by the player BLOB. Each entry cites the decompiled
 * source line that introduced the conditional.
 */
export const VERSION_GATES = {
    /** `IsoGameCharacter.load` fishing cheat — IsoGameCharacter.java:5966 */
    fishingCheat: 202,
    /** `IsoPlayer.load` voice type — IsoPlayer.java:1333 */
    voiceType: 203,
    /** `IsoGameCharacter.load` brush tool + fast move cheats — IsoGameCharacter.java:5970 */
    brushToolAndFastMove: 217,
    /** `BodyDamage.loadMainFields` sneeze/cough timer — BodyDamage.java:321 */
    timeToSneezeOrCough: 222,
    /** `IsoGameCharacter.load` read print media — IsoGameCharacter.java:5993 */
    readPrintMedia: 222,
    /** `BodyDamage.load` herbal remedy factors — BodyDamage.java:220 */
    bodyPartHerbalFactors: 227,
    /** `IsoPlayer.load` craft history — IsoPlayer.java:1336 */
    craftHistory: 228,
    /** `IsoGameCharacter.load` unlimited ammo + know-all-recipes — IsoGameCharacter.java:5978 */
    unlimitedAmmoAndRecipes: 230,
    /** `IsoGameCharacter.load` PlayerCheats block — IsoGameCharacter.java:6004 */
    playerCheats: 231,
    /** `IsoPlayer.load` auto drink — IsoPlayer.java:1295 */
    autoDrink: 239,
    /** `Thermoregulator.load` insulation per node — Thermoregulator.java */
    thermoNodeInsulation: 241,
    /** `Thermoregulator.load` metabolicRateReal + wind/wetness per node */
    thermoWetness: 243,
    /** `Thermoregulator.load` thermalDuration */
    thermoDuration: 249,
} as const;
