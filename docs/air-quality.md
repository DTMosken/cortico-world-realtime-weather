<!-- Owner: src/air-quality.ts -->
# AQI分类与文案

类别名称按QWeather官方[支持表](https://dev.qweather.com/en/docs/api/air-quality/aqi-list/)及其[中英文CSV](https://raw.githubusercontent.com/qwd/dev-site/master/assets/table/aqis.csv)的标准代码和等级查表；不把响应中的自由文本带入回执。表内涵盖18套标准。数值和等级只在相同标准内比较。

下表是扩展选择现有文案的边界，不是不同AQI之间的数值换算或统一健康等级。良好条件匹配优良/低风险/正常类别；日本蓝青绿归于注意等级以下。污染条件从明确不良、偏高、注意或高风险类别开始；中等/一般通常保持中性。较高风险用于排除轻霾/水雾句，并允许已有污染静态句；各标准边界单独列出。

| 标准 | 良好最大等级 | 污染起始等级 | 较高风险起始等级 |
|---|---:|---:|---:|
| qaqi | 2 | 4 | 4 |
| cn-mee / cn-mee-1h | 2 | 3 | 4 |
| hk-epd | 1 | 3 | 3 |
| mo-smg | 1 | 3 | 4 |
| tw-me / tw-me-1h | 1 | 3 | 4 |
| us-epa / us-epa-nc | 1 | 3 | 4 |
| eu-eea | 2 | 4 | 4 |
| fr-atmo | 1 | 3 | 4 |
| kr-moe | 1 | 3 | 3 |
| jp-moe | 3 | 4 | 5 |
| gb-defra / ca-eccc | 1 | 3 | 3 |
| sg-nea | 1 | 3 | 3 |
| sg-nea-pm1h | 1 | 2 | 3 |
| th-pcd | 2 | 4 | 4 |

未知标准或未列出的等级仍显示数值和等级，不选择依赖空气分类的文案。请求优先使用响应中的当地AQI，没有当地AQI时使用QAQI。空气改善、视程和天气现象的组合条件仍由world.ts决定；分类不证明当前霾已消退。
