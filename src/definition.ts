import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { REALTIME_WEATHER_DEFAULTS, type RealtimeWeatherConfigSection } from './config.ts';
import { REALTIME_WEATHER_TOOL_DECLS, RealtimeWeatherWorld } from './world.ts';

export const REALTIME_WEATHER: WorldDefinition<RealtimeWeatherConfigSection> = {
  id: 'realtime-weather', label: '实时天气',
  defaults: () => ({ ...REALTIME_WEATHER_DEFAULTS }),
  create: ctx => new RealtimeWeatherWorld(ctx),
  describe: {
    tools: describeTools(REALTIME_WEATHER_TOOL_DECLS, {}),
    events: [
      { type: 'realtime-weather.summary', description: '启动时的实况、空气质量、有效预警及完整预报。' },
      { type: 'realtime-weather.changed', description: '天气、空气质量或官方预警发生变化。' },
      { type: 'realtime-weather.forecast', description: '按配置时间投递的每日完整预报，或未来两小时、多日预报的显著变化。' },
      { type: 'realtime-weather.solar', description: '到达配置地点的日出或日落时刻。' },
    ],
  },
};
