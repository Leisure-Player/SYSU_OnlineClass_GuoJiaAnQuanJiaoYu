// ==UserScript==
// @name         LMS Video Auto Next (Commented)
// @namespace    https://test.top/
// @version      1.1.6
// @description  视频页自动监测与跳转；测验页只做提示，不自动作答
// @author       ChatGPT
// @match        https://lms.sysu.edu.cn/mod/fsresource/view.php*
// @match        https://lms.sysu.edu.cn/mod/quiz/view.php*
// @match        https://lms.sysu.edu.cn/mod/quiz/attempt.php*
// @match        https://lms.sysu.edu.cn/mod/quiz/summary.php*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function () {
  'use strict';

  // 面板展示文案统一放在这里，后面改字更方便。
  const TEXT = {
    panelTitle: 'LMS Auto Next',
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
    currentStatus: '当前状态',
    logCount: '日志数量',
    notFound: '未找到',
    noVideo: '无视频',
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
    pageOther: '其他页面',
    quizNoticeTitle: '测验提示',
    quizNoticeBody: '已检测到章节测验页。脚本不会自动作答、自动选项或自动提交，请手动完成。',
    autoplayState: '自动续播',
    autoplayPending: '等待续播',
    autoplayActive: '续播中',
    autoplayRecovering: '恢复播放中',
    autoplayIdle: '未触发',
    reminderAcknowledge: '知道了',
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

    // 测验页提醒配置。
    quizReminder: {
      enabled: true,
      beepCount: 3,
      beepIntervalMs: 700,
      beepDurationMs: 220,
      beepFrequency: 880,
    },

    // 关键元素选择器。
    selectors: {
      video: [
        '#fsplayer-container-id_html5_api',
        '.video-js video',
        'video',
      ],
      nextButton: [
        '#next-activity-link',
        '.activity-navigation a#next-activity-link',
        '.activity-navigation a[href*="/mod/fsresource/view.php"]',
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

    // 当显式选择器找不到下一节时，用这些关键词做兜底匹配。
    nextKeywords: [
      '下一节',
      '下一课',
      '下一章',
      '继续学习',
      '继续播放',
      'next',
      'continue',
    ],

    negativeKeywords: [
      '上一节',
      '上一课',
      '上一章',
      '返回',
      'back',
      'prev',
      'previous',
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
    currentNextButton: null,
    currentTitle: null,
    currentProgress: null,
    videoListeners: [],
    sampleTimer: null,
    mutationTimer: null,
    autoplayTimer: null,
    pauseResumeTimer: null,
    autoplayAttempts: 0,
    pauseResumeAttempts: 0,
    autoplayStateText: TEXT.autoplayIdle,
    nextLockUntil: 0,
    observer: null,
    lastRouteUrl: location.href,
    lastStatusText: '',
    lastQuizReminderUrl: '',
    lastUserPauseIntentAt: 0,
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
    if (path.includes('/mod/quiz/view.php')) return 'quiz-view';
    if (path.includes('/mod/quiz/attempt.php')) return 'quiz-attempt';
    if (path.includes('/mod/quiz/summary.php')) return 'quiz-summary';
    return 'other';
  }

  function isQuizPage() {
    return state.pageType.startsWith('quiz');
  }

  // 每次扫描都重新识别页面类型和关键节点。
  function scanPage(reason) {
    state.pageType = detectPageType();
    clearVideoHooks();
    resetResolvedNodes();
    consumePendingArrival();

    // 测验页只做提示，不做答题相关自动化。
    if (isQuizPage()) {
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

    state.currentVideo = findVideo();
    state.currentNextButton = findNextButton();
    state.currentTitle = findTitleElement();
    state.currentProgress = findProgressElement();

    if (state.currentVideo) {
      attachVideoHooks(state.currentVideo);
      const resumedFromContext = maybeResumePlaybackAfterJump();
      if (!resumedFromContext) {
        maybeAutoPlayOnVideoPageOpen();
      }
    }

    state.lastStatusText = buildStatusText();
    updatePanel();
    logEvent('scan.complete', {
      reason,
      found: {
        video: !!state.currentVideo,
        nextButton: !!state.currentNextButton,
        title: !!state.currentTitle,
        progress: !!state.currentProgress,
      },
    });
  }

  function resetResolvedNodes() {
    state.currentVideo = null;
    state.currentNextButton = null;
    state.currentTitle = null;
    state.currentProgress = null;
  }

  // 优先按已知选择器识别视频元素。
  function findVideo() {
    for (const selector of CONFIG.selectors.video) {
      const el = safeQuery(selector);
      if (el instanceof HTMLVideoElement) return el;
    }

    const visibleVideos = Array.from(document.querySelectorAll('video')).filter(isVisible);
    return visibleVideos[0] || document.querySelector('video') || null;
  }

  // 优先按已知选择器找“下一节”；找不到时再退化到关键词评分。
  function findNextButton() {
    for (const selector of CONFIG.selectors.nextButton) {
      const el = safeQuery(selector);
      if (el && isVisible(el)) return el;
    }

    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"]'))
      .filter(isVisible)
      .map((el) => ({ el, score: scoreNextButton(el) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.el || null;
  }

  // 给“下一节”候选项打分，分高的优先。
  function scoreNextButton(el) {
    const text = getText(el).toLowerCase();
    const sign = `${el.id || ''} ${normalizeClass(el.className)} ${el.getAttribute('href') || ''}`.toLowerCase();
    let score = 0;

    for (const keyword of CONFIG.nextKeywords) {
      if (text.includes(keyword.toLowerCase())) score += 10;
      if (sign.includes(keyword.toLowerCase())) score += 6;
    }

    for (const keyword of CONFIG.negativeKeywords) {
      if (text.includes(keyword.toLowerCase())) score -= 12;
      if (sign.includes(keyword.toLowerCase())) score -= 8;
    }

    if (el.id === 'next-activity-link') score += 20;
    if (sign.includes('next-activity')) score += 10;
    if (el.closest('.activity-navigation')) score += 8;
    if (el.tagName === 'A') score += 2;

    return score;
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
    bindManualPauseIntentHooks(video);
    const events = ['play', 'pause', 'ended', 'seeking', 'seeked', 'ratechange'];

    for (const eventName of events) {
      const handler = () => {
        const snapshot = collectVideoSnapshot(video);
        state.lastStatusText = buildStatusText();
        updatePanel();
        logEvent(`video.${eventName}`, snapshot);

        if (eventName === 'play') {
          clearPauseRecoveryState();
        }

        if (eventName === 'pause') {
          maybeRecoverUnexpectedPause(snapshot, 'pause-event');
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
      if (!document.contains(video)) {
        scheduleRescan('video-detached');
        return;
      }

      const snapshot = collectVideoSnapshot(video);
      state.lastStatusText = buildStatusText();
      updatePanel();
      logEvent('video.sample', snapshot);

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

    state.autoplayAttempts = 0;
    state.pauseResumeAttempts = 0;
    state.autoplayStateText = TEXT.autoplayIdle;
  }

  // 记录“用户刚刚动过播放器”，避免用户手动暂停时脚本立刻抢着恢复。
  function bindManualPauseIntentHooks(video) {
    const candidates = [
      video,
      video.closest('.video-js'),
      video.closest('#player-con'),
      video.parentElement,
      document,
    ].filter(Boolean);

    const uniqueTargets = Array.from(new Set(candidates));

    uniqueTargets.forEach((target) => {
      const pointerHandler = () => {
        state.lastUserPauseIntentAt = Date.now();
      };

      target.addEventListener('pointerdown', pointerHandler, true);
      state.videoListeners.push({ target, eventName: 'pointerdown', handler: pointerHandler });

      if (target === document) {
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

  // 统一处理“跳下一节”逻辑，含 dryRun 和防重复锁。
  function maybeGoNext(reason, snapshot) {
    if (!state.currentNextButton) {
      logEvent('next.not-found', { reason, snapshot });
      return;
    }

    if (!isSafeAdvanceTrigger(reason, snapshot)) {
      logEvent('next.ignored-unsafe-trigger', {
        reason,
        snapshot,
      });
      return;
    }

    if (Date.now() < state.nextLockUntil) {
      logEvent('next.locked', {
        reason,
        snapshot,
        lockUntil: state.nextLockUntil,
      });
      return;
    }

    state.nextLockUntil = Date.now() + CONFIG.clickLockMs;

    const nextHref = resolveNextHref(state.currentNextButton);
    const payload = {
      reason,
      dryRun: CONFIG.dryRun,
      nextText: getText(state.currentNextButton),
      nextSelector: buildSelector(state.currentNextButton),
      href: nextHref,
      snapshot,
    };

    if (CONFIG.dryRun) {
      logEvent('next.dry-run', payload);
      return;
    }

    logEvent('next.navigate', payload);
    performNextNavigation(state.currentNextButton, nextHref, reason);
  }

  // 对所有自动跳页触发再做一层硬校验，防止播放器中途误报 ended。
  function isSafeAdvanceTrigger(reason, snapshot) {
    if (reason === 'manual-test') return true;
    if (!snapshot) return false;
    if (reason === 'ratio-threshold') {
      return CONFIG.allowProgressFallback && isSnapshotNearVideoEnd(snapshot);
    }
    if (reason === 'video-ended' || reason === 'video-ended-sample') {
      return snapshot.ended && isSnapshotNearVideoEnd(snapshot);
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

    try {
      return new URL(rawHref, location.href).href;
    } catch (_) {
      return '';
    }
  }

  // 当前版本采用“硬跳”策略：只要有 href，就直接跳过去。
  function performNextNavigation(el, href, reason) {
    if (!href) {
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

    if (pending.targetUrl && sameUrl(pending.targetUrl, location.href)) {
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
        return;
      }

      if (state.pageType !== 'video') {
        storageDelete(CONFIG.storageKeys.pendingAutoplay);
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

    const directArrival = pending.targetUrl && sameUrl(pending.targetUrl, location.href);
    const quizBridgeArrival = !!pending.resumeOnNextVideo && pageLooksLikeQuiz(document.referrer);
    if (!directArrival && !quizBridgeArrival) return false;

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
  function maybeAutoPlayOnVideoPageOpen() {
    if (!CONFIG.autoPlay.enabled || !state.currentVideo) return;

    const video = state.currentVideo;
    if (video.ended) return;
    if (!video.paused) {
      state.autoplayStateText = TEXT.autoplayActive;
      state.lastStatusText = buildStatusText();
      updatePanel();
      return;
    }

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
    if (!video || !document.contains(video)) return;

    if (!video.paused && !video.ended) {
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
    if (!video || !document.contains(video) || video.ended) {
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
  }

  function finalizeAutoplayAttempt(reason) {
    const video = state.currentVideo;
    if (!video) return;

    if (!video.paused && !video.ended) {
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
  }

  // 有些播放器对 video.play() 不敏感，所以再尝试点一次播放控件。
  function tryClickPlayControls() {
    const controls = [
      '.vjs-big-play-button',
      '.vjs-play-control',
      'button[title*="播放"]',
      'button[aria-label*="播放"]',
      '[class*="play-button"]',
    ];

    for (const selector of controls) {
      const button = safeQuery(selector);
      if (button && isVisible(button)) {
        smartClick(button);
        return;
      }
    }

    if (state.currentVideo) {
      smartClick(state.currentVideo);
    }
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

    logEvent('route.change', {
      trigger,
      url: location.href,
      title: document.title,
    });

    setTimeout(() => scanPage(`route:${trigger}`), CONFIG.routeSettleMs);
  }

  // 监听 DOM 变化，兼容异步渲染页面。
  function observeDom() {
    state.observer = new MutationObserver((mutations) => {
      // 测验页有倒计时，DOM 会频繁变化，这里直接忽略，避免日志刷屏。
      if (state.pageType !== 'video') return;

      const meaningful = mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length);
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
        <div class="tm-title">${TEXT.panelTitle}</div>
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
      </div>

      <div class="tm-card">
        <div><strong>${TEXT.autoplayState}</strong></div>
        <div>${escapeHtml(state.autoplayStateText)}</div>
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
        <div><strong>${TEXT.logCount}</strong>: ${Array.isArray(logs) ? logs.length : 0}</div>
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
      `Next: ${state.currentNextButton ? TEXT.nextFound : TEXT.nextMissing}`,
      `AutoPlay: ${state.autoplayStateText}`,
      `Mode: ${CONFIG.dryRun ? TEXT.modeDryRun : TEXT.modeRealClick}`,
    ];
    return parts.join(' | ');
  }

  function getPageTypeText(pageType) {
    switch (pageType) {
      case 'video':
        return TEXT.pageVideo;
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

    for (const key of CONFIG.legacyKeys) {
      storageDelete(key);
    }

    alert(TEXT.oldDataCleared);
    location.reload();
  }

  // 导出日志，方便排障。
  function exportLogs() {
    const logs = storageGet(CONFIG.storageKeys.logs, []);
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `lms-autonext-logs-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 统一写日志。
  function logEvent(type, payload) {
    const logs = storageGet(CONFIG.storageKeys.logs, []);
    logs.push({
      time: new Date().toISOString(),
      type,
      url: location.href,
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

  // 提取节点文本。
  function getText(el) {
    return String(
      el?.innerText ||
      el?.textContent ||
      el?.getAttribute?.('aria-label') ||
      ''
    ).replace(/\s+/g, ' ').trim();
  }

  // 生成一个尽量稳定的选择器，主要用于调试和日志。
  function buildSelector(el) {
    if (!el || !(el instanceof Element)) return '';
    if (el.id) return `#${cssEscape(el.id)}`;

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
        if (document.querySelectorAll(selector).length === 1) {
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

  // 只把可见节点当候选，避免误识别隐藏元素。
  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden';
  }

  function normalizeClass(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  }

  function pageLooksLikeQuiz(url) {
    const value = String(url || '');
    return value.includes('/mod/quiz/view.php') ||
      value.includes('/mod/quiz/attempt.php') ||
      value.includes('/mod/quiz/summary.php');
  }

  function sameUrl(a, b) {
    try {
      return new URL(a, location.href).href === new URL(b, location.href).href;
    } catch (_) {
      return String(a || '') === String(b || '');
    }
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

      #${CONFIG.panelId}-quiz-reminder {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
      }

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-mask {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
      }

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-dialog {
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

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-title {
        font: 700 20px/1.3 "Microsoft YaHei", sans-serif;
        margin-bottom: 12px;
      }

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-body {
        font: 14px/1.7 "Microsoft YaHei", sans-serif;
        margin-bottom: 16px;
      }

      #${CONFIG.panelId}-quiz-reminder .tm-quiz-button {
        border: none;
        background: #166534;
        color: #fff;
        padding: 10px 16px;
        border-radius: 8px;
        cursor: pointer;
        font: 14px/1 "Microsoft YaHei", sans-serif;
      }
    `);
  }
})();
