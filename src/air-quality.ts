import type { Air } from './model.ts';

interface AirStandard {
  categories: readonly string[];
  goodMax: number;
  pollutedMin: number;
  highMin: number;
}
const cn = ['优', '良', '轻度污染', '中度污染', '重度污染', '严重污染'];
const tw = ['良好', '普通', '对敏感人群不健康', '对所有人群不健康', '非常不健康', '危害'];
const us = ['好', '中等', '不适于敏感人群', '不健康', '非常不健康', '危险'];

// Official category names: https://dev.qweather.com/en/docs/api/air-quality/aqi-list/
// Prose boundaries are extension policy; see docs/air-quality.md.
const STANDARDS: Record<string, AirStandard> = {
  'qaqi': { categories: ['优', '良', '中等', '差', '很差', '极差'], goodMax: 2, pollutedMin: 4, highMin: 4 },
  'cn-mee': { categories: cn, goodMax: 2, pollutedMin: 3, highMin: 4 },
  'cn-mee-1h': { categories: cn, goodMax: 2, pollutedMin: 3, highMin: 4 },
  'hk-epd': { categories: ['低', '中', '高', '甚高', '严重'], goodMax: 1, pollutedMin: 3, highMin: 3 },
  'mo-smg': { categories: ['良好', '普通', '不良', '非常不良', '严重', '有害'], goodMax: 1, pollutedMin: 3, highMin: 4 },
  'tw-me': { categories: tw, goodMax: 1, pollutedMin: 3, highMin: 4 },
  'tw-me-1h': { categories: tw, goodMax: 1, pollutedMin: 3, highMin: 4 },
  'us-epa': { categories: us, goodMax: 1, pollutedMin: 3, highMin: 4 },
  'us-epa-nc': { categories: us, goodMax: 1, pollutedMin: 3, highMin: 4 },
  'eu-eea': { categories: ['优', '良', '中', '差', '很差', '极差'], goodMax: 2, pollutedMin: 4, highMin: 4 },
  'fr-atmo': { categories: ['好', '一般', '不好', '差', '很差', '极差'], goodMax: 1, pollutedMin: 3, highMin: 4 },
  'kr-moe': { categories: ['好', '中等', '不健康', '非常不健康'], goodMax: 1, pollutedMin: 3, highMin: 3 },
  'jp-moe': { categories: ['蓝色', '青色', '绿色', '黄色/注意', '橙色/警报', '红色/严重警报'], goodMax: 3, pollutedMin: 4, highMin: 5 },
  'gb-defra': { categories: ['低', '中', '高', '严重'], goodMax: 1, pollutedMin: 3, highMin: 3 },
  'ca-eccc': { categories: ['低风险', '中风险', '高风险', '极高风险'], goodMax: 1, pollutedMin: 3, highMin: 3 },
  'sg-nea': { categories: ['良好水平', '适中水平', '不健康水平', '非常不健康水平', '危险水平'], goodMax: 1, pollutedMin: 3, highMin: 3 },
  'sg-nea-pm1h': { categories: ['等级1 (正常)', '等级2 (偏高)', '等级3 (高)', '等级4 (非常高)'], goodMax: 1, pollutedMin: 2, highMin: 3 },
  'th-pcd': { categories: ['优秀', '良好', '中等', '不健康', '非常不健康'], goodMax: 2, pollutedMin: 4, highMin: 4 },
};

export function airCategory(standard: string, level: number): string {
  return STANDARDS[standard]?.categories[level - 1] ?? `等级${level}`;
}
function standardFor(air: Air): AirStandard | undefined {
  const standard = STANDARDS[air.standard];
  return standard?.categories[air.level - 1] ? standard : undefined;
}
export function goodAir(air: Air): boolean {
  const standard = standardFor(air);
  return !!standard && air.level <= standard.goodMax;
}
export function pollutedAir(air: Air): boolean {
  const standard = standardFor(air);
  return !!standard && air.level >= standard.pollutedMin;
}
export function highAirRisk(air: Air): boolean {
  const standard = standardFor(air);
  return !!standard && air.level >= standard.highMin;
}
export function lowerAirRisk(air: Air): boolean {
  const standard = standardFor(air);
  return !!standard && air.level < standard.highMin;
}
