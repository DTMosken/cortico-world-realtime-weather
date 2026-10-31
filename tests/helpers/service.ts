import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorldContext } from 'cortico/world.ts';
import type { WorldHost, EventEnvelope } from 'cortico/core/types.ts';
import { REALTIME_WEATHER_DEFAULTS, type RealtimeWeatherConfigSection } from '../../src/config.ts';
import { RealtimeWeatherWorld } from '../../src/world.ts';

export function weather(overrides: Record<string, unknown> = {}) {
  return { condition: { code: '104', text: 'PRIVATE_LOCATION' }, temperature: { value: 22, unit: '°C' }, feelsLike: { value: 24 }, wind: { direction: { compass: 'e' }, scale: 3 }, precipitation: { type: 'none', intensity: { value: 0 }, probability: 0.1, amount: { value: 0 } }, visibility: { value: 8000 }, uvIndex: 2, ...overrides };
}
export async function service(timezone = 'Australia/Sydney', deferEvents = false) {
  let now = Date.parse('2026-10-31T06:15:00Z');
  let current = weather();
  let hours = [1, 2, 3].map(offset => ({ ...weather(), forecastTime: new Date(now + offset * 3600000).toISOString() }));
  let days = [{ forecastStartTime: '2026-10-31T00:00:00+11:00', temperatureMin: { value: 18 }, temperatureMax: { value: 25 }, uvIndexMax: 4, daytime: weather(), nighttime: weather() }, { forecastStartTime: '2026-11-01T00:00:00+11:00', temperatureMin: { value: 15 }, temperatureMax: { value: 23 }, uvIndexMax: 4, daytime: weather(), nighttime: weather() }];
  let alerts: unknown[] = [];
  let air = { indexes: [{ code: 'cn-mee', aqiDisplay: '85', level: '2', category: '良', primaryPollutant: { code: 'pm2p5' } }], pollutants: [{ code: 'pm2p5', concentration: { value: 48 } }], stations: [{ name: 'PRIVATE_LOCATION' }] };
  const counts = { current: 0, alerts: 0, air: 0, hours: 0, days: 0, cities: 0 };
  const errors: Record<string, number> = {};
  const holds: Partial<Record<string, Promise<void>>> = {};
  const headerKeys: string[] = [];
  const server = createServer(async (req, res) => {
    const path = req.url!;
    headerKeys.push(String(req.headers['x-qw-api-key']));
    res.setHeader('Content-Type', 'application/json');
    const route = path.includes('/weather/v1/current/') ? 'current' : path.includes('/weatheralert/') ? 'alerts' : path.includes('/airquality/') ? 'air' : path.includes('/hourly/') ? 'hours' : path.includes('/daily/') ? 'days' : 'cities';
    counts[route]++;
    if (holds[route]) await holds[route];
    if (errors[route]) { res.writeHead(errors[route]); res.end(JSON.stringify({ detail: 'PRIVATE_LOCATION 42.33 101.12 PRIVATE_KEY' })); return; }
    const data = route === 'current' ? current : route === 'alerts' ? { alerts } : route === 'air' ? air : route === 'hours' ? { hours } : route === 'days' ? { days } : { code: '200', location: [{ id: 'example-city', name: 'PRIVATE_LOCATION', country: 'Example', adm1: 'North', adm2: 'District', lat: '42.33', lon: '101.12', tz: 'Australia/Sydney' }] };
    res.end(JSON.stringify({ ...data, metadata: { attributions: ['Example weather data'] } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const request: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  };
  const botDir = mkdtempSync(join(tmpdir(), 'weather-extension-'));
  const cfg: RealtimeWeatherConfigSection = { ...REALTIME_WEATHER_DEFAULTS, apiHost: 'example.qweatherapi.com', location: { id: 'example-city', name: 'PRIVATE_LOCATION', country: 'Example', province: 'North', city: 'District', latitude: 42.33, longitude: 101.12 } };
  let restarts = 0;
  const context: WorldContext<RealtimeWeatherConfigSection> = { id: 'realtime-weather', cfg, timezone, botName: 'example', botDir, dataDir: botDir, repoRoot: botDir, packageDir: botDir, secret: () => 'PRIVATE_KEY', storeSecret: () => {}, persist: patch => { Object.assign(cfg, patch); }, restart: async () => { restarts++; } };
  const events: EventEnvelope[] = [];
  const deferred: Parameters<WorldHost['pushDeferred']>[0][] = [];
  const materialize = async (spec: Parameters<WorldHost['pushDeferred']>[0]) => {
    const rendered = await spec.render();
    if (rendered === null) return;
    events.push({ type: spec.type, source: 'realtime-weather', senderKey: spec.senderKey,
      origin: spec.origin ?? 'external', ts: new Date(now).toISOString(), cursor: events.length + 1,
      text: typeof rendered === 'string' ? rendered : rendered.text });
  };
  const host = {
    pushEvent: async (e: EventEnvelope) => { events.push(e); return e; },
    pushDeferred: (spec: Parameters<WorldHost['pushDeferred']>[0]) => {
      if (deferEvents) deferred.push(spec); else void materialize(spec);
    },
    log: { warn: () => {} },
  } as unknown as WorldHost;
  const world = new RealtimeWeatherWorld(context, { request, now: () => now, openFile: async () => {}, random: () => 0 });
  return { world, host, events, cfg, context, request, counts, errors, holds, headerKeys, botDir,
    async flushDeferred() { for (const spec of deferred.splice(0)) await materialize(spec); },
    get now() { return now; }, set now(value: number) { now = value; },
    get current() { return current; }, set current(value) { current = value; },
    get hours() { return hours; }, set hours(value) { hours = value; },
    get days() { return days; }, set days(value) { days = value; },
    get alerts() { return alerts; }, set alerts(value) { alerts = value; },
    get air() { return air; }, set air(value) { air = value; },
    get restarts() { return restarts; },
    async close() { await world.stop(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(botDir, { recursive: true, force: true }); },
  };
}
