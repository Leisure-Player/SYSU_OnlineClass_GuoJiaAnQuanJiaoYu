// ==UserScript==
// @name         LMS Video Auto Next (Commented)
// @namespace    https://test.top/
// @version      1.2.1
// @description  视频页自动监测与跳转；测验页只做提示，不自动作答
// @author       ChatGPT
// @match        https://lms.sysu.edu.cn/mod/*/view.php*
// @match        https://lms.sysu.edu.cn/mod/forum/discuss.php*
// @match        https://lms.sysu.edu.cn/mod/quiz/attempt.php*
// @match        https://lms.sysu.edu.cn/mod/quiz/summary.php*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      lms.sysu.edu.cn
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.2.1';

  // 面板展示文案统一放在这里，后面改字更方便。
  const TEXT = {
    panelTitle: 'LMS Auto Next',
    version: '脚本版本',
    collapse: '收起',
    expand: '展开',
    dryRunOn: 'dryRun: ON',
    dryRunOff: 'dryRun: OFF',
    rescan: '重新扫描',
    toggleReal: '切到实点模式',
    toggleDryRun: '切回 dryRun',
    testNext: '测试下一节',
    exportLogs: '导出日志',
    clearLogs: '清空日志',
    resetAll: '从零重置',
    title: '课程标题',
    pageType: '当前页面',
    videoSelector: '视频选择器',
    nextSelector: '下一节选择器',
    progressInfo: '进度信息',
    playbackRate: '播放倍速',
    currentStatus: '当前状态',
    nextTarget: '跳转目标',
    logCount: '日志数量',
    recentLogs: '最近日志',
    notFound: '未找到',
    noVideo: '无视频',
    noLogs: '暂无日志',
    oldDataCleared: '旧数据已清空，页面即将刷新。',
    modeDryRun: 'dryRun',
    modeRealClick: 'real-click',
    videoFound: '已识别',
    videoMissing: '未识别',
    nextFound: '已识别',
    nextMissing: '未识别',
    pageVideo: '视频页',
    pageQuizView: '测验说明页',
    pageQuizAttempt: '测验作答页',
    pageQuizSummary: '测验提交页',
    pageActivity: '其他活动页',
    pageOther: '其他页面',
    nextSource: '下一项来源',
    nextKind: '下一项类型',
    kindVideo: '视频',
    kindQuiz: '测验',
    kindForum: '讨论',
    kindOther: '其他活动',
    quizNoticeTitle: '测验提示',
    quizNoticeBody: '已检测到章节测验页。脚本不会自动作答、自动选项或自动提交，请手动完成。',
    autoplayState: '自动续播',
    autoplayPending: '等待续播',
    autoplayActive: '续播中',
    autoplayRecovering: '恢复播放中',
    autoplayIdle: '未触发',
    playbackRateIdle: '未检测',
    reminderAcknowledge: '知道了',
    rateReminderTitle: '倍速冲突提醒',
  };

  // 所有可调整参数集中放在 CONFIG 里。
  const CONFIG = {
    // 默认先用 dryRun，只记录不真正跳转。
    dryRun: true,
    // 是否允许按播放进度兜底跳下一节。
    // 当前站点播放器偶尔会上报异常进度，所以默认关闭，只依赖 ended 事件。
    allowProgressFallback: false,
    // 下面两个值只在 allowProgressFallback=true 时才生效。
    completeRatio: 0.9995,
    completeRemainingSeconds: 0.8,
    // 即便播放器误报 ended，也只有真的接近片尾才允许自动跳页。
    verifiedEndRatio: 0.985,
    verifiedEndRemainingSeconds: 2.5,
    // 定时采样间隔。
    sampleIntervalMs: 4000,
    // 防重复跳转锁，避免一次结束触发多次跳页。
    clickLockMs: 15000,
    // 路由切换后的等待时间，给页面一点渲染时间。
    routeSettleMs: 1200,
    // DOM 变化后的防抖时间。
    mutationDebounceMs: 1000,
    // 最多保留多少条日志。
    maxLogs: 1000,
    // 面板中最近日志的展示条数。
    recentLogsLimit: 6,

    // 自动跳到下一页后，尝试继续播放下一段视频。
    autoPlay: {
      enabled: true,
      initialDelayMs: 700,
      retryDelayMs: 1500,
      openPageInitialDelayMs: 300,
      maxAttempts: 5,
      pendingExpiryMs: 1800000,
    },

    // 视频播放过程中如果被意外暂停，尝试自动恢复播放。
    pauseRecovery: {
      enabled: true,
      initialDelayMs: 1200,
      retryDelayMs: 2200,
      maxAttempts: 3,
      userIntentWindowMs: 1800,
      nearEndSeconds: 1.2,
    },

    // 尽量把播放倍速锁定在 1 倍速，防止别的插件把倍速偷偷改掉。
    playbackRateLock: {
      enabled: true,
      target: 1,
      tolerance: 0.01,
      verifyDelayMs: 220,
      conflictWindowMs: 15000,
      reminderThreshold: 4,
      reminderCooldownMs: 120000,
    },

    // 测验页提醒配置。
    quizReminder: {
      enabled: true,
      beepCount: 3,
      beepIntervalMs: 700,
      beepDurationMs: 220,
      beepFrequency: 880,
    },

    // 讨论页不需要人工停留时，自动跳过到下一项视频。
    forumSkip: {
      enabled: true,
      delayMs: 800,
    },

    // 关键元素选择器。
    selectors: {
      video: [
        '#fsplayer-container-id_html5_api',
        '.video-js video',
        '.tcplayer video',
        '#fsplayer-container-id',
        '#player-con video',
        'video',
      ],
      nextButton: [
        '#next-activity-link',
        '.activity-navigation a#next-activity-link',
        '.activity-navigation a[rel="next"]',
        'a[rel="next"][href*="/mod/"]',
      ],
      // 页面里可能直接包含课程结构（课程索引、导航块、课程主页内容）。
      courseStructure: [
        '#courseindex',
        '.courseindex',
        '#coursecontent',
        '.course-content',
        'ul.topics',
        'ul.weeks',
        'ul.sections',
        '.block_navigation',
        '.block_course_contents',
        '.section-navigation',
        '.course-section-navigation',
        '.block_tree',
      ],
      title: [
        'h1',
        'h2',
        '.activity-information[data-activityname]',
        '[data-activityname]',
      ],
      progress: [
        '.activity-information',
        '[data-region="activity-information"]',
        '[class*="progress"]',
      ],
    },

    // 哪些活动模块可能承载视频，用于在非 fsresource 页面继续识别与续播。
    videoCapableMods: [
      'fsresource',
      'videofile',
      'video',
      'videos',
      'vod',
      'recordings',
      'page',
      'resource',
      'url',
      'folder',
      'scorm',
      'lesson',
      'hvp',
      'h5pactivity',
    ],

    // 页面没有“下一节”按钮时，从课程结构里解析下一项。
    courseScan: {
      enabled: true,
      fetchTimeoutMs: 8000,
      cacheTtlMs: 600000,
    },

    // 播放器可能异步创建 video 元素，短时间内轮询等待。
    videoProbe: {
      enabled: true,
      intervalMs: 2000,
      maxAttempts: 15,
    },

    // 当显式选择器找不到下一节时，用这些关键词做兜底匹配。
    nextKeywords: [
      '下一节',
      '下一课',
      '下一章',
      '下一项',
      '下一个',
      '下一活动',
      '下一项活动',
      '下一个活动',
      '下一段',
      '下一讲',
      '下一步',
      '继续学习',
      '继续播放',
      '继续',
      'next activity',
      'next item',
      'next',
      'continue',
      '前进',
    ],

    negativeKeywords: [
      '上一节',
      '上一课',
      '上一章',
      '上一项',
      '上一个',
      '上一活动',
      '上一步',
      '返回',
      '回到课程',
      '课程主页',
      'back',
      'prev',
      'previous',
      '上页',
    ],

    // 脚本自己的存储键。
    storageKeys: {
      logs: '__lms_autonext_logs_v1__',
      settings: '__lms_autonext_settings_v1__',
      bootstrap: '__lms_autonext_bootstrap_v1__',
      pendingAutoplay: '__lms_autonext_pending_autoplay_v1__',
    },

    // 旧版本遗留键，首次运行时会清掉。
    legacyKeys: [
      '__tm_course_probe_logs_v1__',
      '__tm_course_probe_selectors_v1__',
      '__tm_course_probe_settings_v1__',
    ],

    panelId: 'tm-lms-autonext-panel',
  };

  // 运行时状态集中管理。
  const state = {
    pageType: 'other',
    panelCollapsed: false,
    panel: null,
    panelBody: null,
    currentVideo: null,
    hookedVideo: null,
    currentNextButton: null,
    currentNextButtonSource: '',
    lastResolvedNext: null,
    nextResolving: false,
    nextPrefetchUrl: '',
    courseActivityCache: Object.create(null),
    courseScanInFlight: null,
    currentTitle: null,
    currentProgress: null,
    videoListeners: [],
    sampleTimer: null,
    mutationTimer: null,
    autoplayTimer: null,
    pauseResumeTimer: null,
    forumSkipTimer: null,
    forumSkipRunning: false,
    videoProbeTimer: null,
    videoProbeAttempts: 0,
    videoProbePageKey: '',
    autoPlayOnOpenDone: false,
    autoplayAttempts: 0,
    pauseResumeAttempts: 0,
    autoplayStateText: TEXT.autoplayIdle,
    playbackRateStatusText: TEXT.playbackRateIdle,
    nextLockUntil: 0,
    observer: null,
    lastRouteUrl: location.href,
    lastStatusText: '',
    lastQuizReminderUrl: '',
    lastRateReminderUrl: '',
    lastRateReminderAt: 0,
    lastUserPauseIntentAt: 0,
    lastSkipTargetSource: '',
    playbackRateVerifyTimer: null,
    playbackRateConflictCount: 0,
    playbackRateConflictWindowStartedAt: 0,
  };

  // 启动脚本。
  bootstrap();
  init();

  // 第一次运行时清理旧版本数据，避免脏状态影响新逻辑。
  function bootstrap() {
    const boot = storageGet(CONFIG.storageKeys.bootstrap, null);
    if (boot === 'done') {
      const settings = storageGet(CONFIG.storageKeys.settings, null);
      if (settings && typeof settings.dryRun === 'boolean') {
        CONFIG.dryRun = settings.dryRun;
      }
      if (settings && typeof settings.panelCollapsed === 'boolean') {
        state.panelCollapsed = settings.panelCollapsed;
      }
      return;
    }

    for (const key of CONFIG.legacyKeys) {
      storageDelete(key);
    }

    storageDelete(CONFIG.storageKeys.logs);
    storageSet(CONFIG.storageKeys.settings, {
      dryRun: CONFIG.dryRun,
      panelCollapsed: state.panelCollapsed,
    });
    storageSet(CONFIG.storageKeys.bootstrap, 'done');
  }

  function saveSettings() {
    storageSet(CONFIG.storageKeys.settings, {
      dryRun: CONFIG.dryRun,
      panelCollapsed: state.panelCollapsed,
    });
  }

  // 主初始化流程。
  function init() {
    installStyle();
    createPanel();
    bindPanelEvents();
    patchHistory();
    bindRouteEvents();
    observeDom();
    scanPage('init');
    logEvent('script.init', {
      url: location.href,
      title: document.title,
      dryRun: CONFIG.dryRun,
    });
  }

  // 根据 URL 判断当前页面类型。
  function detectPageType() {
    const path = location.pathname;
    if (path.includes('/mod/fsresource/view.php')) return 'video';
    if (path.includes('/mod/forum/view.php')) return 'forum-view';
    if (path.includes('/mod/forum/discuss.php')) return 'forum-discuss';
    if (path.includes('/mod/quiz/view.php')) return 'quiz-view';
    if (path.includes('/mod/quiz/attempt.php')) return 'quiz-attempt';
    if (path.includes('/mod/quiz/summary.php')) return 'quiz-summary';
    if (/\/mod\/[^/]+\/view\.php/.test(path)) return 'activity';
    return 'other';
  }

  function isQuizPage() {
    return state.pageType.startsWith('quiz');
  }

  function isDiscussionPage() {
    return state.pageType === 'forum-view' || state.pageType === 'forum-discuss';
  }

  // 每次扫描都重新识别页面类型和关键节点。
  // 注意：只有视频元素真的发生变化时才重建监听，避免页面轻微变化把
  // 自动续播/暂停恢复/结束监听全部拆掉重来。
  function scanPage(reason) {
    const previousPageType = state.pageType;
    state.pageType = detectPageType();
    resetResolvedNodes();

    // 测验页只做提示，不做答题相关自动化。
    if (isQuizPage()) {
      stopVideoTracking();
      consumePendingArrival();
      state.lastStatusText = buildStatusText();
      updatePanel();
      maybeShowQuizReminder();
      logEvent('quiz.detected', {
        reason,
        pageType: state.pageType,
        url: location.href,
      });
      return;
    }

    consumePendingArrival();

    const nextTarget = findNextTargetSync();
    state.currentNextButton = nextTarget?.element || null;
    state.currentNextButtonSource = nextTarget?.source || '';
    if (nextTarget && (nextTarget.href || nextTarget.text)) {
      state.lastResolvedNext = nextTarget;
    }
    state.currentTitle = findTitleElement();
    state.currentProgress = findProgressElement();

    // 讨论页命中后直接准备跳过，不进入视频监听逻辑。
    if (isDiscussionPage()) {
      stopVideoTracking();
      state.lastStatusText = buildStatusText();
      updatePanel();
      logEvent('forum.detected', {
        reason,
        pageType: state.pageType,
        url: location.href,
        foundNextButton: !!state.currentNextButton,
      });
      maybeSkipDiscussionPage(reason);
      return;
    }

    // 只在可能承载视频的活动页启用视频监听，避免作业页里的说明视频
    // 结束后被误当成课程视频自动跳转。
    state.currentVideo = isVideoCapablePage() ? findVideo() : null;

    if (previousPageType !== state.pageType || state.hookedVideo !== state.currentVideo) {
      clearVideoHooks();
      if (state.currentVideo) {
        attachVideoHooks(state.currentVideo);
      }
    }

    if (state.currentVideo) {
      resetVideoProbe();
      enforcePlaybackRateLock('video-detected', {
        skipLogIfStable: true,
      });
      const resumedFromContext = maybeResumePlaybackAfterJump();
      if (!resumedFromContext) {
        maybeAutoPlayOnVideoPageOpen();
      }
    } else {
      scheduleVideoProbe(reason);
    }

    if (!state.currentNextButton && isVideoCapablePage() && state.nextPrefetchUrl !== location.href) {
      state.nextPrefetchUrl = location.href;
      primeNextTarget();
    }

    state.lastStatusText = buildStatusText();
    updatePanel();
    logEvent('scan.complete', {
      reason,
      found: {
        video: !!state.currentVideo,
        nextButton: !!state.currentNextButton,
        nextSource: state.currentNextButtonSource,
        title: !!state.currentTitle,
        progress: !!state.currentProgress,
      },
    });
  }

  function resetResolvedNodes() {
    state.currentVideo = null;
    state.currentNextButton = null;
    state.currentNextButtonSource = '';
    state.currentTitle = null;
    state.currentProgress = null;
  }

  function getModTypeFromPath(path) {
    const match = /\/mod\/([^/]+)\//.exec(String(path || ''));
    return match ? match[1].toLowerCase() : '';
  }

  function isVideoCapablePage() {
    if (state.pageType === 'video') return true;
    if (state.pageType !== 'activity') return false;
    return CONFIG.videoCapableMods.includes(getModTypeFromPath(location.pathname));
  }

  // 离开视频页/切换到测验或讨论页时，彻底停掉视频相关监听。
  function stopVideoTracking() {
    if (state.hookedVideo ||
      state.videoListeners.length ||
      state.sampleTimer ||
      state.autoplayTimer ||
      state.pauseResumeTimer) {
      clearVideoHooks();
    }
    state.currentVideo = null;
    resetVideoProbe();
  }

  // 播放器可能是异步创建的，找不到 video 时短暂轮询等待。
  function scheduleVideoProbe(reason) {
    if (!CONFIG.videoProbe.enabled || !isVideoCapablePage()) {
      resetVideoProbe();
      return;
    }

    if (state.currentVideo) {
      resetVideoProbe();
      return;
    }

    if (state.videoProbeTimer) return;

    if (state.videoProbePageKey !== location.href) {
      state.videoProbePageKey = location.href;
      state.videoProbeAttempts = 0;
    }

    if (state.videoProbeAttempts >= CONFIG.videoProbe.maxAttempts) return;

    state.videoProbeTimer = setTimeout(() => {
      state.videoProbeTimer = null;
      state.videoProbeAttempts += 1;
      logEvent('video.probe', {
        reason,
        attempt: state.videoProbeAttempts,
        modType: getModTypeFromPath(location.pathname),
      });
      scanPage('video-probe');
    }, CONFIG.videoProbe.intervalMs);
  }

  function resetVideoProbe() {
    if (state.videoProbeTimer) {
      clearTimeout(state.videoProbeTimer);
      state.videoProbeTimer = null;
    }
    state.videoProbeAttempts = 0;
    state.videoProbePageKey = location.href;
  }

  // 识别视频元素。除了主文档，也会扫描同源 iframe；优先选择正在播放、
  // 可见面积最大的 video，避免误选隐藏的播放器实例。
  function findVideo() {
    const videos = [];
    for (const doc of getCandidateDocuments()) {
      let found = [];
      try {
        found = Array.from(doc.querySelectorAll('video'));
      } catch (_) {
        continue;
      }
      for (const video of found) {
        if (!videos.includes(video)) videos.push(video);
      }
    }

    if (!videos.length) return null;

    const best = videos
      .map((video) => ({ video, score: scoreVideoCandidate(video) }))
      .sort((a, b) => b.score - a.score)[0];
    return best ? best.video : null;
  }

  function getCandidateDocuments() {
    const docs = [document];
    const visit = (doc, depth) => {
      if (!doc || depth > 2) return;
      let frames = [];
      try {
        frames = Array.from(doc.querySelectorAll('iframe, frame'));
      } catch (_) {
        return;
      }

      for (const frame of frames) {
        try {
          const child = frame.contentDocument;
          if (child && child.documentElement && !docs.includes(child)) {
            docs.push(child);
            visit(child, depth + 1);
          }
        } catch (_) {}
      }
    };

    visit(document, 0);
    return docs;
  }

  function scoreVideoCandidate(video) {
    if (!video) return -1;

    let score = 0;
    if (!video.paused && !video.ended) score += 100;
    if (video.ended) score -= 20;
    if (isVisible(video)) score += 20;

    const rect = video.getBoundingClientRect ? video.getBoundingClientRect() : null;
    if (rect && rect.width > 0 && rect.height > 0) {
      score += Math.min(25, (rect.width * rect.height) / 50000);
    }

    if (video.id === 'fsplayer-container-id_html5_api' || video.id === 'fsplayer-container-id') {
      score += 30;
    }
    if (video.closest && video.closest('.video-js, .tcplayer, #player-con')) {
      score += 10;
    }

    return score;
  }

  function isVideoConnected(video) {
    if (!video) return false;
    const doc = video.ownerDocument;
    return !!doc && typeof doc.contains === 'function' && doc.contains(video);
  }

  // 优先按已知选择器找“下一节”；找不到时依次尝试跳转下拉、课程结构和关键词。
  function findNextTargetSync() {
    return findExplicitNextTarget() ||
      findNextTargetFromJumpSelect() ||
      findNextTargetFromPageStructure() ||
      findNextTargetByKeywords();
  }

  function findExplicitNextTarget() {
    for (const selector of CONFIG.selectors.nextButton) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        continue;
      }

      for (const el of nodes) {
        if (el.closest(`#${CONFIG.panelId}`)) continue;
        const href = resolveNextHref(el);
        if (href && sameActivityUrl(href, location.href)) continue;
        if (href || getText(el)) {
          return {
            element: el,
            href,
            source: `selector:${selector}`,
            text: getText(el),
            type: classifyModType(href),
          };
        }
      }
    }

    return null;
  }

  // 给“下一节”候选项打分，分高的优先。隐藏元素不再直接丢弃，
  // 因为部分主题会把活动导航隐藏起来，但链接仍然有效。
  function scoreNextButton(el) {
    if (!el || el.closest(`#${CONFIG.panelId}`)) return -100;

    const text = getText(el).toLowerCase();
    const sign = [
      el.id || '',
      normalizeClass(el.className),
      el.getAttribute('href') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('rel') || '',
      el.getAttribute('data-action') || '',
    ].join(' ').toLowerCase();

    let score = 0;

    for (const keyword of CONFIG.nextKeywords) {
      if (text.includes(keyword.toLowerCase())) score += 10;
      if (sign.includes(keyword.toLowerCase())) score += 6;
    }

    for (const keyword of CONFIG.negativeKeywords) {
      if (text.includes(keyword.toLowerCase())) score -= 12;
      if (sign.includes(keyword.toLowerCase())) score -= 8;
    }

    if (el.id === 'next-activity-link') score += 60;
    if (el.id === 'prev-activity-link') score -= 80;
    if (el.getAttribute('rel') === 'next') score += 30;
    if (sign.includes('next-activity')) score += 25;

    const navigation = el.closest('.activity-navigation');
    if (navigation) {
      score += 10;
      const anchors = Array.from(navigation.querySelectorAll('a'));
      if (anchors[anchors.length - 1] === el) score += 12;
    }

    if (el.tagName === 'A') score += 2;
    if (isVisible(el)) score += 4;
    else score -= 18;

    const href = resolveNextHref(el);
    if (href && sameActivityUrl(href, location.href)) score -= 80;
    // “下一节”类课程页链接无法直接定位视频活动，交给课程结构解析。
    if (href && /\/course\/view\.php/.test(href)) score -= 20;

    return score;
  }

  function findNextTargetByKeywords() {
    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"]'))
      .filter((el) => !el.closest(`#${CONFIG.panelId}`))
      .map((el) => ({ el, score: scoreNextButton(el) }))
      .filter((item) => item.score >= 10)
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best) return null;

    const href = resolveNextHref(best.el);
    return {
      element: best.el,
      href,
      source: 'keyword-score',
      text: getText(best.el),
      type: classifyModType(href),
      score: best.score,
    };
  }

  // 读取页面内的“跳转至”下拉框，按当前 cmid 找到下一个活动。
  function findNextTargetFromJumpSelect() {
    const select = safeQuery('#jump-to-activity') ||
      safeQuery('select.urlselect') ||
      safeQuery('select[name="jump"]');

    if (!(select instanceof HTMLSelectElement)) return null;

    const options = Array.from(select.options || []);
    if (!options.length) return null;

    const currentCmid = getCurrentCmid();
    let currentIndex = currentCmid
      ? options.findIndex((option) => getCmid(option.value || '') === currentCmid)
      : -1;

    if (currentIndex < 0) {
      currentIndex = options.findIndex((option) => {
        const href = absolutizeUrl(option.value || '');
        return !!href && /\/mod\//.test(href) && sameActivityUrl(href, location.href);
      });
    }
    if (currentIndex < 0) return null;

    for (let index = currentIndex + 1; index < options.length; index += 1) {
      const href = absolutizeUrl(options[index].value || '');
      if (!href || !/\/mod\//.test(href)) continue;
      return {
        element: select,
        href,
        source: 'jump-select',
        text: getText(options[index]),
        type: classifyModType(href),
      };
    }

    return null;
  }

  // 从页面里已有的课程结构（课程索引/导航块/课程内容）按顺序找下一项。
  function findNextTargetFromPageStructure() {
    const currentCmid = getCurrentCmid();
    if (!currentCmid) return null;

    for (const selector of CONFIG.selectors.courseStructure) {
      let containers = [];
      try {
        containers = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        continue;
      }

      for (const container of containers) {
        const list = collectActivityLinksFrom(container);
        if (list.length < 2) continue;

        const index = list.findIndex((item) => item.cmid === currentCmid);
        if (index < 0) continue;

        const next = list[index + 1];
        if (!next) continue;

        return {
          element: next.element || null,
          href: next.href,
          source: `structure:${selector}`,
          text: next.text,
          type: next.type,
          cmid: next.cmid,
        };
      }
    }

    return null;
  }

  // 按文档顺序收集 /mod/xxx/view.php 链接，按 cmid 去重。
  function collectActivityLinksFrom(root, baseUrl) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];

    const list = [];
    const seen = new Set();
    let anchors = [];
    try {
      anchors = Array.from(root.querySelectorAll('a[href]'));
    } catch (_) {
      return list;
    }

    for (const anchor of anchors) {
      if (state.panel && anchor.closest && anchor.closest(`#${CONFIG.panelId}`)) continue;

      const rawHref = anchor.getAttribute('href') || '';
      if (!/\/mod\/[^/]+\/view\.php/i.test(rawHref)) continue;

      const href = absolutizeUrl(rawHref, baseUrl);
      if (!href) continue;

      const cmid = getCmid(href);
      if (!cmid || seen.has(cmid)) continue;

      seen.add(cmid);
      list.push({
        cmid,
        href,
        element: anchor,
        text: getText(anchor),
        type: classifyModType(href),
      });
    }

    return list;
  }

  function resolveNextTarget(options = {}) {
    const syncTarget = findNextTargetSync();
    if (syncTarget && syncTarget.href) return syncTarget;

    if (options.allowCourseScan !== false && CONFIG.courseScan.enabled) {
      return resolveNextTargetFromCourseStructure().then((scanTarget) => scanTarget || syncTarget || null);
    }

    return syncTarget || null;
  }

  async function resolveNextTargetFromCourseStructure() {
    const currentCmid = getCurrentCmid();
    if (!currentCmid) return null;

    const list = await fetchCourseActivities();
    if (!list.length) return null;

    const index = list.findIndex((item) => item.cmid === currentCmid);
    if (index < 0) {
      logEvent('next.course-scan-current-missing', {
        currentCmid,
        count: list.length,
      });
      return null;
    }
    if (index >= list.length - 1) {
      logEvent('next.course-scan-last-activity', {
        currentCmid,
        count: list.length,
      });
      return null;
    }

    const next = list[index + 1];
    if (!next) return null;

    return {
      element: null,
      href: next.href,
      source: 'course-scan',
      text: next.text,
      type: next.type,
      cmid: next.cmid,
    };
  }

  function gmRequestText(url) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: CONFIG.courseScan.fetchTimeoutMs,
          onload: (response) => {
            if (response &&
              response.status >= 200 &&
              response.status < 400 &&
              typeof response.responseText === 'string') {
              resolve(response.responseText);
            } else {
              reject(new Error(`HTTP ${response ? response.status : 'unknown'}`));
            }
          },
          onerror: () => reject(new Error('网络请求失败')),
          ontimeout: () => reject(new Error('请求超时')),
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function fetchTextWithTimeout(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), CONFIG.courseScan.fetchTimeoutMs)
      : null;

    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        signal: controller ? controller.signal : undefined,
      });

      if (!response || !response.ok) {
        throw new Error(`HTTP ${response ? response.status : 'unknown'}`);
      }

      return await response.text();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // GM_xmlhttpRequest 在同源请求中也会携带登录 Cookie，优先使用；
  // 如果当前用户脚本管理器没有该 API，再退回 fetch。
  async function requestCoursePageHtml(url) {
    if (typeof GM_xmlhttpRequest === 'function') {
      try {
        return await gmRequestText(url);
      } catch (error) {
        logEvent('next.course-fetch-gm-failed', {
          message: String(error && error.message ? error.message : error),
        });
      }
    }

    if (typeof fetch === 'function') {
      return fetchTextWithTimeout(url);
    }

    throw new Error('当前环境不支持课程主页请求');
  }

  // 当前页面拿不到完整课程结构时，抓一次课程主页按顺序解析。
  async function fetchCourseActivities() {
    if (!CONFIG.courseScan.enabled) return [];

    const courseId = resolveCourseId();
    if (!courseId) return [];

    const cached = state.courseActivityCache[courseId];
    if (cached && Date.now() - cached.fetchedAt < CONFIG.courseScan.cacheTtlMs) {
      return cached.list;
    }

    if (state.courseScanInFlight && state.courseScanInFlight.courseId === courseId) {
      return state.courseScanInFlight.promise;
    }

    if (typeof DOMParser !== 'function') return [];
    if (typeof fetch !== 'function' && typeof GM_xmlhttpRequest !== 'function') return [];

    const courseUrl = new URL(`/course/view.php?id=${encodeURIComponent(courseId)}`, location.origin).href;
    const promise = (async () => {
      try {
        logEvent('next.course-scan-start', {
          courseId,
          url: courseUrl,
        });

        const html = await requestCoursePageHtml(courseUrl);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const list = extractActivityListFromDocument(doc, courseUrl, getCurrentCmid());

        state.courseActivityCache[courseId] = {
          fetchedAt: Date.now(),
          list,
        };

        logEvent('next.course-scan-success', {
          courseId,
          count: list.length,
          currentCmid: getCurrentCmid(),
        });

        if (!list.length) {
          logEvent('next.course-scan-empty', {
            courseId,
            url: courseUrl,
          });
        }

        return list;
      } catch (error) {
        logEvent('next.course-scan-failed', {
          courseId,
          message: String(error && error.message ? error.message : error),
        });
        return [];
      }
    })();

    state.courseScanInFlight = { courseId, promise };

    try {
      return await promise;
    } finally {
      if (state.courseScanInFlight && state.courseScanInFlight.promise === promise) {
        state.courseScanInFlight = null;
      }
    }
  }

  function extractActivityListFromDocument(doc, baseUrl, currentCmid) {
    let bestList = [];
    let bestListWithCurrent = [];

    for (const selector of CONFIG.selectors.courseStructure) {
      let containers = [];
      try {
        containers = Array.from(doc.querySelectorAll(selector));
      } catch (_) {
        continue;
      }

      for (const container of containers) {
        const list = collectActivityLinksFrom(container, baseUrl);
        if (list.length > bestList.length) bestList = list;
        if (currentCmid &&
          list.length > bestListWithCurrent.length &&
          list.some((item) => item.cmid === currentCmid)) {
          bestListWithCurrent = list;
        }
      }
    }

    if (bestListWithCurrent.length) return bestListWithCurrent;
    if (bestList.length) return bestList;
    return collectActivityLinksFrom(doc, baseUrl);
  }

  // Tampermonkey 沙盒里 M 可能挂在 unsafeWindow 上，两个位置都试一次。
  function getPageConfig() {
    try {
      if (typeof unsafeWindow !== 'undefined' &&
        unsafeWindow &&
        unsafeWindow.M &&
        unsafeWindow.M.cfg) {
        return unsafeWindow.M.cfg;
      }
    } catch (_) {}

    try {
      return window.M && window.M.cfg ? window.M.cfg : null;
    } catch (_) {
      return null;
    }
  }

  function resolveCourseId() {
    try {
      const cfg = getPageConfig();
      const fromConfig = Number(cfg && cfg.courseId);
      if (fromConfig > 1) return String(fromConfig);
    } catch (_) {}

    const bodyMatch = /(?:^|\s)course-(\d+)(?:\s|$)/.exec(document.body?.className || '');
    if (bodyMatch && Number(bodyMatch[1]) > 1) return bodyMatch[1];

    const link = safeQuery('nav a[href*="/course/view.php?id="]') ||
      safeQuery('a[href*="/course/view.php?id="]');
    if (link) {
      const href = absolutizeUrl(link.getAttribute('href') || '');
      if (href) {
        try {
          const id = new URL(href).searchParams.get('id');
          if (id && Number(id) > 1) return id;
        } catch (_) {}
      }
    }

    return '';
  }

  function classifyModType(url) {
    const match = /\/mod\/([^/?#]+)\/view\.php/i.exec(String(url || ''));
    return match ? match[1].toLowerCase() : '';
  }

  function getCmid(url) {
    const value = String(url || '');
    if (!/\/mod\//.test(value)) return '';
    try {
      return new URL(value, location.href).searchParams.get('id') || '';
    } catch (_) {
      return '';
    }
  }

  function getCurrentCmid() {
    const fromUrl = getCmid(location.href);
    if (fromUrl) return fromUrl;

    const bodyMatch = /(?:^|\s)cmid-(\d+)(?:\s|$)/.exec(document.body?.className || '');
    if (bodyMatch) return bodyMatch[1];

    try {
      const cfg = getPageConfig();
      const id = Number(cfg && cfg.contextInstanceId);
      if (id > 0 && /\/mod\//.test(location.pathname)) return String(id);
    } catch (_) {}

    // 讨论页 URL 里没有 cmid，退回到页面里指向论坛主页的链接。
    const forumLink = safeQuery('a[href*="/mod/forum/view.php?id="]');
    if (forumLink) {
      const href = absolutizeUrl(forumLink.getAttribute('href') || '');
      const id = getCmid(href);
      if (id) return id;
    }

    return '';
  }

  function sameActivityUrl(a, b) {
    const cmidA = getCmid(a);
    const cmidB = getCmid(b);
    if (cmidA && cmidB) return cmidA === cmidB;

    try {
      const urlA = new URL(a, location.href);
      const urlB = new URL(b, location.href);
      if (urlA.origin !== urlB.origin || urlA.pathname !== urlB.pathname) return false;
      return ['id', 'd', 'cmid', 'attempt'].every((key) =>
        (urlA.searchParams.get(key) || '') === (urlB.searchParams.get(key) || ''));
    } catch (_) {
      return false;
    }
  }

  // 标题和进度信息主要用于面板展示与日志记录。
  function findTitleElement() {
    for (const selector of CONFIG.selectors.title) {
      const el = safeQuery(selector);
      if (el && getText(el)) return el;
    }
    return null;
  }

  function findProgressElement() {
    for (const selector of CONFIG.selectors.progress) {
      const el = safeQuery(selector);
      if (el && getText(el)) return el;
    }
    return null;
  }

  // 给视频挂事件监听与定时采样。
  function attachVideoHooks(video) {
    state.hookedVideo = video;
    state.autoPlayOnOpenDone = false;
    bindManualPauseIntentHooks(video);
    const events = ['play', 'pause', 'ended', 'seeking', 'seeked', 'ratechange'];

    for (const eventName of events) {
      const handler = () => {
        const snapshot = collectVideoSnapshot(video);
        state.lastStatusText = buildStatusText();
        updatePanel();
        logEvent(`video.${eventName}`, snapshot);

        if (eventName === 'play') {
          removeManualPlayHint();
          clearPauseRecoveryState();
        }

        if (eventName === 'pause') {
          maybeRecoverUnexpectedPause(snapshot, 'pause-event');
        }

        if (eventName === 'play' || eventName === 'ratechange' || eventName === 'seeked') {
          enforcePlaybackRateLock(`video-${eventName}`);
        }

        if (eventName === 'ended') {
          clearPauseRecoveryState();
          maybeGoNext('video-ended', snapshot);
        }
      };

      video.addEventListener(eventName, handler, true);
      state.videoListeners.push({ target: video, eventName, handler });
    }

    state.sampleTimer = setInterval(() => {
      if (!isVideoConnected(video)) {
        scheduleRescan('video-detached');
        return;
      }

      const snapshot = collectVideoSnapshot(video);
      state.lastStatusText = buildStatusText();
      updatePanel();
      logEvent('video.sample', snapshot);

      if (!isPlaybackRateTarget(snapshot.playbackRate)) {
        enforcePlaybackRateLock('video-sample');
      }

      if (snapshot.duration > 0 && snapshot.ended) {
        maybeGoNext('video-ended-sample', snapshot);
        return;
      }

      if (snapshot.duration > 0 && CONFIG.allowProgressFallback && shouldAdvanceByProgress(snapshot)) {
        maybeGoNext('ratio-threshold', snapshot);
      }
    }, CONFIG.sampleIntervalMs);
  }

  function shouldAdvanceByProgress(snapshot) {
    if (!snapshot || snapshot.ended) return true;
    if (snapshot.paused) return false;
    if (snapshot.ratio < CONFIG.completeRatio) return false;

    const remaining = snapshot.duration - snapshot.currentTime;
    return remaining >= 0 && remaining <= CONFIG.completeRemainingSeconds;
  }

  // 重扫页面前，把旧视频监听清掉，避免重复触发。
  function clearVideoHooks() {
    for (const item of state.videoListeners) {
      item.target.removeEventListener(item.eventName, item.handler, true);
    }

    state.videoListeners = [];

    if (state.sampleTimer) {
      clearInterval(state.sampleTimer);
      state.sampleTimer = null;
    }

    if (state.autoplayTimer) {
      clearTimeout(state.autoplayTimer);
      state.autoplayTimer = null;
    }

    if (state.pauseResumeTimer) {
      clearTimeout(state.pauseResumeTimer);
      state.pauseResumeTimer = null;
    }

    if (state.playbackRateVerifyTimer) {
      clearTimeout(state.playbackRateVerifyTimer);
      state.playbackRateVerifyTimer = null;
    }

    if (state.forumSkipTimer) {
      clearTimeout(state.forumSkipTimer);
      state.forumSkipTimer = null;
    }

    state.hookedVideo = null;
    state.autoPlayOnOpenDone = false;
    removeManualPlayHint();
    state.autoplayAttempts = 0;
    state.pauseResumeAttempts = 0;
    state.autoplayStateText = TEXT.autoplayIdle;
    state.playbackRateStatusText = TEXT.playbackRateIdle;
    state.playbackRateConflictCount = 0;
    state.playbackRateConflictWindowStartedAt = 0;
  }

  // 记录“用户刚刚动过播放器”，避免用户手动暂停时脚本立刻抢着恢复。
  function bindManualPauseIntentHooks(video) {
    const doc = video.ownerDocument || document;
    const candidates = [
      video,
      video.closest('.video-js'),
      video.closest('#player-con'),
      video.parentElement,
      doc,
    ].filter(Boolean);

    const uniqueTargets = Array.from(new Set(candidates));

    uniqueTargets.forEach((target) => {
      const pointerHandler = () => {
        state.lastUserPauseIntentAt = Date.now();
      };

      target.addEventListener('pointerdown', pointerHandler, true);
      state.videoListeners.push({ target, eventName: 'pointerdown', handler: pointerHandler });

      if (target === doc) {
        const keyHandler = (event) => {
          const key = String(event.key || '');
          if (key === ' ' || key.toLowerCase() === 'k' || key === 'MediaPlayPause' || key === 'MediaPause') {
            state.lastUserPauseIntentAt = Date.now();
          }
        };
        target.addEventListener('keydown', keyHandler, true);
        state.videoListeners.push({ target, eventName: 'keydown', handler: keyHandler });
      }
    });
  }

  function clearPauseRecoveryState() {
    if (state.pauseResumeTimer) {
      clearTimeout(state.pauseResumeTimer);
      state.pauseResumeTimer = null;
    }
    state.pauseResumeAttempts = 0;
  }

  // 仅在判断为“非人工暂停”时，才尝试恢复播放。
  function maybeRecoverUnexpectedPause(snapshot, reason) {
    if (!CONFIG.pauseRecovery.enabled) return;
    if (!state.currentVideo || !snapshot) return;
    if (snapshot.ended || !snapshot.paused) return;

    const remaining = snapshot.duration - snapshot.currentTime;
    if (snapshot.duration > 0 && remaining >= 0 && remaining <= CONFIG.pauseRecovery.nearEndSeconds) {
      return;
    }

    if (Date.now() - state.lastUserPauseIntentAt <= CONFIG.pauseRecovery.userIntentWindowMs) {
      logEvent('pause.user-intended-skip', {
        reason,
        currentTime: snapshot.currentTime,
      });
      return;
    }

    if (state.pauseResumeTimer) return;

    state.pauseResumeAttempts = 0;
    state.autoplayStateText = TEXT.autoplayRecovering;
    state.lastStatusText = buildStatusText();
    updatePanel();
    schedulePauseRecovery(reason);
  }

  function schedulePauseRecovery(reason) {
    if (!state.currentVideo) return;

    if (state.pauseResumeTimer) {
      clearTimeout(state.pauseResumeTimer);
    }

    const delay = state.pauseResumeAttempts === 0
      ? CONFIG.pauseRecovery.initialDelayMs
      : CONFIG.pauseRecovery.retryDelayMs;

    state.pauseResumeTimer = setTimeout(() => {
      state.pauseResumeTimer = null;
      attemptPauseRecovery(reason);
    }, delay);
  }

  // 倍速锁：发现播放倍速偏离 1x 时，立即尝试拉回，并在短延迟后验证是否真的锁住。
  function enforcePlaybackRateLock(reason, options = {}) {
    if (!CONFIG.playbackRateLock.enabled || !state.currentVideo) return true;

    const video = state.currentVideo;
    if (!isVideoConnected(video)) return false;

    const currentRate = Number(video.playbackRate || CONFIG.playbackRateLock.target);
    const defaultRate = Number(video.defaultPlaybackRate || CONFIG.playbackRateLock.target);

    if (isPlaybackRateTarget(currentRate) && isPlaybackRateTarget(defaultRate)) {
      state.playbackRateStatusText = `已锁定 ${formatRate(CONFIG.playbackRateLock.target)}`;
      state.lastStatusText = buildStatusText();
      updatePanel();
      return true;
    }

    notePlaybackRateConflict();
    state.playbackRateStatusText = `正在纠正到 ${formatRate(CONFIG.playbackRateLock.target)} (${state.playbackRateConflictCount})`;

    try {
      video.defaultPlaybackRate = CONFIG.playbackRateLock.target;
    } catch (_) {}

    try {
      video.playbackRate = CONFIG.playbackRateLock.target;
    } catch (_) {}

    state.lastStatusText = buildStatusText();
    updatePanel();

    if (!options.skipLogIfStable) {
      logEvent('playback-rate.correct-attempt', {
        reason,
        from: round(currentRate, 2),
        defaultFrom: round(defaultRate, 2),
        to: CONFIG.playbackRateLock.target,
        conflictCount: state.playbackRateConflictCount,
      });
    }

    schedulePlaybackRateVerification(reason);
    return false;
  }

  function schedulePlaybackRateVerification(reason) {
    if (state.playbackRateVerifyTimer) {
      clearTimeout(state.playbackRateVerifyTimer);
    }

    state.playbackRateVerifyTimer = setTimeout(() => {
      state.playbackRateVerifyTimer = null;
      verifyPlaybackRateLock(reason);
    }, CONFIG.playbackRateLock.verifyDelayMs);
  }

  function verifyPlaybackRateLock(reason) {
    if (!CONFIG.playbackRateLock.enabled || !state.currentVideo) return;

    const video = state.currentVideo;
    if (!isVideoConnected(video)) return;

    const currentRate = Number(video.playbackRate || CONFIG.playbackRateLock.target);
    const defaultRate = Number(video.defaultPlaybackRate || CONFIG.playbackRateLock.target);
    const locked = isPlaybackRateTarget(currentRate) && isPlaybackRateTarget(defaultRate);

    if (locked) {
      state.playbackRateStatusText = `已锁定 ${formatRate(CONFIG.playbackRateLock.target)}`;
      state.lastStatusText = buildStatusText();
      updatePanel();
      logEvent('playback-rate.correct-success', {
        reason,
        currentRate: round(currentRate, 2),
        defaultRate: round(defaultRate, 2),
      });
      return;
    }

    state.playbackRateStatusText = `检测到外部插件改成 ${formatRate(currentRate)}`;
    state.lastStatusText = buildStatusText();
    updatePanel();
    logEvent('playback-rate.correct-failed', {
      reason,
      currentRate: round(currentRate, 2),
      defaultRate: round(defaultRate, 2),
      conflictCount: state.playbackRateConflictCount,
    });
    maybeShowPlaybackRateReminder(currentRate);
  }

  function notePlaybackRateConflict() {
    const now = Date.now();
    if (!state.playbackRateConflictWindowStartedAt ||
      now - state.playbackRateConflictWindowStartedAt > CONFIG.playbackRateLock.conflictWindowMs) {
      state.playbackRateConflictWindowStartedAt = now;
      state.playbackRateConflictCount = 0;
    }

    state.playbackRateConflictCount += 1;
  }

  function isPlaybackRateTarget(value) {
    return Math.abs(Number(value || 0) - CONFIG.playbackRateLock.target) <= CONFIG.playbackRateLock.tolerance;
  }

  // 讨论页只做“跳过到下一个视频”的自动化，不停留在大量回帖内容里。
  async function maybeSkipDiscussionPage(reason) {
    if (!CONFIG.forumSkip.enabled) return;
    if (state.forumSkipRunning || state.forumSkipTimer) return;

    const startedUrl = location.href;
    state.forumSkipRunning = true;
    let target = null;
    try {
      target = await resolveDiscussionSkipTarget();
    } catch (error) {
      logEvent('forum.skip-resolve-failed', {
        message: String(error && error.message ? error.message : error),
      });
    } finally {
      state.forumSkipRunning = false;
    }

    if (location.href !== startedUrl) return;

    if (!target || !target.href) {
      state.lastSkipTargetSource = '';
      logEvent('forum.skip-target-not-found', {
        reason,
        pageType: state.pageType,
        url: location.href,
      });
      return;
    }

    const payload = {
      reason,
      dryRun: CONFIG.dryRun,
      pageType: state.pageType,
      source: target.source,
      nextText: target.text || (target.element ? getText(target.element) : ''),
      nextSelector: target.element ? buildSelector(target.element) : '',
      href: target.href,
      targetType: target.type,
    };

    state.lastSkipTargetSource = target.source;
    state.lastResolvedNext = target;
    state.lastStatusText = buildStatusText();
    updatePanel();

    if (CONFIG.dryRun) {
      logEvent('forum.skip-dry-run', payload);
      return;
    }

    if (Date.now() < state.nextLockUntil) {
      logEvent('forum.skip-locked', {
        ...payload,
        lockUntil: state.nextLockUntil,
      });
      return;
    }

    state.nextLockUntil = Date.now() + CONFIG.clickLockMs;

    logEvent('forum.skip-scheduled', {
      ...payload,
      delayMs: CONFIG.forumSkip.delayMs,
    });

    state.forumSkipTimer = setTimeout(() => {
      state.forumSkipTimer = null;
      if (!pageLooksLikeForum(location.href)) return;
      performNextNavigation(target.element, target.href, 'forum-skip');
    }, CONFIG.forumSkip.delayMs);
  }

  // 讨论页优先跳到后面的第一个视频；中间遇到测验则停下，回退到最近的一项。
  async function resolveDiscussionSkipTarget() {
    const currentCmid = getCurrentCmid();
    let fallback = findNextTargetSync();

    if (fallback && fallback.href && pageLooksLikeVideo(fallback.href)) {
      return fallback;
    }

    if (CONFIG.courseScan.enabled && currentCmid) {
      const list = await fetchCourseActivities();
      const index = list.findIndex((item) => item.cmid === currentCmid);
      if (index >= 0) {
        for (let cursor = index + 1; cursor < list.length; cursor += 1) {
          const item = list[cursor];
          const target = {
            element: null,
            href: item.href,
            source: 'course-scan',
            text: item.text,
            type: item.type,
            cmid: item.cmid,
          };

          if (pageLooksLikeVideo(item.href)) return target;
          if (!fallback || !fallback.href) fallback = target;
          if (item.type === 'quiz') break;
        }
      }
    }

    if (fallback && fallback.href) return fallback;
    return null;
  }

  // 页面刚打开时预解析一次下一项，便于面板提前显示目标。
  function primeNextTarget() {
    if (state.currentNextButton || state.lastResolvedNext?.href) return;

    const startedUrl = location.href;
    resolveNextTarget({ allowCourseScan: true })
      .then((target) => {
        if (!target || location.href !== startedUrl) return;
        state.lastResolvedNext = target;
        if (target.element) {
          state.currentNextButton = target.element;
          state.currentNextButtonSource = target.source;
        }
        state.lastStatusText = buildStatusText();
        updatePanel();
        logEvent('next.prefetch-resolved', {
          source: target.source,
          targetType: target.type,
          href: target.href,
        });
      })
      .catch(() => {});
  }

  // 统一处理“跳下一节”逻辑，含 dryRun 和防重复锁。
  // 页面没有下一项按钮时会异步解析课程结构，所以这里改成 async。
  async function maybeGoNext(reason, snapshot) {
    if (!isSafeAdvanceTrigger(reason, snapshot)) {
      logEvent('next.ignored-unsafe-trigger', {
        reason,
        snapshot,
      });
      return;
    }

    const isManual = reason === 'manual-test';
    if (!isManual && Date.now() < state.nextLockUntil) {
      logEvent('next.locked', {
        reason,
        snapshot,
        lockUntil: state.nextLockUntil,
      });
      return;
    }

    if (state.nextResolving) {
      logEvent('next.resolve-in-progress', { reason });
      return;
    }

    const startedUrl = location.href;
    state.nextResolving = true;

    try {
      let target = state.currentNextButton
        ? {
          element: state.currentNextButton,
          href: resolveNextHref(state.currentNextButton),
          source: state.currentNextButtonSource || 'scan',
          text: getText(state.currentNextButton),
          type: classifyModType(resolveNextHref(state.currentNextButton)),
        }
        : state.lastResolvedNext;

      if (target && !target.href && state.lastResolvedNext?.href) {
        target = state.lastResolvedNext;
      }

      const fallbackTarget = target;
      if (!target || (!target.href && !isManual)) {
        target = (await resolveNextTarget({ allowCourseScan: true })) || fallbackTarget;
      }

      if (location.href !== startedUrl) {
        logEvent('next.stale-resolution', {
          reason,
          startedUrl,
          currentUrl: location.href,
        });
        return;
      }

      if (target && (target.href || target.element)) {
        state.lastResolvedNext = target;
        if (target.element) {
          state.currentNextButton = target.element;
          state.currentNextButtonSource = target.source;
        }
        state.lastStatusText = buildStatusText();
        updatePanel();
      }

      const payload = {
        reason,
        dryRun: CONFIG.dryRun,
        source: target ? target.source : '',
        targetType: target ? target.type : '',
        nextText: target ? (target.text || (target.element ? getText(target.element) : '')) : '',
        nextSelector: target && target.element ? buildSelector(target.element) : '',
        href: target ? target.href : '',
        currentCmid: getCurrentCmid(),
        courseId: resolveCourseId(),
        snapshot,
      };

      if (!target || (!target.href && !target.element)) {
        logEvent('next.not-found', payload);
        return;
      }

      if (CONFIG.dryRun) {
        logEvent('next.dry-run', payload);
        return;
      }

      if (!isManual) {
        state.nextLockUntil = Date.now() + CONFIG.clickLockMs;
      }

      logEvent('next.navigate', payload);
      performNextNavigation(target.element || null, target.href || '', reason);
    } catch (error) {
      logEvent('next.resolve-failed', {
        reason,
        message: String(error && error.message ? error.message : error),
      });
    } finally {
      state.nextResolving = false;
    }
  }

  // 对所有自动跳页触发再做一层硬校验，防止播放器中途误报 ended。
  // video 已 ended 时以原生 ended 为准；duration 缺失也不再阻断跳转。
  function isSafeAdvanceTrigger(reason, snapshot) {
    if (reason === 'manual-test') return true;
    if (reason === 'forum-skip') return true;
    if (!snapshot) return false;

    if (reason === 'ratio-threshold') {
      return CONFIG.allowProgressFallback && isSnapshotNearVideoEnd(snapshot);
    }

    if (reason === 'video-ended' || reason === 'video-ended-sample') {
      if (!snapshot.ended) return false;
      if (!(snapshot.duration > 0)) return true;
      return snapshot.ratio >= CONFIG.verifiedEndRatio || isSnapshotNearVideoEnd(snapshot);
    }

    return false;
  }

  function isSnapshotNearVideoEnd(snapshot) {
    if (!snapshot) return false;
    if (!(snapshot.duration > 0)) return false;

    const ratio = Number(snapshot.ratio || 0);
    const remaining = Number(snapshot.duration || 0) - Number(snapshot.currentTime || 0);

    return ratio >= CONFIG.verifiedEndRatio &&
      remaining >= 0 &&
      remaining <= CONFIG.verifiedEndRemainingSeconds;
  }

  // 采集视频状态，便于日志分析和面板展示。
  function collectVideoSnapshot(video) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;

    return {
      currentTime: round(currentTime, 3),
      duration: round(duration, 3),
      remaining: round(duration - currentTime, 3),
      ratio: duration > 0 ? round(currentTime / duration, 4) : 0,
      paused: !!video.paused,
      ended: !!video.ended,
      playbackRate: round(video.playbackRate || 1, 2),
    };
  }

  // 当 href 不存在时，保底仍然尝试一次原生点击。
  function smartClick(el) {
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {}

    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    });

    if (typeof el.click === 'function') {
      el.click();
    }
  }

  // 把下一节节点中的 href 解析成绝对地址。
  function resolveNextHref(el) {
    if (!el || typeof el.getAttribute !== 'function') return '';

    const rawHref = el.getAttribute('href') || '';
    if (!rawHref || rawHref === '#' || rawHref.toLowerCase().startsWith('javascript:')) {
      return '';
    }

    return absolutizeUrl(rawHref);
  }

  // 当前版本采用“硬跳”策略：只要有 href，就直接跳过去。
  function performNextNavigation(el, href, reason) {
    if (!href) {
      if (!el) {
        logEvent('next.no-target', { reason });
        return;
      }
      logEvent('next.no-href-fallback', {
        reason,
        selector: buildSelector(el),
      });
      smartClick(el);
      return;
    }

    setPendingAutoplay(href, reason);
    logEvent('next.direct-assign', {
      reason,
      from: location.href,
      to: href,
    });
    location.assign(href);
  }

  // 记录“下一页到了以后要尝试自动续播”的上下文。
  function setPendingAutoplay(targetUrl, reason) {
    if (!CONFIG.autoPlay.enabled) return;

    storageSet(CONFIG.storageKeys.pendingAutoplay, {
      targetUrl,
      reason,
      resumeOnNextVideo: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + CONFIG.autoPlay.pendingExpiryMs,
    });
  }

  // 页面到达后检查是否存在待续播上下文，过期则清理。
  function consumePendingArrival() {
    const pending = storageGet(CONFIG.storageKeys.pendingAutoplay, null);
    if (!pending) return;

    if (Date.now() > Number(pending.expiresAt || 0)) {
      storageDelete(CONFIG.storageKeys.pendingAutoplay);
      return;
    }

    if (isQuizPage() && pending.resumeOnNextVideo) {
      state.autoplayStateText = TEXT.autoplayPending;
      state.lastStatusText = buildStatusText();
      storageSet(CONFIG.storageKeys.pendingAutoplay, {
        ...pending,
        expiresAt: Date.now() + CONFIG.autoPlay.pendingExpiryMs,
      });
      logEvent('autoplay.quiz-bridge-keepalive', {
        pageType: state.pageType,
        url: location.href,
      });
      return;
    }

    if (pending.targetUrl && sameActivityUrl(pending.targetUrl, location.href)) {
      state.autoplayStateText = TEXT.autoplayPending;
      state.lastStatusText = buildStatusText();
      logEvent('autoplay.pending-arrival', {
        targetUrl: pending.targetUrl,
        reason: pending.reason || '',
        pageType: state.pageType,
      });

      if (isQuizPage()) {
        storageSet(CONFIG.storageKeys.pendingAutoplay, {
          ...pending,
          resumeOnNextVideo: true,
          expiresAt: Date.now() + CONFIG.autoPlay.pendingExpiryMs,
          quizSourceUrl: location.href,
        });
        logEvent('autoplay.quiz-bridge-armed', {
          url: location.href,
        });
      }
    }
  }

  // 如果当前页是自动跳转到达的视频页，则尝试继续播放。
  function maybeResumePlaybackAfterJump() {
    if (!CONFIG.autoPlay.enabled || !state.currentVideo) return false;

    const pending = storageGet(CONFIG.storageKeys.pendingAutoplay, null);
    if (!pending) return false;
    if (Date.now() > Number(pending.expiresAt || 0)) {
      storageDelete(CONFIG.storageKeys.pendingAutoplay);
      return false;
    }

    const directArrival = pending.targetUrl && sameActivityUrl(pending.targetUrl, location.href);
    const quizBridgeArrival = !!pending.resumeOnNextVideo && pageLooksLikeQuiz(document.referrer);
    if (!directArrival && !quizBridgeArrival) return false;

    // 已经有一次续播尝试在排队时不要反复重置重试计数。
    if (state.autoplayTimer) return true;

    state.autoPlayOnOpenDone = true;
    state.autoplayAttempts = 0;
    state.autoplayStateText = TEXT.autoplayPending;
    state.lastStatusText = buildStatusText();
    updatePanel();
    logEvent('autoplay.resume-context', {
      directArrival,
      quizBridgeArrival,
      referrer: document.referrer || '',
    });
    scheduleAutoplayAttempt(quizBridgeArrival ? 'post-quiz-video' : 'pending-jump');
    return true;
  }

  // 只要打开的是视频页，就主动尝试播放，不必等到很久以后再补救。
  // 每个视频只主动播放一次，避免用户手动暂停后又被重扫逻辑强行拉起。
  function maybeAutoPlayOnVideoPageOpen() {
    if (!CONFIG.autoPlay.enabled || !state.currentVideo) return;

    const video = state.currentVideo;
    if (video.ended) return;

    if (!video.paused) {
      state.autoPlayOnOpenDone = true;
      state.autoplayStateText = TEXT.autoplayActive;
      state.lastStatusText = buildStatusText();
      updatePanel();
      return;
    }

    if (state.autoPlayOnOpenDone) {
      state.autoplayStateText = TEXT.autoplayIdle;
      state.lastStatusText = buildStatusText();
      updatePanel();
      return;
    }

    if (Date.now() - state.lastUserPauseIntentAt <= CONFIG.pauseRecovery.userIntentWindowMs) {
      state.autoPlayOnOpenDone = true;
      state.autoplayStateText = TEXT.autoplayIdle;
      state.lastStatusText = buildStatusText();
      updatePanel();
      return;
    }

    state.autoPlayOnOpenDone = true;
    state.autoplayAttempts = 0;
    state.autoplayStateText = TEXT.autoplayPending;
    state.lastStatusText = buildStatusText();
    updatePanel();
    logEvent('autoplay.page-open', {
      url: location.href,
      selector: buildSelector(video),
    });
    scheduleAutoplayAttempt('page-open-autoplay', {
      overrideDelayMs: CONFIG.autoPlay.openPageInitialDelayMs,
    });
  }

  function scheduleAutoplayAttempt(reason, options = {}) {
    if (!state.currentVideo) return;

    if (state.autoplayTimer) {
      clearTimeout(state.autoplayTimer);
    }

    const delay = typeof options.overrideDelayMs === 'number'
      ? options.overrideDelayMs
      : state.autoplayAttempts === 0
        ? CONFIG.autoPlay.initialDelayMs
        : CONFIG.autoPlay.retryDelayMs;

    state.autoplayTimer = setTimeout(() => {
      state.autoplayTimer = null;
      attemptAutoPlay(reason);
    }, delay);
  }

  // 自动续播的核心逻辑：先直接 play()，不行再尝试点播放按钮。
  function attemptAutoPlay(reason) {
    const video = state.currentVideo;
    if (!video || !isVideoConnected(video)) return;

    if (!video.paused && !video.ended) {
      removeManualPlayHint();
      state.autoplayStateText = TEXT.autoplayActive;
      storageDelete(CONFIG.storageKeys.pendingAutoplay);
      state.lastStatusText = buildStatusText();
      updatePanel();
      logEvent('autoplay.already-playing', { reason });
      return;
    }

    state.autoplayAttempts += 1;
    state.autoplayStateText = `${TEXT.autoplayPending} (${state.autoplayAttempts}/${CONFIG.autoPlay.maxAttempts})`;
    state.lastStatusText = buildStatusText();
    updatePanel();
    logEvent('autoplay.attempt', {
      reason,
      attempt: state.autoplayAttempts,
      selector: buildSelector(video),
    });

    let playResult = null;
    try {
      playResult = typeof video.play === 'function' ? video.play() : null;
    } catch (error) {
      logEvent('autoplay.play-throw', {
        reason,
        attempt: state.autoplayAttempts,
        message: String(error && error.message ? error.message : error),
      });
    }

    if (playResult && typeof playResult.then === 'function') {
      playResult
        .then(() => finalizeAutoplayAttempt(reason))
        .catch((error) => {
          logEvent('autoplay.play-rejected', {
            reason,
            attempt: state.autoplayAttempts,
            message: String(error && error.message ? error.message : error),
          });
          tryClickPlayControls();
          setTimeout(() => finalizeAutoplayAttempt(reason), 500);
        });
      return;
    }

    tryClickPlayControls();
    setTimeout(() => finalizeAutoplayAttempt(reason), 500);
  }

  // 处理“播放过程中意外暂停”的恢复动作。
  function attemptPauseRecovery(reason) {
    const video = state.currentVideo;
    if (!video || !isVideoConnected(video) || video.ended) {
      clearPauseRecoveryState();
      return;
    }

    if (!video.paused) {
      clearPauseRecoveryState();
      state.autoplayStateText = TEXT.autoplayActive;
      state.lastStatusText = buildStatusText();
      updatePanel();
      logEvent('pause.recovery-not-needed', { reason });
      return;
    }

    state.pauseResumeAttempts += 1;
    state.autoplayStateText = `${TEXT.autoplayRecovering} (${state.pauseResumeAttempts}/${CONFIG.pauseRecovery.maxAttempts})`;
    state.lastStatusText = buildStatusText();
    updatePanel();
    logEvent('pause.recovery-attempt', {
      reason,
      attempt: state.pauseResumeAttempts,
      selector: buildSelector(video),
    });

    let playResult = null;
    try {
      playResult = typeof video.play === 'function' ? video.play() : null;
    } catch (error) {
      logEvent('pause.recovery-play-throw', {
        reason,
        attempt: state.pauseResumeAttempts,
        message: String(error && error.message ? error.message : error),
      });
    }

    if (playResult && typeof playResult.then === 'function') {
      playResult
        .then(() => finalizePauseRecovery(reason))
        .catch((error) => {
          logEvent('pause.recovery-play-rejected', {
            reason,
            attempt: state.pauseResumeAttempts,
            message: String(error && error.message ? error.message : error),
          });
          tryClickPlayControls();
          setTimeout(() => finalizePauseRecovery(reason), 500);
        });
      return;
    }

    tryClickPlayControls();
    setTimeout(() => finalizePauseRecovery(reason), 500);
  }

  function finalizePauseRecovery(reason) {
    const video = state.currentVideo;
    if (!video) {
      clearPauseRecoveryState();
      return;
    }

    if (!video.paused && !video.ended) {
      clearPauseRecoveryState();
      state.autoplayStateText = TEXT.autoplayActive;
      state.lastStatusText = buildStatusText();
      updatePanel();
      logEvent('pause.recovery-success', {
        reason,
        attempts: state.pauseResumeAttempts,
      });
      return;
    }

    if (state.pauseResumeAttempts < CONFIG.pauseRecovery.maxAttempts) {
      schedulePauseRecovery(reason);
      return;
    }

    clearPauseRecoveryState();
    state.autoplayStateText = TEXT.autoplayIdle;
    state.lastStatusText = buildStatusText();
    updatePanel();
    logEvent('pause.recovery-give-up', {
      reason,
      attempts: state.pauseResumeAttempts,
    });
    showManualPlayHint(reason);
  }

  function finalizeAutoplayAttempt(reason) {
    const video = state.currentVideo;
    if (!video) return;

    if (!video.paused && !video.ended) {
      removeManualPlayHint();
      state.autoplayStateText = TEXT.autoplayActive;
      storageDelete(CONFIG.storageKeys.pendingAutoplay);
      state.lastStatusText = buildStatusText();
      updatePanel();
      logEvent('autoplay.success', {
        reason,
        attempt: state.autoplayAttempts,
      });
      return;
    }

    if (state.autoplayAttempts < CONFIG.autoPlay.maxAttempts) {
      scheduleAutoplayAttempt(reason);
      return;
    }

    state.autoplayStateText = TEXT.autoplayIdle;
    storageDelete(CONFIG.storageKeys.pendingAutoplay);
    state.lastStatusText = buildStatusText();
    updatePanel();
    logEvent('autoplay.give-up', {
      reason,
      attempts: state.autoplayAttempts,
    });
    showManualPlayHint(reason);
  }

  // 有些播放器对 video.play() 不敏感，所以再尝试点一次播放控件。
  function tryClickPlayControls() {
    const video = state.currentVideo;
    const doc = video?.ownerDocument || document;
    const root = video?.closest?.('.video-js, .tcplayer, #player-con') || doc;
    const controls = [
      '.vjs-big-play-button',
      '.vjs-play-control',
      'button[title*="播放"]',
      'button[aria-label*="播放"]',
      '[class*="play-button"]',
      '.prism-big-play-btn',
      '.xgplayer-start',
    ];

    for (const selector of controls) {
      let button = null;
      try {
        button = root.querySelector(selector);
      } catch (_) {}
      if (button && isVisible(button)) {
        smartClick(button);
        return;
      }
    }

    if (video) {
      smartClick(video);
    }
  }

  // 自动播放被浏览器拦截时，给一个真实的用户点击入口，避免下一步视频停在暂停状态。
  function removeManualPlayHint() {
    const hint = document.getElementById(`${CONFIG.panelId}-play-hint`);
    if (hint) hint.remove();
  }

  function showManualPlayHint(reason) {
    if (!state.currentVideo || !isVideoConnected(state.currentVideo)) return;
    if (document.getElementById(`${CONFIG.panelId}-play-hint`)) return;

    const hint = document.createElement('div');
    hint.id = `${CONFIG.panelId}-play-hint`;
    hint.innerHTML = '<button type="button" data-action="manual-play">自动播放被浏览器拦截，点击继续播放</button>';

    hint.addEventListener('click', (event) => {
      if (!event.target.closest('[data-action="manual-play"]')) return;

      const video = state.currentVideo;
      hint.remove();
      if (!video) return;

      try {
        const result = video.play();
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
      } catch (_) {}
    });

    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 45000);
    logEvent('autoplay.manual-hint', { reason });
  }

  // 测验页弹窗 + 蜂鸣提醒，提醒人来手动完成。
  function maybeShowQuizReminder() {
    if (!CONFIG.quizReminder.enabled) return;
    if (state.lastQuizReminderUrl === location.href) return;

    state.lastQuizReminderUrl = location.href;
    renderQuizReminderOverlay();
    playQuizReminderBeep();
    logEvent('quiz.reminder-shown', {
      pageType: state.pageType,
      url: location.href,
    });
  }

  function renderQuizReminderOverlay() {
    const old = document.getElementById(`${CONFIG.panelId}-quiz-reminder`);
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = `${CONFIG.panelId}-quiz-reminder`;
    overlay.innerHTML = `
      <div class="tm-quiz-mask"></div>
      <div class="tm-quiz-dialog">
        <div class="tm-quiz-title">${escapeHtml(TEXT.quizNoticeTitle)}</div>
        <div class="tm-quiz-body">${escapeHtml(TEXT.quizNoticeBody)}</div>
        <button class="tm-quiz-button" type="button" data-action="dismiss-quiz-reminder">${escapeHtml(TEXT.reminderAcknowledge)}</button>
      </div>
    `;

    overlay.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="dismiss-quiz-reminder"]');
      if (button || event.target.classList.contains('tm-quiz-mask')) {
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  // 如果倍速被外部插件反复改掉，就弹窗提醒用户关闭插件或换到隐私/无痕模式。
  function maybeShowPlaybackRateReminder(currentRate) {
    const now = Date.now();
    if (state.playbackRateConflictCount < CONFIG.playbackRateLock.reminderThreshold) return;
    if (state.lastRateReminderUrl === location.href &&
      now - state.lastRateReminderAt < CONFIG.playbackRateLock.reminderCooldownMs) {
      return;
    }

    state.lastRateReminderUrl = location.href;
    state.lastRateReminderAt = now;
    renderPlaybackRateReminderOverlay(currentRate);
    playQuizReminderBeep();
    logEvent('playback-rate.reminder-shown', {
      currentRate: round(currentRate, 2),
      conflictCount: state.playbackRateConflictCount,
      url: location.href,
    });
  }

  function renderPlaybackRateReminderOverlay(currentRate) {
    const overlayId = `${CONFIG.panelId}-rate-reminder`;
    const old = document.getElementById(overlayId);
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.innerHTML = `
      <div class="tm-quiz-mask"></div>
      <div class="tm-quiz-dialog">
        <div class="tm-quiz-title">${escapeHtml(TEXT.rateReminderTitle)}</div>
        <div class="tm-quiz-body">${escapeHtml(buildPlaybackRateReminderBody(currentRate))}</div>
        <button class="tm-quiz-button" type="button" data-action="dismiss-rate-reminder">${escapeHtml(TEXT.reminderAcknowledge)}</button>
      </div>
    `;

    overlay.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="dismiss-rate-reminder"]');
      if (button || event.target.classList.contains('tm-quiz-mask')) {
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  function buildPlaybackRateReminderBody(currentRate) {
    return `检测到其他浏览器插件或脚本正在把视频倍速反复改成 ${formatRate(currentRate)}，当前脚本已多次尝试拉回 1.00x。请先关闭其他倍速插件；如果仍有冲突，建议改用浏览器隐私/无痕模式重新打开课程页面。若使用隐私/无痕模式，请先在扩展管理中允许 Tampermonkey 在该模式下运行，并在该模式中重新启用这份脚本。`;
  }

  // 用 Web Audio API 发几声短蜂鸣，浏览器若拦截则静默失败。
  async function playQuizReminderBeep() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      const context = new AudioContextClass();
      if (typeof context.resume === 'function') {
        await context.resume();
      }

      for (let i = 0; i < CONFIG.quizReminder.beepCount; i += 1) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        const startAt = now + (i * CONFIG.quizReminder.beepIntervalMs) / 1000;
        const stopAt = startAt + CONFIG.quizReminder.beepDurationMs / 1000;

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(CONFIG.quizReminder.beepFrequency, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(stopAt);
      }

      setTimeout(() => {
        try {
          context.close();
        } catch (_) {}
      }, CONFIG.quizReminder.beepCount * CONFIG.quizReminder.beepIntervalMs + 1000);
    } catch (error) {
      logEvent('quiz.reminder-beep-failed', {
        message: String(error && error.message ? error.message : error),
      });
    }
  }

  // 兼容单页应用路由变化。
  function patchHistory() {
    ['pushState', 'replaceState'].forEach((method) => {
      const original = history[method];
      if (typeof original !== 'function') return;

      history[method] = function (...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new CustomEvent('__tm_lms_route_change__', {
          detail: { method },
        }));
        return result;
      };
    });
  }

  function bindRouteEvents() {
    window.addEventListener('__tm_lms_route_change__', () => handleRouteChange('history'));
    window.addEventListener('popstate', () => handleRouteChange('popstate'));
    window.addEventListener('hashchange', () => handleRouteChange('hashchange'));
  }

  // URL 变化后重新识别页面。
  function handleRouteChange(trigger) {
    if (location.href === state.lastRouteUrl) return;

    state.lastRouteUrl = location.href;
    state.nextLockUntil = 0;
    state.lastResolvedNext = null;
    state.currentNextButton = null;
    state.currentNextButtonSource = '';
    state.nextPrefetchUrl = '';
    state.forumSkipRunning = false;

    if (state.forumSkipTimer) {
      clearTimeout(state.forumSkipTimer);
      state.forumSkipTimer = null;
    }

    stopVideoTracking();

    logEvent('route.change', {
      trigger,
      url: location.href,
      title: document.title,
    });

    setTimeout(() => scanPage(`route:${trigger}`), CONFIG.routeSettleMs);
  }

  // 监听 DOM 变化，兼容异步渲染页面。
  // 忽略面板自身和播放器 UI 的频繁变化，否则 updatePanel/时间进度会
  // 反过来触发重扫，形成每秒一次的扫描循环。
  function observeDom() {
    state.observer = new MutationObserver((mutations) => {
      // 测验页有倒计时，DOM 会频繁变化，这里直接忽略，避免日志刷屏。
      if (state.pageType !== 'video' && state.pageType !== 'activity') return;

      const meaningful = mutations.some((mutation) => {
        if (!mutation.addedNodes.length && !mutation.removedNodes.length) return false;

        const target = mutation.target;
        if (!(target instanceof Element)) return true;

        if (state.panel && state.panel.contains(target)) return false;
        if (target.closest('[id$="-quiz-reminder"], [id$="-rate-reminder"]')) return false;

        if (target.closest('.video-js, .tcplayer, #player-con, .vjs-control-bar')) {
          const hasVideoNode = Array.from(mutation.addedNodes).some((node) => {
            if (node.nodeName === 'VIDEO') return true;
            return node instanceof Element && !!node.querySelector?.('video');
          });
          if (!hasVideoNode) return false;
        }

        return true;
      });

      if (meaningful) {
        scheduleRescan('dom-mutation');
      }
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // 防抖重扫，避免页面轻微变化就不停重复扫描。
  function scheduleRescan(reason) {
    if (state.mutationTimer) {
      clearTimeout(state.mutationTimer);
    }

    state.mutationTimer = setTimeout(() => {
      scanPage(reason);
    }, CONFIG.mutationDebounceMs);
  }

  // 创建右下角调试面板外壳。
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = CONFIG.panelId;
    panel.innerHTML = `
      <div class="tm-head">
        <div class="tm-head-left">
          <div class="tm-title">${TEXT.panelTitle}</div>
          <div class="tm-version">${TEXT.version} ${SCRIPT_VERSION}</div>
        </div>
        <div class="tm-head-right">
          <button class="tm-collapse-button" type="button" data-action="toggle-collapse" data-role="collapse-toggle">${TEXT.collapse}</button>
          <div class="tm-badge" data-role="dry-run-badge">${TEXT.dryRunOn}</div>
        </div>
      </div>
      <div class="tm-body" data-role="panel-body"></div>
    `;

    document.body.appendChild(panel);
    state.panel = panel;
    state.panelBody = panel.querySelector('[data-role="panel-body"]');
    updatePanel();
  }

  // 统一处理面板按钮点击。
  function bindPanelEvents() {
    state.panel.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;

      const action = button.dataset.action;

      if (action === 'scan') {
        state.nextPrefetchUrl = '';
        state.lastResolvedNext = null;
        scanPage('manual-scan');
        return;
      }

      if (action === 'toggle-dry-run') {
        CONFIG.dryRun = !CONFIG.dryRun;
        saveSettings();
        logEvent('settings.toggle-dry-run', { dryRun: CONFIG.dryRun });
        updatePanel();
        return;
      }

      if (action === 'toggle-collapse') {
        state.panelCollapsed = !state.panelCollapsed;
        saveSettings();
        updatePanel();
        return;
      }

      if (action === 'test-next') {
        maybeGoNext('manual-test', state.currentVideo ? collectVideoSnapshot(state.currentVideo) : {});
        return;
      }

      if (action === 'clear-logs') {
        storageSet(CONFIG.storageKeys.logs, []);
        logEvent('logs.cleared', {});
        updatePanel();
        return;
      }

      if (action === 'export-logs') {
        exportLogs();
        return;
      }

      if (action === 'reset-all') {
        hardReset();
      }
    });
  }

  // 刷新面板内容。
  function updatePanel() {
    if (!state.panelBody) return;

    const badge = state.panel.querySelector('[data-role="dry-run-badge"]');
    const collapseButton = state.panel.querySelector('[data-role="collapse-toggle"]');
    if (badge) {
      badge.textContent = CONFIG.dryRun ? TEXT.dryRunOn : TEXT.dryRunOff;
      badge.className = `tm-badge ${CONFIG.dryRun ? 'warn' : 'ok'}`;
    }
    if (collapseButton) {
      collapseButton.textContent = state.panelCollapsed ? TEXT.expand : TEXT.collapse;
    }
    state.panel.classList.toggle('is-collapsed', state.panelCollapsed);

    const pageTypeText = getPageTypeText(state.pageType);
    const videoSelector = state.currentVideo ? buildSelector(state.currentVideo) : TEXT.notFound;
    const nextSelector = state.currentNextButton ? buildSelector(state.currentNextButton) : TEXT.notFound;
    const titleText = state.currentTitle ? getText(state.currentTitle) : document.title;
    const progressText = state.currentProgress ? getText(state.currentProgress) : TEXT.notFound;
    const logs = storageGet(CONFIG.storageKeys.logs, []);
    const recentLogs = getRecentLogs(logs);
    const nextTargetText = buildNextTargetText();
    const nextResolutionText = buildNextResolutionText();

    state.panelBody.innerHTML = `
      <div class="tm-actions">
        <button data-action="scan">${TEXT.rescan}</button>
        <button data-action="toggle-dry-run">${CONFIG.dryRun ? TEXT.toggleReal : TEXT.toggleDryRun}</button>
        <button data-action="test-next">${TEXT.testNext}</button>
        <button data-action="export-logs">${TEXT.exportLogs}</button>
        <button data-action="clear-logs">${TEXT.clearLogs}</button>
        <button data-action="reset-all">${TEXT.resetAll}</button>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.title}</strong></div>
        <div>${escapeHtml(shorten(titleText, 90))}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.pageType}</strong></div>
        <div>${escapeHtml(pageTypeText)}</div>
        <div class="tm-mini">${TEXT.version}: ${escapeHtml(SCRIPT_VERSION)}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.autoplayState}</strong></div>
        <div>${escapeHtml(state.autoplayStateText)}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.playbackRate}</strong></div>
        <div>${escapeHtml(state.playbackRateStatusText)}</div>
        <div class="tm-mini">${state.currentVideo ? escapeHtml(formatRate(collectVideoSnapshot(state.currentVideo).playbackRate)) : TEXT.noVideo}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.videoSelector}</strong></div>
        <code>${escapeHtml(videoSelector)}</code>
        <div class="tm-mini">${state.currentVideo ? escapeHtml(JSON.stringify(collectVideoSnapshot(state.currentVideo))) : TEXT.noVideo}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.nextSelector}</strong></div>
        <code>${escapeHtml(nextSelector)}</code>
        <div class="tm-mini">${escapeHtml(shorten(state.currentNextButton ? getText(state.currentNextButton) : TEXT.notFound, 120))}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.progressInfo}</strong></div>
        <div>${escapeHtml(shorten(progressText, 120))}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.currentStatus}</strong></div>
        <div>${escapeHtml(state.lastStatusText)}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.nextTarget}</strong></div>
        <div>${escapeHtml(shorten(nextTargetText, 140))}</div>
        <div class="tm-mini">${escapeHtml(nextResolutionText)}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.logCount}</strong>: ${Array.isArray(logs) ? logs.length : 0}</div>
        <div class="tm-mini">${recentLogs[0] ? escapeHtml(formatLogLine(recentLogs[0])) : TEXT.noLogs}</div>
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.recentLogs}</strong></div>
        <div class="tm-log-list">${renderRecentLogs(recentLogs)}</div>
      </div>

      ${isQuizPage() ? `
      <div class="tm-card">
        <div><strong>${TEXT.quizNoticeTitle}</strong></div>
        <div>${escapeHtml(TEXT.quizNoticeBody)}</div>
      </div>
      ` : ''}
    `;
  }

  // 汇总当前脚本状态，便于一眼排查。
  function buildStatusText() {
    const parts = [
      `URL: ${location.href}`,
      `Page: ${getPageTypeText(state.pageType)}`,
      `Title: ${state.currentTitle ? getText(state.currentTitle) : document.title}`,
      `Video: ${state.currentVideo ? TEXT.videoFound : TEXT.videoMissing}`,
      `Next: ${(state.currentNextButton || state.lastResolvedNext) ? TEXT.nextFound : TEXT.nextMissing}`,
      `NextSource: ${state.lastResolvedNext?.source || state.currentNextButtonSource || TEXT.notFound}`,
      `AutoPlay: ${state.autoplayStateText}`,
      `Rate: ${state.playbackRateStatusText}`,
      `Mode: ${CONFIG.dryRun ? TEXT.modeDryRun : TEXT.modeRealClick}`,
    ];
    return parts.join(' | ');
  }

  function getPageTypeText(pageType) {
    switch (pageType) {
      case 'video':
        return TEXT.pageVideo;
      case 'activity':
        return `${TEXT.pageActivity} (${getModTypeFromPath(location.pathname) || 'unknown'})`;
      case 'forum-view':
        return '讨论列表页';
      case 'forum-discuss':
        return '讨论详情页';
      case 'quiz-view':
        return TEXT.pageQuizView;
      case 'quiz-attempt':
        return TEXT.pageQuizAttempt;
      case 'quiz-summary':
        return TEXT.pageQuizSummary;
      default:
        return TEXT.pageOther;
    }
  }

  // 一键清空脚本存储。
  function hardReset() {
    storageDelete(CONFIG.storageKeys.logs);
    storageDelete(CONFIG.storageKeys.settings);
    storageDelete(CONFIG.storageKeys.bootstrap);
    storageDelete(CONFIG.storageKeys.pendingAutoplay);

    for (const key of CONFIG.legacyKeys) {
      storageDelete(key);
    }

    alert(TEXT.oldDataCleared);
    location.reload();
  }

  // 导出日志，方便排障。
  function exportLogs() {
    const logs = storageGet(CONFIG.storageKeys.logs, []);
    const exported = {
      meta: {
        exportedAt: new Date().toISOString(),
        scriptVersion: SCRIPT_VERSION,
        url: location.href,
        pageType: state.pageType,
        pageTypeText: getPageTypeText(state.pageType),
        title: state.currentTitle ? getText(state.currentTitle) : document.title,
        dryRun: CONFIG.dryRun,
        logCount: Array.isArray(logs) ? logs.length : 0,
      },
      logs,
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `lms-autonext-v${SCRIPT_VERSION}-logs-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 统一写日志。
  function logEvent(type, payload) {
    const logs = storageGet(CONFIG.storageKeys.logs, []);
    logs.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
      version: SCRIPT_VERSION,
      type,
      pageType: state.pageType,
      pageTypeText: getPageTypeText(state.pageType),
      url: location.href,
      referrer: document.referrer || '',
      pageTitle: document.title,
      courseTitle: state.currentTitle ? getText(state.currentTitle) : document.title,
      dryRun: CONFIG.dryRun,
      payload,
    });
    storageSet(CONFIG.storageKeys.logs, logs.slice(-CONFIG.maxLogs));
  }

  // 下面是一些底层工具函数。
  function storageGet(key, fallbackValue) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = GM_getValue(key);
        return value == null ? fallbackValue : value;
      }

      const raw = localStorage.getItem(key);
      return raw == null ? fallbackValue : JSON.parse(raw);
    } catch (_) {
      return fallbackValue;
    }
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }

      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function storageDelete(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
      }
    } catch (_) {}

    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }

  // 安全查询，避免坏选择器让脚本整体崩掉。
  function safeQuery(selector) {
    try {
      return document.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  // 提取节点文本。图标按钮的文案常见于 aria-label/title，也一并读取。
  function getText(el) {
    if (!el) return '';

    const parts = [
      el.innerText,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('data-original-title'),
      el.getAttribute?.('alt'),
    ];

    if (typeof el.querySelectorAll === 'function') {
      for (const image of Array.from(el.querySelectorAll('img[alt]'))) {
        parts.push(image.getAttribute('alt'));
      }
    }

    return parts
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 生成一个尽量稳定的选择器，主要用于调试和日志。
  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return `#${cssEscape(el.id)}`;

    const doc = el.ownerDocument || document;
    const parts = [];
    let current = el;
    let depth = 0;

    while (current && current.nodeType === 1 && depth < 4) {
      let part = current.tagName.toLowerCase();
      const classes = Array.from(current.classList || []).slice(0, 2);

      if (classes.length) {
        part += classes.map((cls) => `.${cssEscape(cls)}`).join('');
      }

      const parent = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (sameTag.length > 1) {
          part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      const selector = parts.join(' > ');

      try {
        if (doc.querySelectorAll(selector).length === 1) {
          return selector;
        }
      } catch (_) {}

      current = current.parentElement;
      depth += 1;
    }

    return parts.join(' > ');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  // 只把可见节点当候选，避免误识别隐藏元素。支持同源 iframe 内的元素。
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;

    try {
      const rect = el.getBoundingClientRect();
      const view = el.ownerDocument?.defaultView || window;
      const style = view.getComputedStyle(el);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden';
    } catch (_) {
      return false;
    }
  }

  function normalizeClass(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  }

  function absolutizeUrl(rawUrl, baseUrl) {
    try {
      return new URL(String(rawUrl || ''), baseUrl || location.href).href;
    } catch (_) {
      return '';
    }
  }

  // 只有确定是视频模块时才返回 true；page/resource 等可能含视频的
  // 模块单独走 isVideoCapablePage 的探测逻辑。
  function pageLooksLikeVideo(url) {
    const type = classifyModType(url);
    return ['fsresource', 'videofile', 'video', 'videos', 'vod', 'recordings'].includes(type);
  }

  function pageLooksLikeForum(url) {
    const value = String(url || '');
    return value.includes('/mod/forum/view.php') ||
      value.includes('/mod/forum/discuss.php');
  }

  function getRecentLogs(logs) {
    if (!Array.isArray(logs)) return [];
    return logs.slice(-CONFIG.recentLogsLimit).reverse();
  }

  function renderRecentLogs(logs) {
    if (!Array.isArray(logs) || !logs.length) {
      return `<div class="tm-mini">${escapeHtml(TEXT.noLogs)}</div>`;
    }

    return logs.map((log) => `<div class="tm-log-item">${escapeHtml(formatLogLine(log))}</div>`).join('');
  }

  function formatLogLine(log) {
    const timeText = formatLocalTime(log?.time);
    const typeText = String(log?.type || 'unknown');
    const detailText = summarizeLogDetail(log);
    return detailText ? `${timeText} | ${typeText} | ${detailText}` : `${timeText} | ${typeText}`;
  }

  function summarizeLogDetail(log) {
    const payload = log && log.payload ? log.payload : {};

    if (payload.reason && payload.href) {
      return `${payload.reason} -> ${shorten(payload.href, 60)}`;
    }
    if (payload.reason && payload.to) {
      return `${payload.reason} -> ${shorten(payload.to, 60)}`;
    }
    if (payload.source && payload.href) {
      return `${payload.source} -> ${shorten(payload.href, 60)}`;
    }
    if (payload.reason) {
      return String(payload.reason);
    }
    if (payload.pageType) {
      return String(payload.pageType);
    }
    if (payload.url) {
      return shorten(String(payload.url), 60);
    }
    return '';
  }

  function formatLocalTime(input) {
    try {
      const date = new Date(input);
      if (Number.isNaN(date.getTime())) return '--:--:--';
      return date.toLocaleTimeString('zh-CN', { hour12: false });
    } catch (_) {
      return '--:--:--';
    }
  }

  function buildNextTargetText() {
    if (state.lastResolvedNext && state.lastResolvedNext.href) {
      return `${state.lastResolvedNext.source} -> ${state.lastResolvedNext.href}`;
    }

    if (state.currentNextButton) {
      const nextHref = resolveNextHref(state.currentNextButton);
      const source = state.currentNextButtonSource || getText(state.currentNextButton);
      return `${source} -> ${nextHref || TEXT.notFound}`;
    }

    return TEXT.notFound;
  }

  function buildNextResolutionText() {
    const target = state.lastResolvedNext;
    if (!target) {
      return `${TEXT.nextSource}: ${state.currentNextButtonSource || TEXT.notFound}`;
    }
    return `${TEXT.nextSource}: ${target.source || TEXT.notFound} | ${TEXT.nextKind}: ${getTargetKindText(target)}`;
  }

  function getTargetKindText(target) {
    const type = (target && target.type) || classifyModType(target && target.href);
    if (pageLooksLikeVideo(target && target.href)) return TEXT.kindVideo;
    if (type === 'quiz') return TEXT.kindQuiz;
    if (type === 'forum') return TEXT.kindForum;
    return type ? `${TEXT.kindOther} (${type})` : TEXT.kindOther;
  }

  function formatRate(value) {
    return `${Number(round(Number(value || 0), 2)).toFixed(2)}x`;
  }

  function pageLooksLikeQuiz(url) {
    const value = String(url || '');
    return value.includes('/mod/quiz/view.php') ||
      value.includes('/mod/quiz/attempt.php') ||
      value.includes('/mod/quiz/summary.php');
  }

  function round(num, digits) {
    const base = 10 ** digits;
    return Math.round((Number(num) || 0) * base) / base;
  }

  function shorten(text, max) {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, max - 1)}...` : value;
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // 面板样式。
  function installStyle() {
    GM_addStyle(`
      #${CONFIG.panelId} {
        position: fixed;
        right: 12px;
        bottom: 12px;
        z-index: 2147483647;
        width: 360px;
        max-height: 75vh;
        overflow: auto;
        background: rgba(17, 24, 39, 0.96);
        color: #e5e7eb;
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        font: 12px/1.5 Consolas, Monaco, monospace;
      }

      #${CONFIG.panelId} * {
        box-sizing: border-box;
      }

      #${CONFIG.panelId} .tm-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }

      #${CONFIG.panelId}.is-collapsed {
        width: 220px;
      }

      #${CONFIG.panelId}.is-collapsed .tm-body {
        display: none;
      }

      #${CONFIG.panelId} .tm-title {
        font-weight: 700;
        color: #f9fafb;
      }

      #${CONFIG.panelId} .tm-head-left {
        min-width: 0;
      }

      #${CONFIG.panelId} .tm-version {
        margin-top: 2px;
        color: #94a3b8;
        font-size: 11px;
      }

      #${CONFIG.panelId} .tm-head-right {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #${CONFIG.panelId} .tm-collapse-button {
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.08);
        color: #fff;
        padding: 4px 8px;
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
      }

      #${CONFIG.panelId} .tm-badge {
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.18);
        color: #fde68a;
      }

      #${CONFIG.panelId} .tm-badge.ok {
        background: rgba(16, 185, 129, 0.18);
        color: #a7f3d0;
      }

      #${CONFIG.panelId} .tm-body {
        padding: 10px;
      }

      #${CONFIG.panelId} .tm-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 10px;
      }

      #${CONFIG.panelId} button {
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.08);
        color: #fff;
        padding: 5px 8px;
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
      }

      #${CONFIG.panelId} .tm-card {
        margin-bottom: 8px;
        padding: 8px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        background: rgba(255,255,255,0.03);
      }

      #${CONFIG.panelId} code {
        display: block;
        margin-top: 6px;
        padding: 6px;
        border-radius: 6px;
        background: rgba(0,0,0,0.24);
        color: #bfdbfe;
        white-space: pre-wrap;
        word-break: break-all;
      }

      #${CONFIG.panelId} .tm-mini {
        margin-top: 6px;
        color: #cbd5e1;
        white-space: pre-wrap;
        word-break: break-word;
      }

      #${CONFIG.panelId} .tm-log-list {
        margin-top: 6px;
      }

      #${CONFIG.panelId} .tm-log-item {
        padding: 4px 0;
        border-top: 1px solid rgba(255,255,255,0.06);
        color: #cbd5e1;
        white-space: pre-wrap;
        word-break: break-word;
      }

      #${CONFIG.panelId} .tm-log-item:first-child {
        border-top: none;
        padding-top: 0;
      }

      #${CONFIG.panelId}-quiz-reminder,
      #${CONFIG.panelId}-rate-reminder {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
      }

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-mask,
      #${CONFIG.panelId}-rate-reminder .tm-quiz-mask {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
      }

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-dialog,
      #${CONFIG.panelId}-rate-reminder .tm-quiz-dialog {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(520px, calc(100vw - 32px));
        padding: 18px;
        border-radius: 14px;
        background: #ffffff;
        color: #111827;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
      }

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-title,
      #${CONFIG.panelId}-rate-reminder .tm-quiz-title {
        font: 700 20px/1.3 "Microsoft YaHei", sans-serif;
        margin-bottom: 12px;
      }

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-body,
      #${CONFIG.panelId}-rate-reminder .tm-quiz-body {
        font: 14px/1.7 "Microsoft YaHei", sans-serif;
        margin-bottom: 16px;
      }

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-button,
      #${CONFIG.panelId}-rate-reminder .tm-quiz-button {
        border: none;
        background: #166534;
        color: #fff;
        padding: 10px 16px;
        border-radius: 8px;
        cursor: pointer;
        font: 14px/1 "Microsoft YaHei", sans-serif;
      }

      #${CONFIG.panelId}-play-hint {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        z-index: 2147483647;
      }

      #${CONFIG.panelId}-play-hint button {
        border: none;
        background: #166534;
        color: #fff;
        padding: 10px 18px;
        border-radius: 999px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        cursor: pointer;
        font: 14px/1 "Microsoft YaHei", sans-serif;
      }

      #${CONFIG.panelId}-play-hint button:hover {
        background: #14532d;
      }
    `);
  }
})();
