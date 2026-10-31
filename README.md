<!-- Owner: src/definition.ts, src/config.ts, src/world.ts, src/ambience.ts, src/ambience.schema.json -->
# 实时天气

Cortico World扩展，使用QWeather获取天气、空气质量、官方预警及预报。要求Node.js 22以上及World API 6。

## 配置

1. 从WebUI扩展页安装本包，在“实时天气”中填写QWeather控制台提供的API Host。
2. “打开密钥文件”，在部署`.env`中填写`CORTICO_QWEATHER_API_KEY`并保存。
3. 搜索城市，选择国家、省州和城市相符的结果；区级行政区可选。重名时可填写上级行政区（adm）和国家或地区代码（range，如 cn、au）缩小范围；留空不限制，最多返回20个候选。
4. 启用World，“测试连接”显示各接口状态和耗时。

密钥注册入口：https://id.qweather.com/ 。创建项目、添加API KEY凭据，API Host在控制台设置中查看。账号需要有对应接口的访问权限；HTTP错误在面板中显示。

## 查询与事件

- 启动立即查询并投递一条合并通知，包含实况、空气质量、有效预警、未来两小时与多日预报，同时建立变化基线。启动摘要通过`pushDeferred`排队，在实际投递时落库，暂时避开Core启动补投对已排队事件的重复入队；若投递前进程退出，排队摘要不保留，下次启动重新查询。
- 实况每15分钟一轮：每轮查天气与预警，每4轮查空气质量。其余轮次使用缓存的空气质量并显示原时间。每轮至多一条合并变化事件。
- 预报每小时一轮：合并未来第1、第2小时和默认7天的逐日预报。明天天气取逐日项，可在配置中选择1至10天。
- 每天按已保存的地点时区08:00查询并投递完整的未来两小时与多日预报，不要求预报发生变化；停机错过的时点不补发。与小时轮询的在途请求重叠时合并为一条完整预报；完整预报刷新已播报时段的数值基线。普通逐日通知同样刷新已展示的UV、温度极值、风力范围和最高降水概率；最低或最高温缺失导致温度段未展示时，两项温度基线均保留。
- 日出日落按代表坐标本地计算并定时投递，不补报停机期间错过的事件。极昼极夜没有对应事件。
- `realtime_weather_current`返回合并实况；`realtime_weather_forecast`返回合并预报。工具等待查询完成，实况缓存15分钟、预报缓存1小时，请求超时10秒。

温度/体感变化默认3°C，风力变化2级，能见度跨越1 km，UV相对上次提醒基线累计升降达到3时提醒，等级仅用于展示和选句；空气质量跨等级时双向提醒。降水类型、雨雪强度、晴阴转换和预警生命周期变化也会触发。预报降水概率变化阈值为30个百分点。逐日风力比较回执中的最低/最高风力，降水概率比较昼夜最高值，不按未展示的昼夜分项触发。阈值在配置页修改，下次轮询使用新值。

第三小时尚未进入展示窗口时保留原比较基线，进入未来两小时范围后再判断变化。逐小时与逐日预报都按配置的温差阈值提醒；不单独提醒预测温度微调。

实况时间表示查询时间；预报行时间是预报有效时刻。失败时保留最近成功数据并标明沿用时间，主动工具可立即重试。内部使用UTC；回执时间、氛围时段与日出日落采用地点当地时间，每日08:00预报调度采用已保存的地点时区。地点时区在选择城市时随地点保存，取自城市搜索结果，不随部署机器的时区变化；部署时区默认跟随系统。选择城市时不保存Location ID；v0.1.0配置中已有的编号不再使用，重新选择城市后移除。地点配置缺少时区时不启动查询，配置页、状态灯和工具提示重新选择城市，不退回部署时区。逐日预报保留接口返回的天气地点日历日期。缺失字段不当作零，也不清除累计变化基线。

启动摘要在实际投递时使用最新轮询缓存生成，各项数据保留查询时间。氛围起手的暮色时段采用地点日落至民用暮光结束；日落前仍采用日间文案。

## 文案文件

- 包内默认：`src/ambience.default.json`。
- 部署覆盖：`<部署目录>/worlds/realtime-weather/ambience.json`。
- 配置页“打开文案JSON”创建并打开部署覆盖文件。保存后自动重载；“恢复默认”覆盖部署文件并立即重载。
- 文件不存在、JSON语法或结构错误时，整份使用包内默认文案，损坏文件保持原样。面板显示原因。

默认词句取自操作者提供的demo及补充词库。方括号内为可采用的氛围叙述；数据段独立列出查询事实。未覆盖的场景只输出数据。

JSON契约见`src/ambience.schema.json`。`rules`中的`part`为`opening`（起手）、`body`（后半句）或`complete`（独立句）；`when`中的标签必须全部匹配。最高`priority`的候选随机选一条，`texts: []`保留接口而不输出文案。`complete`优先；没有匹配后半句时不输出起手。

预警变化的后半句由`when`中的`alert*`标签识别，独立选取一条，使用预报起手拼在普通天气氛围句末尾。普通天气和预警各自选句，互不竞争；整段仍放在同一对方括号内。数据段保留全部变化。

预警类型用`{alertType}`占位，填入该条文案对应的预警变化类型；同类变化涉及多个类型时用顿号连接。类型来自归一化名称，未映射类型为“气象”，不读取预警原文。

夜间厚云句要求当前为多云或阴（`thickCloud`）；夜间云量减少使用独立句，白昼才使用“亮堂”句。日落燥热句要求当前高温（`hot`）。

可用于补充词库的标签：

- 查询：`current`、`forecast`、`active`、`passive`。
- 当地时段：05:00–08:00为`morning`，05:00前为`lateNight`；08:00以后按地点计算，日落前为`day`，日落至民用暮光结束为`evening`，之后至23:30为`night`，再后为`lateNight`。极昼的08:00以后使用`day`，极夜不使用`evening`。`daylight`/`dark`按太阳位置判断。
- 静态天气：`clear`、`cloudy`、`lightRain`、`heavyRain`、`lightSnow`、`heavySnow`、`mixed`、`thunder`、`fog`、`polluted`、`windy`、`freezing`、`hot`、`humidHot`。
- 变化：`becameClear`、`becameCloudy`、`conditionChanged`、`rainStarted`、`rainStopped`、`rainStronger`、`rainWeaker`、`snowStarted`、`snowStopped`、`snowStronger`、`snowWeaker`、`rainToSnow`、`snowToRain`、`precipitationChanged`、`temperatureUp/Down`、`feelsLikeUp/Down`、`windUp/Down`、`visibilityUp/Down`、`uvUp/Down`、`airUp/Down`、`probabilityUp/Down`。`Up/Down`各为独立标签。被动事件只向文案提供本轮变化标签。
- UV补充条件：`highUv` ≥7、`lowUv` ≤2。空气改善补充条件`clearerAir`表示当前AQI达到对应标准的良好类别，且能见度高于本段污染开始时；中间改善轮次不前移该基线。
- 通用空气改善句使用 `goodAir` 和 `clearAirWeather`（当前晴或云类天气），不限制视程是否提升；当前仍为霾、沙尘或雾时不套开窗句。
- 冰粒或冻雨转为无降水生成 `precipitationStopped`，使用特殊降水停止句；此前降水类型未知时只说明当前无降水。
- 空气改善中的霾散句还要求 `hazeClearedSinceAirBaseline`：空气变化基线时确有霾，当前已转为晴或云类天气。AQI改善到良好/低风险及视程提升仍须同时满足。
- 能见度雾气文案要求当前`waterFog`或上次`wasWaterFog`：对应时点的天气代码为雾、能见度低于2 km且该时点空气质量低于对应标准的较高风险等级。雾散句还要求当前不再是雾代码；未满足时使用默认的能见度句。空气变差文案根据`visibilityFell`或`visibilityNotFallen`选择对应句子。
- `strongWind`表示风力升高后达到5级，供被动大风句使用。
- 预警：`alertAdded`、`alertUpgraded`、`alertUpdated`、`alertDowngraded`、`alertCancelled`、`alertRemoved`、`alertExpired`。
- 预报：`forecastRain`、`forecastCold`、`forecastWarm`、`forecastDailyWarm`、`forecastWet`、`forecastClear`、`forecastStable`、`forecastMild`。近期降雨要求未来两小时内降雨概率>70%；近期冷暖比较这两小时与当前气温，逐日冷暖比较相邻日期的最低/最高温；逐日降温使用独立标签`forecastDailyCold`，没有匹配文案时只输出数据，不套近期降温句。连续晴雨要求从明天起至少连续两日符合，晴天允许夜间多云，阴雨要求每天至少一个昼夜时段为雨。被动文案只匹配实际变化的时段、日期和气象字段。
- `forecastStable`要求完整未来两小时均无降水、降水概率<30%、风力<5级、晴或多云、气温与当前相差不足温度阈值；`forecastMild`还要求已有的三小时数据和当前温度都在15–25°C。未取得当前天气时不输出平稳文案。
- 天文：`sunrise`、`sunset`、`cloudyOrWet`、`calm`。

补充标签：

- 静态：`thinFog`（薄雾代码且能见度≥2 km）、`lightHaze`（霾代码502）、`lightDust`（扬沙/浮尘代码503/504）。轻霾句另需`notSeverelyPolluted`。
- 雨雪转换：`mixedStarted`、`mixedStopped`、`snowToMixed`、`mixedToSnow`。
- 一般天气变化：`cloudIncreased`、`cloudDecreased`、`thunderStarted`、`thunderStopped`、`thunderToRain`、`hazeStarted`、`hazeCleared`、`dustStarted`、`dustCleared`。霾/沙尘消退句只用于转为晴或云天气。
- 空气与风：`moderateWind`（3–4级）、`goodAir`、`pollutedAir`、`airWithoutClearerView`。空气分类按标准代码和等级映射，18套标准的文案边界见[分类表](docs/air-quality.md)，不按名称或统一数值阈值比较。
- 近期预报：`forecastWindUp/Down`、`forecastVisibilityUp/Down`、`forecastUvUp/Down`、`forecastRainWeaker`、`forecastRainStopped`、`forecastSnowStarted`、`forecastSnowStronger`、`forecastSnowWeaker`、`forecastSnowStopped`。根据实况至未来第1、第2小时的顺序比较；被动提醒还要求相应预报时段的对应字段发生修订。UV增强句要求未来UV≥7；雨/雪减弱及停止句要求当前正在下对应降水。含“待会儿”的句子不用于远日预报。
- 逐日：`forecastDailyWarm`要求未来至少连续三天最低温、最高温均逐日上涨，累计达到温差阈值；`forecastDailyWarmFromTomorrow`还要求这段从明天开始且明天高于今天的逐日极值。

`unsupportedNowcast`对应未接入的分钟级雨停句。本扩展不新增分钟级接口；本轮雨停预报使用现有逐时数据。

## 信息边界

地区名称和代表坐标仅供服务端及设置页使用，工具、事件与提示词不输出坐标或地点名称。原始预警可能含地名，只在WebUI显示；模型收到归一化的类型、等级和时间。部分未映射的官方类型显示“气象预警”，原文仍可查看。空气质量使用AQI标准。

QWeather收到查询坐标。其他能读取部署config的工具仍可读取地区配置。天气预警基于行政区代表点。

## 开发

`pnpm install`，然后执行`pnpm test`、`pnpm run typecheck`、`pnpm run typecheck:web`及`pnpm run build:web`。测试只连接本机HTTP服务，不访问真实QWeather。

在Cortico检出中执行`pnpm describe:extension <包目录>`和`pnpm check:extension <包目录>`生成自描述并检查契约。实际权限和请求耗时需配置凭据后由面板手动测试；开发验证不启动真实bot。
