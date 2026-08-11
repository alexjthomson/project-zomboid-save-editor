import type { PlayerSession } from './state';
import { el, section, renderHexDump, renderTrace, renderByteDiff, hex, formatBytes } from './components';
import {
    BODY_PART_LABELS,
    calculateOverallHealth,
    type BodyPartData,
} from '../save/blocks/BodyDamage';
import { ORDERED_STATS } from '../save/blocks/Stats';
import { countItems, decodeItemHeader, flattenItems } from '../save/blocks/Inventory';
import { tracePlayerBlob } from '../save/PlayerBlobCodec';
import { diffBytes } from '../save/ops/diff';
import { restoreFullHealth, revivePlayer, isDeadFromBlob, countInjuries } from '../save/ops/health';

export interface PanelContext {
    session: PlayerSession;
    /** Current serialized bytes of the working model. */
    currentBlob: Uint8Array;
    editable: boolean;
    onChange: () => void;
    toast: (message: string, isError?: boolean) => void;
}

/* ------------------------------------------------------------------ */
/* small field builders                                                */
/* ------------------------------------------------------------------ */

function textField(
    label: string,
    value: string,
    editable: boolean,
    onInput: (value: string) => void,
    sub?: string,
): HTMLElement {
    const input = el('input', { type: 'text', value }) as HTMLInputElement;
    input.disabled = !editable;
    input.addEventListener('change', () => onInput(input.value));
    return el('div', { class: 'field' }, el('label', {}, label), input, sub ? el('span', { class: 'sub' }, sub) : null);
}

function numberField(
    label: string,
    value: number,
    editable: boolean,
    onInput: (value: number) => void,
    opts: { step?: number; min?: number; max?: number; sub?: string } = {},
): HTMLElement {
    const input = el('input', {
        type: 'number',
        value: String(value),
        step: String(opts.step ?? 'any'),
    }) as HTMLInputElement;
    if (opts.min !== undefined) input.min = String(opts.min);
    if (opts.max !== undefined) input.max = String(opts.max);
    input.disabled = !editable;
    input.addEventListener('change', () => {
        const parsed = Number(input.value);
        if (Number.isFinite(parsed)) onInput(parsed);
    });
    return el(
        'div',
        { class: 'field' },
        el('label', {}, label),
        input,
        opts.sub ? el('span', { class: 'sub' }, opts.sub) : null,
    );
}

function checkField(
    label: string,
    value: boolean,
    editable: boolean,
    onInput: (value: boolean) => void,
): HTMLElement {
    const id = `chk-${Math.random().toString(36).slice(2)}`;
    const input = el('input', { type: 'checkbox', id }) as HTMLInputElement;
    input.checked = value;
    input.disabled = !editable;
    input.addEventListener('change', () => onInput(input.checked));
    return el('div', { class: 'field-check' }, input, el('label', { for: id }, label));
}

function readonlyField(label: string, value: string): HTMLElement {
    const input = el('input', { type: 'text', value }) as HTMLInputElement;
    input.disabled = true;
    return el('div', { class: 'field' }, el('label', {}, label), input);
}

/* ------------------------------------------------------------------ */
/* General                                                             */
/* ------------------------------------------------------------------ */

export function renderGeneral(ctx: PanelContext): HTMLElement {
    const { session, editable, onChange } = ctx;
    const root = el('div');
    const player = session.working;
    const record = session.record;

    if (!player) return root;

    const desc = player.descriptor;
    root.append(
        section(
            'Identity',
            el(
                'div',
                { class: 'field-grid' },
                desc
                    ? textField('Forename', desc.forename, editable, (v) => {
                          desc.forename = v;
                          onChange();
                      })
                    : readonlyField('Forename', '(no descriptor)'),
                desc
                    ? textField('Surname', desc.surname, editable, (v) => {
                          desc.surname = v;
                          onChange();
                      })
                    : null,
                textField('Display name', player.displayName, editable, (v) => {
                    player.displayName = v;
                    onChange();
                }),
                readonlyField('Account username', record.username ?? '(local save)'),
                readonlyField('Steam ID', record.steamid ?? '-'),
                readonlyField('Row', `${record.table} #${record.id}`),
            ),
        ),
    );

    if (desc) {
        const genderSelect = el('select') as HTMLSelectElement;
        genderSelect.append(el('option', { value: 'male' }, 'Male'), el('option', { value: 'female' }, 'Female'));
        genderSelect.value = desc.female ? 'female' : 'male';
        genderSelect.disabled = !editable;
        genderSelect.addEventListener('change', () => {
            desc.female = genderSelect.value === 'female';
            onChange();
        });

        root.append(
            section(
                'Appearance & profession',
                el(
                    'p',
                    { class: 'section-note' },
                    'Changing gender only updates the descriptor flag; the character model (HumanVisual) is left ' +
                        'untouched, so mismatched values may look odd in game.',
                ),
                el(
                    'div',
                    { class: 'field-grid' },
                    el('div', { class: 'field' }, el('label', {}, 'Gender'), genderSelect),
                    textField(
                        'Profession',
                        desc.profession,
                        editable,
                        (v) => {
                            desc.profession = v;
                            onChange();
                        },
                        'ResourceLocation, e.g. base:unemployed. Must never be empty.',
                    ),
                    readonlyField('Torso model', desc.torso),
                    readonlyField('Hair model', player.visual.hairModel ?? '(default)'),
                    readonlyField('Beard model', player.visual.beardModel ?? '(none)'),
                    readonlyField('Skin texture', player.visual.skinTextureName ?? '(default)'),
                ),
            ),
        );
    }

    const deadCheck = checkField('Marked dead in the database (isDead column)', session.isDead, editable, (v) => {
        session.isDead = v;
        onChange();
    });

    root.append(
        section(
            'State',
            el(
                'p',
                { class: 'section-note' },
                'The isDead column is the authoritative persistent death flag: PlayerDB.loadPlayer forces health ' +
                    'to zero when it is set, whatever the BLOB says. Clearing it alone is not enough — the body ' +
                    'parts must also be healed. Use Revive Player on the Health tab to do both.',
            ),
            deadCheck,
            checkField('On fire', player.onFire, editable, (v) => {
                player.onFire = v;
                onChange();
            }),
            checkField('Asleep', player.asleep, editable, (v) => {
                player.asleep = v;
                onChange();
            }),
            checkField('God mode / cheats: unlimited endurance', player.flags.unlimitedEndurance, editable, (v) => {
                player.flags.unlimitedEndurance = v;
                onChange();
            }),
            checkField('Unlimited carry weight', player.flags.unlimitedCarry, editable, (v) => {
                player.flags.unlimitedCarry = v;
                onChange();
            }),
        ),
    );

    root.append(
        section(
            'Survival',
            el(
                'div',
                { class: 'field-grid' },
                numberField('Hours survived', player.hoursSurvived, editable, (v) => {
                    player.hoursSurvived = v;
                    onChange();
                }),
                numberField('Zombie kills', player.zombieKills, editable, (v) => {
                    player.zombieKills = Math.trunc(v);
                    onChange();
                }, { step: 1, min: 0 }),
                numberField('Survivor kills', player.survivorKills, editable, (v) => {
                    player.survivorKills = Math.trunc(v);
                    onChange();
                }, { step: 1, min: 0 }),
                numberField('Last hour slept', player.lastHourSleeped, editable, (v) => {
                    player.lastHourSleeped = Math.trunc(v);
                    onChange();
                }, { step: 1 }),
            ),
        ),
    );

    return root;
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

const PART_FLAGS: Array<{ key: keyof BodyPartData; label: string; short: string }> = [
    { key: 'bleeding', label: 'Bleeding', short: 'Bleed' },
    { key: 'bitten', label: 'Bitten', short: 'Bite' },
    { key: 'scratched', label: 'Scratched', short: 'Scr' },
    { key: 'cut', label: 'Cut', short: 'Cut' },
    { key: 'deepWounded', label: 'Deep wound', short: 'Deep' },
    { key: 'infected', label: 'Zombie infected', short: 'ZInf' },
    { key: 'infectedWound', label: 'Wound infection', short: 'WInf' },
    { key: 'haveGlass', label: 'Lodged glass', short: 'Glass' },
    { key: 'haveBullet', label: 'Lodged bullet', short: 'Bullet' },
    { key: 'bandaged', label: 'Bandaged', short: 'Band' },
    { key: 'stitched', label: 'Stitched', short: 'Stitch' },
    { key: 'splint', label: 'Splinted', short: 'Splint' },
];

export function renderHealth(ctx: PanelContext): HTMLElement {
    const { session, editable, onChange, toast } = ctx;
    const root = el('div');
    const player = session.working;
    if (!player) return root;

    const overall = calculateOverallHealth(player.bodyDamage.parts);
    const bar = el('div', {
        class: `health-bar${overall <= 0 ? ' is-low' : overall < 50 ? ' is-mid' : ''}`,
    });
    bar.append(el('span', { style: `width:${Math.max(0, Math.min(100, overall))}%` }));

    const reviveBtn = el('button', { class: 'btn btn-primary' }, 'Revive Player') as HTMLButtonElement;
    reviveBtn.disabled = !editable;
    reviveBtn.addEventListener('click', () => {
        const result = revivePlayer(player);
        session.isDead = false;
        toast(`Revived: ${result.changes.length} field(s) changed, isDead cleared.`);
        onChange();
    });

    const healBtn = el('button', { class: 'btn' }, 'Restore Full Health') as HTMLButtonElement;
    healBtn.disabled = !editable;
    healBtn.addEventListener('click', () => {
        const result = restoreFullHealth(player);
        toast(`Healed: ${result.changes.length} field(s) changed.`);
        onChange();
    });

    const deadFromBlob = isDeadFromBlob(player);
    root.append(
        section(
            'Overall',
            el(
                'div',
                { class: 'overall' },
                el('strong', {}, `${overall.toFixed(1)} / 100`),
                bar,
                el(
                    'span',
                    { class: `badge ${deadFromBlob || session.isDead ? 'badge-dead' : 'badge-alive'}` },
                    deadFromBlob || session.isDead ? 'Dead' : 'Alive',
                ),
            ),
            el(
                'p',
                { class: 'section-note' },
                'Overall health is not stored in the file. BodyDamage.calculateOverallHealth recomputes it after ' +
                    'loading as 100 minus the sum of each body part\u2019s damage times its part modifier, so editing ' +
                    'part health below is what actually changes it. ' +
                    `${countInjuries(player)} body part(s) currently injured.`,
            ),
            el('div', { class: 'btn-row' }, reviveBtn, healBtn),
        ),
    );

    /* --- body parts table --- */
    const table = el('table', { class: 'parts' });
    const head = el('tr');
    head.append(el('th', {}, 'Body part'), el('th', {}, 'Health'));
    for (const flag of PART_FLAGS) {
        head.append(el('th', { class: 'flag-cell', title: flag.label }, flag.short));
    }
    table.append(el('thead', {}, head));

    const body = el('tbody');
    for (const part of player.bodyDamage.parts) {
        const injured =
            part.health < 100 ||
            PART_FLAGS.some((f) => part[f.key] === true) ||
            part.fractureTime > 0 ||
            part.burnTime > 0;
        const row = el('tr', injured ? { class: 'is-hurt' } : {});
        row.append(el('td', {}, BODY_PART_LABELS[part.type]));

        const healthInput = el('input', {
            type: 'number',
            value: part.health.toFixed(1),
            min: '0',
            max: '100',
            step: '0.1',
        }) as HTMLInputElement;
        healthInput.disabled = !editable;
        healthInput.addEventListener('change', () => {
            const parsed = Number(healthInput.value);
            if (Number.isFinite(parsed)) {
                part.health = Math.max(0, Math.min(100, parsed));
                onChange();
            }
        });
        row.append(el('td', { class: 'num' }, healthInput));

        for (const flag of PART_FLAGS) {
            const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
            input.checked = part[flag.key] === true;
            input.disabled = !editable;
            input.title = flag.label;
            input.addEventListener('change', () => {
                (part[flag.key] as unknown as boolean) = input.checked;
                // Conditional payloads must be kept consistent with their flag or
                // the BLOB length changes and the file becomes unreadable.
                if (flag.key === 'bandaged') part.bandageLife = input.checked ? (part.bandageLife ?? 100) : null;
                if (flag.key === 'infectedWound') {
                    part.woundInfectionLevel = input.checked ? (part.woundInfectionLevel ?? 1) : null;
                }
                if (flag.key === 'splint') part.splintFactor = input.checked ? (part.splintFactor ?? 1) : null;
                onChange();
            });
            row.append(el('td', { class: 'flag-cell' }, input));
        }
        body.append(row);
    }
    table.append(body);

    root.append(
        section(
            'Body parts',
            el(
                'p',
                { class: 'section-note' },
                'Mirrors BodyDamage.save / BodyPart fields (BodyDamage.java:243). Bandage, wound-infection and ' +
                    'splint payloads are written only when their flag is set, so toggling a flag adjusts them ' +
                    'automatically.',
            ),
            table,
        ),
    );

    /* --- timers / fractures / burns --- */
    const timers = el('table', { class: 'simple' });
    timers.append(
        el(
            'thead',
            {},
            el(
                'tr',
                {},
                el('th', {}, 'Body part'),
                el('th', {}, 'Fracture'),
                el('th', {}, 'Burn'),
                el('th', {}, 'Bleeding'),
                el('th', {}, 'Deep wound'),
                el('th', {}, 'Extra pain'),
            ),
        ),
    );
    const timerBody = el('tbody');
    for (const part of player.bodyDamage.parts) {
        if (
            part.fractureTime === 0 &&
            part.burnTime === 0 &&
            part.bleedingTime === 0 &&
            part.deepWoundTime === 0 &&
            part.additionalPain === 0
        ) {
            continue;
        }
        timerBody.append(
            el(
                'tr',
                {},
                el('td', {}, BODY_PART_LABELS[part.type]),
                el('td', { class: 'mono' }, part.fractureTime.toFixed(2)),
                el('td', { class: 'mono' }, part.burnTime.toFixed(2)),
                el('td', { class: 'mono' }, part.bleedingTime.toFixed(2)),
                el('td', { class: 'mono' }, part.deepWoundTime.toFixed(2)),
                el('td', { class: 'mono' }, part.additionalPain.toFixed(2)),
            ),
        );
    }
    if (timerBody.children.length > 0) {
        timers.append(timerBody);
        root.append(
            section(
                'Active injury timers',
                el(
                    'p',
                    { class: 'section-note' },
                    'Non-zero timers keep applying damage after loading. Revive Player and Restore Full Health ' +
                        'clear all of them.',
                ),
                timers,
            ),
        );
    }

    /* --- infection & illness --- */
    const main = player.bodyDamage.main;
    root.append(
        section(
            'Infection & illness',
            el(
                'div',
                { class: 'field-grid' },
                numberField(
                    'Infection start (world hours)',
                    main.infectionTime,
                    editable,
                    (v) => {
                        main.infectionTime = v;
                        onChange();
                    },
                    { sub: '-1 means never infected' },
                ),
                numberField(
                    'Infection mortality duration',
                    main.infectionMortalityDuration,
                    editable,
                    (v) => {
                        main.infectionMortalityDuration = v;
                        onChange();
                    },
                    { sub: '-1 when unset' },
                ),
                numberField(
                    'Cold damage stage',
                    main.coldDamageStage,
                    editable,
                    (v) => {
                        main.coldDamageStage = v;
                        onChange();
                    },
                    { sub: '>= 1 forces setHealth(0) on the next update' },
                ),
                numberField('Cold strength', main.coldStrength, editable, (v) => {
                    main.coldStrength = v;
                    onChange();
                }),
                numberField('Pain reduction', main.painReduction, editable, (v) => {
                    main.painReduction = v;
                    onChange();
                }),
            ),
            checkField('Has a cold', main.hasACold, editable, (v) => {
                main.hasACold = v;
                onChange();
            }),
            player.bodyDamage.thermoregulator
                ? el(
                      'div',
                      { class: 'field-grid' },
                      numberField(
                          'Thermal damage',
                          player.bodyDamage.thermoregulator.thermalDamage,
                          editable,
                          (v) => {
                              player.bodyDamage.thermoregulator!.thermalDamage = v;
                              onChange();
                          },
                          { sub: 'Hypothermia / hyperthermia accumulator' },
                      ),
                  )
                : null,
        ),
    );

    /* --- stats --- */
    const statGrid = el('div', { class: 'field-grid' });
    for (const stat of ORDERED_STATS) {
        statGrid.append(
            numberField(
                stat.label,
                player.stats[stat.id],
                editable,
                (v) => {
                    player.stats[stat.id] = Math.max(stat.min, Math.min(stat.max, v));
                    onChange();
                },
                { step: 0.01, min: stat.min, max: stat.max, sub: `${stat.min} .. ${stat.max}` },
            ),
        );
    }
    root.append(
        section(
            'Stats',
            el(
                'p',
                { class: 'section-note' },
                'All 24 CharacterStat values in registration order (CharacterStat.java). Pain, Panic, Poison, ' +
                    'Sickness, FoodSickness, ZombieInfection and ZombieFever drive the damage and death logic.',
            ),
            statGrid,
        ),
    );

    return root;
}

/* ------------------------------------------------------------------ */
/* Position                                                            */
/* ------------------------------------------------------------------ */

export function renderPosition(ctx: PanelContext): HTMLElement {
    const { session, editable, onChange } = ctx;
    const root = el('div');
    const player = session.working;
    if (!player) return root;

    const mo = player.movingObject;
    root.append(
        section(
            'World position',
            el(
                'p',
                { class: 'section-note' },
                'Written by IsoMovingObject.save (IsoMovingObject.java:686). The x/y/z columns in the database are ' +
                    'kept in sync automatically on export, matching what ServerPlayerDB does when the game saves.',
            ),
            el(
                'div',
                { class: 'field-grid' },
                numberField('X', mo.x, editable, (v) => {
                    mo.x = v;
                    onChange();
                }, { step: 0.1 }),
                numberField('Y', mo.y, editable, (v) => {
                    mo.y = v;
                    onChange();
                }, { step: 0.1 }),
                numberField('Z (floor)', mo.z, editable, (v) => {
                    mo.z = v;
                    onChange();
                }, { step: 1, sub: '0 = ground level' }),
                readonlyField('Cell', `${Math.floor(mo.x / 300)}, ${Math.floor(mo.y / 300)}`),
                readonlyField('Chunk', `${Math.floor(mo.x / 8)}, ${Math.floor(mo.y / 8)}`),
                numberField('Facing direction', mo.direction, editable, (v) => {
                    mo.direction = Math.trunc(v);
                    onChange();
                }, { step: 1, sub: 'IsoDirections ordinal' }),
            ),
        ),
    );

    if (player.vehicle) {
        root.append(
            section(
                'Vehicle',
                el(
                    'p',
                    { class: 'section-note' },
                    'This character was saved inside a vehicle. Moving them without clearing this may teleport ' +
                        'them back to the vehicle.',
                ),
                el(
                    'div',
                    { class: 'field-grid' },
                    readonlyField('Vehicle X', player.vehicle.x.toFixed(3)),
                    readonlyField('Vehicle Y', player.vehicle.y.toFixed(3)),
                    readonlyField('Seat', String(player.vehicle.seat)),
                    readonlyField('Engine running', String(player.vehicle.engineRunning)),
                ),
            ),
        );
    }

    return root;
}

/* ------------------------------------------------------------------ */
/* Character (traits, perks, XP, nutrition)                            */
/* ------------------------------------------------------------------ */

export function renderCharacter(ctx: PanelContext): HTMLElement {
    const { session, editable, onChange } = ctx;
    const root = el('div');
    const player = session.working;
    if (!player) return root;

    /* Perks. */
    const perkTable = el('table', { class: 'simple' });
    perkTable.append(
        el('thead', {}, el('tr', {}, el('th', {}, 'Perk'), el('th', {}, 'Level'), el('th', {}, 'XP'))),
    );
    const perkBody = el('tbody');
    const xpByPerk = new Map(player.xp.xpMap.map((entry) => [entry.perk, entry]));
    const perks = [...player.xp.perkLevels].sort((a, b) => a.perk.localeCompare(b.perk));

    for (const perk of perks) {
        const levelInput = el('input', { type: 'number', value: String(perk.level), min: '0', max: '10', step: '1' }) as HTMLInputElement;
        levelInput.disabled = !editable;
        levelInput.addEventListener('change', () => {
            const parsed = Number(levelInput.value);
            if (Number.isFinite(parsed)) {
                perk.level = Math.max(0, Math.min(10, Math.trunc(parsed)));
                onChange();
            }
        });

        const xpEntry = xpByPerk.get(perk.perk);
        const xpInput = el('input', {
            type: 'number',
            value: String(xpEntry ? xpEntry.xp : 0),
            step: '1',
            min: '0',
        }) as HTMLInputElement;
        xpInput.disabled = !editable || !xpEntry;
        xpInput.addEventListener('change', () => {
            const parsed = Number(xpInput.value);
            if (xpEntry && Number.isFinite(parsed)) {
                xpEntry.xp = parsed;
                onChange();
            }
        });

        perkBody.append(
            el('tr', {}, el('td', {}, perk.perk), el('td', {}, levelInput), el('td', {}, xpInput)),
        );
    }
    perkTable.append(perkBody);

    root.append(
        section(
            'Perks & XP',
            el(
                'p',
                { class: 'section-note' },
                'Mirrors IsoGameCharacter.XP.save (IsoGameCharacter.java:18349). Levels and XP are stored in two ' +
                    'separate maps; a perk with no XP entry can only have its level changed. Perks that are not ' +
                    'already present in the save cannot be added without changing the BLOB length in ways this ' +
                    'editor does not yet validate.',
            ),
            el('div', { class: 'scroll-y' }, perkTable),
        ),
    );

    /* Traits. */
    const traitBox = el('div');
    if (player.xp.traits.traits.length === 0) {
        traitBox.append(el('div', { class: 'empty' }, 'No traits stored.'));
    } else {
        for (const trait of player.xp.traits.traits) {
            const pill = el('span', { class: 'pill' }, trait);
            if (editable) {
                const remove = el('button', { class: 'btn btn-small', style: 'margin-left:6px' }, '\u00d7');
                remove.addEventListener('click', () => {
                    const index = player.xp.traits.traits.indexOf(trait);
                    if (index >= 0) {
                        player.xp.traits.traits.splice(index, 1);
                        onChange();
                    }
                });
                pill.append(remove);
            }
            traitBox.append(pill);
        }
    }

    root.append(
        section(
            'Traits',
            el(
                'p',
                { class: 'section-note' },
                'CharacterTraits.save writes a count followed by each trait\u2019s ResourceLocation. Traits can be ' +
                    'removed here; adding one requires knowing a valid registry id for your build, so it is not ' +
                    'offered.',
            ),
            traitBox,
        ),
    );

    /* Nutrition. */
    const nutrition = player.nutrition;
    root.append(
        section(
            'Nutrition',
            el(
                'div',
                { class: 'field-grid' },
                numberField('Weight (kg)', nutrition.weight, editable, (v) => {
                    nutrition.weight = v;
                    onChange();
                }, { step: 0.1, sub: 'Below 35 applies LOWWEIGHT damage' }),
                numberField('Calories', nutrition.calories, editable, (v) => {
                    nutrition.calories = v;
                    onChange();
                }),
                numberField('Proteins', nutrition.proteins, editable, (v) => {
                    nutrition.proteins = v;
                    onChange();
                }),
                numberField('Lipids', nutrition.lipids, editable, (v) => {
                    nutrition.lipids = v;
                    onChange();
                }),
                numberField('Carbohydrates', nutrition.carbohydrates, editable, (v) => {
                    nutrition.carbohydrates = v;
                    onChange();
                }),
            ),
        ),
    );

    /* Knowledge. */
    root.append(
        section(
            'Knowledge',
            el(
                'div',
                { class: 'field-grid' },
                readonlyField('Known recipes', String(player.knownRecipes.length)),
                readonlyField('Books read', String(player.readBooks.length)),
                readonlyField('Literature read', String(player.readLiterature.length)),
                readonlyField('Media lines known', String(player.knownMediaLines.length)),
                readonlyField('Craft history entries', String(player.craftHistory?.length ?? 0)),
            ),
        ),
    );

    return root;
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export function renderInventory(ctx: PanelContext): HTMLElement {
    const { session } = ctx;
    const root = el('div');
    const player = session.working;
    if (!player) return root;

    const inv = player.inventory;
    const items = flattenItems(inv);
    const wornByIndex = new Map(player.wornItems.map((w) => [w.itemIndex, w.location]));

    root.append(
        el(
            'div',
            { class: 'warn-box' },
            el('strong', {}, 'Read only. '),
            'Item bodies use a large, subclass-dependent bit-header format that this editor does not fully decode. ' +
                'Because InventoryItem.saveWithSize prefixes every item with its byte length, each item is preserved ' +
                'verbatim and written back unchanged, so nothing here can corrupt your save.',
        ),
    );

    const table = el('table', { class: 'simple' });
    table.append(
        el(
            'thead',
            {},
            el(
                'tr',
                {},
                el('th', {}, '#'),
                el('th', {}, 'Registry ID'),
                el('th', {}, 'Item ID'),
                el('th', {}, 'Bytes'),
                el('th', {}, 'Condition'),
                el('th', {}, 'Uses'),
                el('th', {}, 'Custom name'),
                el('th', {}, 'Equipped'),
            ),
        ),
    );

    const body = el('tbody');
    items.forEach((item, index) => {
        const info = decodeItemHeader(item, session.record.worldVersion);
        let equipped = wornByIndex.get(index) ?? '';
        if (player.primaryHandIndex === index) equipped = equipped ? `${equipped}, primary hand` : 'primary hand';
        if (player.secondaryHandIndex === index) {
            equipped = equipped ? `${equipped}, secondary hand` : 'secondary hand';
        }

        body.append(
            el(
                'tr',
                {},
                el('td', { class: 'mono' }, String(index)),
                el('td', { class: 'mono' }, String(item.registryId)),
                el('td', { class: 'mono' }, String(item.id)),
                el('td', { class: 'mono' }, String(item.dataLength)),
                el('td', { class: 'mono' }, info.condition === null ? 'full' : String(info.condition)),
                el('td', { class: 'mono' }, info.ok ? String(info.currentUses) : '?'),
                el('td', {}, info.customName ?? ''),
                el('td', {}, equipped),
            ),
        );
    });
    table.append(body);

    root.append(
        section(
            `Inventory — ${countItems(inv)} item(s)`,
            el(
                'p',
                { class: 'section-note' },
                `Container "${inv.type || 'none'}", capacity ${inv.capacity}, ${inv.groups.length} run-length ` +
                    'group(s). Item names are not resolvable from players.db alone: the registry ID to item type ' +
                    'mapping lives in WorldDictionary.bin in the same save folder.',
            ),
            el('div', { class: 'scroll-y' }, table),
        ),
    );

    return root;
}

/* ------------------------------------------------------------------ */
/* Raw BLOB                                                            */
/* ------------------------------------------------------------------ */

export function renderBlob(ctx: PanelContext): HTMLElement {
    const { session, currentBlob } = ctx;
    const root = el('div');

    const diff = diffBytes(session.originalBlob, currentBlob);
    const highlight = new Set<number>();
    for (const run of diff.runs) {
        for (let i = run.offset; i < run.offset + run.length; i++) highlight.add(i);
    }

    root.append(
        section(
            'BLOB',
            el(
                'div',
                { class: 'field-grid' },
                readonlyField('Original size', `${session.originalBlob.length} bytes (${formatBytes(session.originalBlob.length)})`),
                readonlyField('Current size', `${currentBlob.length} bytes`),
                readonlyField('World version', String(session.record.worldVersion)),
                readonlyField('Support level', session.versionSupport.level),
                readonlyField('Changed bytes', String(diff.changedBytes)),
                readonlyField('Round-trip', diff.identical ? 'byte identical' : 'modified'),
            ),
        ),
    );

    if (session.working) {
        const trace = tracePlayerBlob(session.working, session.record.worldVersion);
        root.append(
            section(
                'Parsed structure',
                el(
                    'p',
                    { class: 'section-note' },
                    'Generated by the serializer itself, so every offset here is exactly where the field sits in ' +
                        'the file. Each row shows offset, size, primitive type, name, value, any save-version ' +
                        'condition and the decompiled source that justified the interpretation.',
                ),
                renderTrace(trace),
            ),
        );
    }

    root.append(section('Byte diff vs original', renderByteDiff(diff)));

    root.append(
        section(
            'Hex dump',
            el(
                'p',
                { class: 'section-note' },
                'Current bytes; changed bytes are highlighted. First 8 KB shown.',
            ),
            renderHexDump(currentBlob, { length: 8192, highlight }),
        ),
    );

    return root;
}

export function renderPanel(tab: string, ctx: PanelContext): HTMLElement {
    switch (tab) {
        case 'health':
            return renderHealth(ctx);
        case 'position':
            return renderPosition(ctx);
        case 'character':
            return renderCharacter(ctx);
        case 'inventory':
            return renderInventory(ctx);
        case 'blob':
            return renderBlob(ctx);
        default:
            return renderGeneral(ctx);
    }
}

export { hex };
