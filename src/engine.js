/**
 * Everything this client takes from netstorm-web (vendor/netstorm-web, a git submodule): the
 * simulation, the mission set-up, the mission script's events, the computer's move schedule and
 * the interface strings, the island-under-attack alarm and which shooter throws which missile. Nothing here is changed; it is only gathered in one place.
 */
export * from '@netstorm/sim';
export { slimUnits, slimMaps, slimMissions, mapsOf, outcome } from 'ns-client/game-data.ts';
export { createMatchWorld, ME, ENEMY } from 'ns-client/setup.ts';
export { DEFAULT_OPTIONS } from 'ns-client/options.ts';
export { nextEvent } from 'ns-client/mission-events.ts';
export { anchorFor, hasFacing, entityAt } from 'ns-client/ui-state.ts';
export { AiSchedule } from 'ns-client/ai-schedule.ts';
export { createAlarm } from 'ns-client/alarm.ts';
export { MISSILES } from 'ns-client/effects.ts';
export { m } from './messages.js';
