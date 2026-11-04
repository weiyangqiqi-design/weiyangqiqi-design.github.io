/**
 * 简历首页 - 交互逻辑
 * - Tab 锚点定位 + active 切换(支持滚动联动)
 * - hover 提示点击复制(由 CSS 实现)
 * - 点击复制到剪贴板 + toast 提示
 */

(function () {
  "use strict";

  /* ============ 人像视频 + 卡片 banner 视频:自动播放 + 循环兜底 ============ */
  // loop 属性理论上足够,但部分浏览器/内嵌预览会忽略,这里加 JS 双保险:
  // 1) ended 时强制重头播放  2) 自动播放被拦截时,首次交互后补播
  (function initAvatarVideo() {
    const videos = document.querySelectorAll(".sidebar__avatar video, .module-card__img video");
    if (!videos.length) return;
    videos.forEach((v) => {
      v.muted = true;          // 自动播放硬性前提
      v.loop = true;           // 再次确保 loop 打开
      v.setAttribute("playsinline", "");

      const tryPlay = () => {
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      };

      // 播放结束兜底:即便 loop 被忽略也强制回到起点重播
      v.addEventListener("ended", () => {
        v.currentTime = 0;
        tryPlay();
      });

      // 自动播放被策略拦截时,监听首次用户交互补播
      const resume = () => {
        tryPlay();
        window.removeEventListener("pointerdown", resume);
        window.removeEventListener("keydown", resume);
      };
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });

      tryPlay();
    });
  })();

  /* ============ Tab 锚点定位 ============ */
  const tabs = document.querySelectorAll(".tab");
  const sections = document.querySelectorAll(".tl-row");

  // 当前选中的 tab id(用来判断是否真的发生了切换 —— 没换就不晃)
  let activeTabId = (function () {
    const cur = document.querySelector(".tab.active");
    return cur ? cur.dataset.target : null;
  })();

  function setActiveTab(targetId) {
    // 重复设置同一个 tab(滚动联动回访、连点)不再触发滑动与晃动,避免半路被打断
    if (targetId === activeTabId) return;
    activeTabId = targetId;
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.target === targetId);
    });
    // 选中态"液态玻璃水滴"跟着滑过去(iOS 26 那种:有过程,不是瞬移)
    placeTabDrop(true);
    // 同时让水滴本体甩起来(拉长 → 挤扁 → 回弹),幅度见 CSS @keyframes tab-drop-wobble
    glideWobble();
  }

  /* ============ 选中态「液态玻璃水滴」:在 tab 之间平滑滑动 ============
   * 水滴是 .tabs__items 里的独立元素(见 CSS .tab-drop),它的水平位置/宽度在这里算:
   *   坐标基准 = 容器的 padding box(即 left:0 的位置),所以只关心"相对容器"的偏移。
   *   1) 普通 tab:水滴比 tab 左右各宽 3px(视觉上把 tab 包起来);
   *   2) 第一个 tab:水滴左缘补齐到容器外缘(容器圆头半径 21px < 水滴 24px,端头被完整含住);
   *   3) 最后一个 tab:同理右缘补齐到容器外缘。
   * 位置用 --drop-x / --drop-w 写回 CSS,过渡由 CSS 负责;首次定位与 resize 用 is-instant 跳过动画。
   */
  const tabBar = document.querySelector(".tabs__items");
  const tabDrop = tabBar ? tabBar.querySelector(".tab-drop") : null;
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let tabDropPlaced = false;
  // 上一次真正写进 CSS 的目标(含容器基准),用来判断"几何到底变了没有"
  let tabDropLast = null;
  // 上一次"开始滑动"的时刻
  let lastGlideAt = -1e9;

  function placeTabDrop(mode) {
    // mode === true      → 带过渡滑过去(点页签 / 滚动联动)
    // mode === "instant" → 立即归位(首次定位、真实的尺寸/字体变化)
    if (!tabBar || !tabDrop) return;
    const list = Array.from(tabBar.querySelectorAll(".tab"));
    const active = list.find((t) => t.classList.contains("active"));
    if (!active) {
      tabDrop.style.opacity = "0";
      return;
    }
    tabDrop.style.opacity = "1";

    const barRect = tabBar.getBoundingClientRect();
    const cs = getComputedStyle(tabBar);
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const originLeft = barRect.left + bl; // padding box 左缘 = left:0 的位置
    const innerW = barRect.width - bl - br;
    const r = active.getBoundingClientRect();

    let x = r.left - originLeft - 3;
    let w = r.width + 6;

    if (active === list[0]) {
      // 左端:水滴外缘对齐容器外缘
      w += x + bl;
      x = -bl;
    }
    if (active === list[list.length - 1]) {
      // 右端:水滴外缘对齐容器外缘(容器右侧的留白 + 1px 描边都补进来)
      w = innerW + br - x;
    }

    /* 目标几乎没变 → 什么都不做。
       这一步是"某些 tab 不滑动"的关键修复:
       选中态的字重会从 500 变 600,像 "AI智能体应用"/"0-1复杂系统" 这种带西文的
       tab 一选中,整条会宽零点几~1 像素 → ResizeObserver / 字体就绪 / 延迟对齐里的
       重新测量就会紧接着被触发。若此时再走一遍下面的流程,为了"瞬间归位"临时挂上的
       .is-instant(transition:none)会把**正在跑的滑动过渡直接掐断**(CSS 规定:
       运行时把 transition-property 去掉 = 过渡取消并跳到终点),表现出来就是
       "点这几个 tab 水滴啪一下跳过去、不滑"。所以先比对,没真变化就直接返回。
       (容差 3px:字重变化带来的抖动 <2px,而相邻 tab 的距离 ≥80px,不会误判。) */
    if (
      tabDropLast &&
      Math.abs(x - tabDropLast.x) < 3 &&
      Math.abs(w - tabDropLast.w) < 3 &&
      Math.abs(barRect.left - tabDropLast.bl) < 3 &&
      Math.abs(barRect.width - tabDropLast.bw) < 3
    ) {
      return;
    }

    const instant = mode !== true || !tabDropPlaced || prefersReduced;
    if (instant) tabDrop.classList.add("is-instant");
    tabDrop.style.setProperty("--drop-x", x.toFixed(2) + "px");
    tabDrop.style.setProperty("--drop-w", w.toFixed(2) + "px");
    if (instant) {
      void tabDrop.offsetWidth; // 逼一次样式计算,确保"瞬间归位"不被过渡吃掉
      tabDrop.classList.remove("is-instant");
    }
    tabDropLast = { x, w, bl: barRect.left, bw: barRect.width };
    tabDropPlaced = true;
    if (mode === true) lastGlideAt = performance.now();
  }

  /* 切换时让水滴本体"晃"一下:本体是 .tab-drop 的内层元素(位移归外层,
     形变归内层),所以这里只是重启一次 CSS 动画。
     remove → 强制重排 → add 是重启同一动画的标准做法;
     prefers-reduced-motion 下 CSS 已把动画关掉,这里也不挂。 */
  let wobbleTimer = null;
  function glideWobble() {
    if (!tabDrop || prefersReduced) return;
    const body = tabDrop.querySelector(".tab-drop__body");
    if (!body) return;
    body.classList.remove("is-gliding");
    void body.offsetWidth; // 强制重排,让动画从头开始
    body.classList.add("is-gliding");
    if (wobbleTimer) clearTimeout(wobbleTimer);
    wobbleTimer = setTimeout(() => {
      body.classList.remove("is-gliding");
      wobbleTimer = null;
    }, 700);
  }

  /* 尺寸/字体变化后的重新对齐。
     正在滑动时(700ms 内)接着滑 —— 只是把目标改掉让过渡续着走,
     绝不瞬间归位,避免半路把动画掐断;平时才用"立即归位"。 */
  function realignTabDrop() {
    const gliding = performance.now() - lastGlideAt < 700;
    placeTabDrop(gliding ? true : "instant");
  }

  if (tabBar && tabDrop) {
    placeTabDrop("instant");

    // 字体替换 / 视口变化都会让 tab 宽度变、整条居中位置跟着挪,所以这些时机都要重新对齐。
    // 关键点:字体加载完成后 tab 会变窄(bar 收窄 → 居中时整体右移),不重算水滴就会偏。
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(realignTabDrop);
      ro.observe(tabBar);
      Array.from(tabBar.querySelectorAll(".tab")).forEach((t) => ro.observe(t));
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(realignTabDrop);
    }
    window.addEventListener("load", realignTabDrop);
    // 保险:字体/图片在 load 之后才落定的少数情况,再做几次延迟对齐
    [80, 400, 1200].forEach((d) => setTimeout(realignTabDrop, d));

    let dropTimer = null;
    window.addEventListener("resize", () => {
      if (dropTimer) clearTimeout(dropTimer);
      dropTimer = setTimeout(realignTabDrop, 120);
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = tab.dataset.target;
      const target = document.getElementById(targetId);
      if (!target) return;
      setActiveTab(targetId);
      // 锁定 observer,防止 smooth scroll 过程中覆盖高亮
      scrollLock = true;
      setTimeout(() => { scrollLock = false; }, 800);
      // 找到滚动容器(tabs 在 scroll 容器外,是常驻导航)
      const sc = document.querySelector(".content__scroll");
      if (sc) {
        // 精确计算:目标顶部在滚动容器内的绝对位置
        const containerRect = sc.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = sc.scrollTop + (targetRect.top - containerRect.top);
        sc.scrollTo({ top: offset, behavior: "smooth" });
      } else {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  /* ============ 滚动联动:根据可见 section 自动高亮 tab ============ */
  const scrollContainer = document.querySelector(".content__scroll");
  // 收集有对应 tab 的 section id(tl-honors 无 tab,排除)
  const tabTargetIds = new Set(Array.from(tabs).map((t) => t.dataset.target));
  // 追踪当前所有可见 section(解决 Observer 每次只报变化 entry 的问题)
  const visibleSections = new Set();
  // 点击 tab 触发 smooth scroll 时,短暂禁用 observer 更新,防止动画中途覆盖高亮
  let scrollLock = false;

  if (scrollContainer && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        // 更新可见集合
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visibleSections.add(entry.target.id);
          } else {
            visibleSections.delete(entry.target.id);
          }
        });
        // 被 tab 点击锁定期间不更新高亮
        if (scrollLock) return;
        // 从所有当前可见且有对应 tab 的 section 中,找最靠近顶部的
        let bestId = null;
        let bestTop = Infinity;
        visibleSections.forEach((id) => {
          if (!tabTargetIds.has(id)) return;
          const el = document.getElementById(id);
          if (!el) return;
          const top = el.getBoundingClientRect().top;
          if (top < bestTop) {
            bestTop = top;
            bestId = id;
          }
        });
        if (bestId) setActiveTab(bestId);
      },
      {
        root: scrollContainer,
        rootMargin: "-10% 0px -70% 0px",
        threshold: 0,
      }
    );
    sections.forEach((s) => io.observe(s));
  }

  /* ============ 复制到剪贴板 ============ */
  const toast = document.getElementById("toast");
  let toastTimer = null;

  function showToast(text) {
    if (!toast) return;
    const label = toast.querySelector("span");
    if (label && text) label.textContent = text;
    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 1800);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      // 退化到 textarea 方案
    }
    // Fallback: 临时 textarea + execCommand
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  /* 2026-10-14 第 74 项:复制反馈从「网页正中间 toast」改为「按钮自身状态变化」。
     用户反馈:toast 在页面正中间看不到(视线在左下角 contact 节点上,离得太远)。
     新交互:
       · hover/focus → .copy-tip 显示「点击复制」(保持原状)
       · 点击成功  → 同一个 chip 原地变成「✓ 已复制」+ .copied 态(紫→绿渐变 + 轻微 pop),
                     1500ms 后自动还原「点击复制」
       · 点击失败  → 同一个 chip 变成「复制失败」+ .copied.copied--err 态
     全站的 #toast 组件保留作为「找不到 chip」兜底;正常走的是 chip 状态翻转。 */
  document.querySelectorAll(".copyable").forEach((el) => {
    const chip = el.querySelector(".copy-tip");
    const DEFAULT_TEXT = chip ? chip.textContent : "点击复制";
    let revertTimer = null;

    const flashChip = (text, isErr) => {
      if (!chip) return false;
      if (revertTimer) {
        clearTimeout(revertTimer);
        revertTimer = null;
      }
      chip.textContent = text;
      chip.classList.remove("copied", "copied--err");
      // reflow 让动画每次都能重新播放
      // eslint-disable-next-line no-unused-expressions
      chip.offsetWidth;
      chip.classList.add("copied");
      if (isErr) chip.classList.add("copied--err");
      revertTimer = setTimeout(() => {
        chip.classList.remove("copied", "copied--err");
        chip.textContent = DEFAULT_TEXT;
        revertTimer = null;
      }, 1500);
      return true;
    };

    const handler = async (e) => {
      e.preventDefault();
      const text = el.dataset.copy || el.innerText.trim();
      if (!text) return;
      const ok = await copyText(text);
      if (ok) {
        if (!flashChip("✓ 已复制", false)) showToast("已复制到剪贴板");
      } else {
        if (!flashChip("复制失败", true)) showToast("复制失败,请手动复制");
      }
    };
    el.addEventListener("click", handler);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        handler(e);
      }
    });
  });

  /* ============ 左侧栏首屏自适应 ============
   * 策略:高度锁定为一屏,保证头像完整 + 所有信息完全展示(不滚动);
   *      宽度反向自适应——内容随侧栏宽度等比缩放,故按视口高度反推出合适宽度。
   * 做法:侧栏内容总高 H 与宽度 W 近似线性(H≈k·W+b),用 min/max 两个探针
   *      估出斜率,解出使 H=视口高 的 W,再夹在可读区间 [MIN,MAX]。 */
  (function initSidebarFit() {
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    // ★ 2026-10-10 用户明确回退:恢复「限高一屏 + 宽度自适应」,撤掉加宽。
    //   第 30 项曾把 MIN 240→300 / MAX 460→480(为了可读性给足宽度、下方允许滚动),
    //   实测观感是左侧信息区变胖、右侧被挤,用户判定效果不好 → 撤回。
    //   当前策略(即原始效果):宽度不是写死的,而是由「内容高度 = 视口高」反推出来的
    //   自适应值 —— 屏越高侧栏越宽,屏越矮侧栏自动收窄以塞进一屏(不出现滚动)。
    //   想重新加宽:把下面 MIN 提到 300、MAX 提到 480 即可(代价是内容会超出一屏)。
    // ★ 2026-10-12 第 51 项:240 → 232。
    //   背景:用户要求「左侧区域定高,尽量在极限情况下也不出现上下滑动」。
    //   MIN 是这个函数的"地板"—— 矮屏时装不下,fit() 会一路收窄直到撞到 MIN 为止;
    //   撞到 MIN 还装不下就必然溢出(可滚动)。原来 MIN=240 时,1440×900(可视 816px)
    //   的内容高正好 816px —— 卡在临界,没有 SAFE 余量,换个字体/缩放就会滑。
    //   降到 232 后 fit() 能再收 8px 左右,内容高落到 808 = 视口 - SAFE,留足安全余量;
    //   代价是正文字号 10.5 → 10.35px(-1.4%),仍明显大于加大之前的 9.46px。
    const MIN = 232; // 矮屏兜底的最小宽度(此时内容会略超一屏,允许滚动)
    const MAX = 460; // 大屏上限,避免侧栏过宽挤压右侧
    const SCALE = 1; // 严格一屏:目标高度=1屏,内容正好占满视口不滚动
    const CONTENT_MIN = 300; // 右侧内容区的最小可用宽度:窄屏时优先保证右侧不被挤没
    const SAFE = 8; // 安全余量:目标内容高度略小于视口,吸收亚像素/文字换行误差,防止出现滚动条

    // ≤560px(真手机竖屏)才切换为上下堆叠;560~900 及以上保持左固定+右自适应两栏
    const isMobile = () => window.matchMedia("(max-width: 560px)").matches;

    function measure(w) {
      sb.style.width = w + "px";
      sb.style.flexBasis = w + "px";
      // 关键:侧栏 height:100vh 会让 scrollHeight 被钳制成不小于视口高,
      // 必须临时改为 height:auto + 不拉伸,才能量到真实内容高。
      sb.style.height = "auto";
      sb.style.alignSelf = "flex-start";
      const h = sb.scrollHeight;
      sb.style.height = "";
      sb.style.alignSelf = "";
      return h;
    }

    function fit() {
      if (isMobile()) {
        // 移动端:恢复默认(全宽堆叠),不做首屏压缩
        sb.style.width = "";
        sb.style.flexBasis = "";
        return;
      }
      const vh = window.innerHeight * SCALE - SAFE;
      const hMax = measure(MAX);
      const hMin = measure(MIN);
      let w;
      if (hMax <= vh) {
        w = MAX; // 最大宽度都能装下 → 直接用最大,信息可读性最好
      } else if (hMin >= vh) {
        w = MIN; // 最小宽度仍装不下 → 用最小(极矮屏兜底,允许滚动)
      } else {
        const k = (hMax - hMin) / (MAX - MIN); // 每 1px 宽度对应的高度增量
        w = MIN + (vh - hMin) / k;
        // 迭代一次修正(切图比例与固定间距带来的非线性)
        const hh = measure(w);
        if (Math.abs(hh - vh) > 3) w = w - (hh - vh) / (k || 3);
        w = Math.max(MIN, Math.min(MAX, w));
      }
      // 窄屏软保护:侧栏按视口高度算出的宽度若会把右侧挤到 <CONTENT_MIN,
      // 则让侧栏适度收窄,始终给右侧自适应区留出可用空间(正常宽度下不触发,左侧保持固定)。
      const wCap = window.innerWidth - CONTENT_MIN;
      if (wCap >= MIN && w > wCap) w = wCap;
      // 防溢出收敛:拟合是近似(切图比例线性 + 联系方式卡文字换行/亚像素舍入会带来
      // 数像素误差),这里逐步收窄宽度,强制最终内容高度严格 ≤ 视口高(留 SAFE 余量),
      // 彻底消除侧栏 overflow-y:auto 因内容超出 1~3px 而产生的可上下滑动。
      const limit = window.innerHeight - SAFE;
      let guard = 0;
      while (w > MIN && measure(w) > limit && guard < 80) {
        w -= 1;
        guard++;
      }
      measure(Math.max(MIN, w));
    }

    // 图片/视频尺寸就绪后再测,resize 时重算
    fit();
    window.addEventListener("load", fit);
    window.addEventListener("resize", fit);
  })();

  /* ============ 卡片文字溢出检测:自动为超出的元素补 title 属性 ============
   * 检测 .module-card__title / .module-card__desc / .module-card__tags 三处,
   * 溢出时补 title(原生 tooltip),不溢出则移除,避免重复冗余的 hover 提示。
   * 首次渲染 + 字体加载完成 + 窗口 resize 都会重算。 */
  (function initOverflowTooltip() {
    const selectors = ".module-card__title, .module-card__desc, .module-card__tags";
    function checkAll() {
      document.querySelectorAll(selectors).forEach((el) => {
        // 用 scrollWidth/scrollHeight vs clientWidth/clientHeight 判溢出
        const overflowW = el.scrollWidth - el.clientWidth > 1;
        const overflowH = el.scrollHeight - el.clientHeight > 1;
        if (overflowW || overflowH) {
          el.title = el.textContent.trim().replace(/\s+/g, " ");
        } else {
          el.removeAttribute("title");
        }
      });
    }
    checkAll();
    // 字体 async 加载完成后可能触发文本宽度变化,重算一次
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(checkAll);
    }
    // resize 防抖
    let rTimer = null;
    window.addEventListener("resize", () => {
      if (rTimer) clearTimeout(rTimer);
      rTimer = setTimeout(checkAll, 150);
    });
  })();

  /* ============ 初始化:确保默认 tab 高亮 ============ */
  setActiveTab("tl-career");

  /* ============ 通用详情弹层 (Detail Modal) ============
   * 用法:给任意元素加 data-modal="<modal-id>" 即可触发对应 id 的弹层。
   * 弹层结构:
   *   <div id="<id>" class="detail-modal">
   *     <div class="detail-modal__panel">
   *       <button class="detail-modal__close">×</button>
   *       <div class="detail-modal__body">...内容...</div>
   *     </div>
   *   </div>
   * 特性:
   *   - 蒙层半透明毛玻璃 + 面板弹入动画
   *   - 面板内可上下滚动
   *   - 支持 video 标签自动暂停(关闭时)
   *   - 点击蒙层、点击关闭按钮、按 Escape 均可关闭
   *   - 打开时锁定页面滚动,关闭时恢复
   *   - 键盘焦点陷阱(Tab 循环在面板内)
   */
  (function initDetailModal() {
    var scrollbarW = 0;
    var openModal = null;
    var focusTrap = null;
    var triggerEl = null; // 记录打开者,关闭后还原焦点

    // ---- 滚动条宽度(避免 body 锁定时页面抖动) ----
    function getScrollbarWidth() {
      return window.innerWidth - document.documentElement.clientWidth;
    }

    // ---- 打开 ----
    function open(modal, from) {
      if (openModal) close(openModal, false);
      openModal = modal;
      triggerEl = from || null;
      scrollbarW = getScrollbarWidth();

      // 锁定 body 滚动
      document.body.style.overflow = "hidden";
      if (scrollbarW > 0) {
        document.body.style.paddingRight = scrollbarW + "px";
      }

      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");

      // 内嵌 Demo:首次打开时才写入 src
      // (避免 iframe 处于 display:none 的弹层内时被浏览器跳过加载而白屏)
      modal.querySelectorAll("iframe[data-embed-src]").forEach(function (frame) {
        if (!frame.getAttribute("src")) {
          frame.setAttribute("src", frame.getAttribute("data-embed-src"));
        }
      });

      // 双 rAF:先 display:flex 渲染,再加 is-visible 触发过渡
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          modal.classList.add("is-visible");
          // 焦点移入面板
          var panel = modal.querySelector(".detail-modal__panel");
          var closeBtn = modal.querySelector(".detail-modal__close");
          if (closeBtn) closeBtn.focus();
          // 建立焦点陷阱
          focusTrap = buildFocusTrap(panel);
          // 自动播放弹层内所有视频(静音循环),重新打开也会恢复播放
          modal.querySelectorAll("video").forEach(function (v) {
            v.muted = true;
            var p = v.play();
            if (p && typeof p.catch === "function") p.catch(function () {});
          });
        });
      });
    }

    // ---- 关闭 ----
    function close(modal, restoreFocus) {
      if (!modal) return;
      modal.classList.remove("is-visible");

      // 过渡结束后才隐藏 + 解锁
      function onEnd() {
        modal.removeEventListener("transitionend", onEnd);
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
        document.body.style.paddingRight = "";
        // 暂停所有视频
        modal.querySelectorAll("video").forEach(function (v) {
          v.pause();
        });
        if (restoreFocus !== false && triggerEl) {
          triggerEl.focus();
          triggerEl = null;
        }
        focusTrap = null;
        openModal = null;
      }

      var panel = modal.querySelector(".detail-modal__panel");
      if (panel) {
        panel.addEventListener("transitionend", onEnd, { once: true });
        // 兜底:如果 transitionend 没触发(transition 被禁用)
        setTimeout(onEnd, 350);
      } else {
        onEnd();
      }
    }

    // ---- 焦点陷阱 ----
    function buildFocusTrap(container) {
      return function (e) {
        if (e.key !== "Tab") return;
        var focusable = Array.from(
          container.querySelectorAll(
            'a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"])'
          )
        ).filter(function (el) {
          return el.offsetParent !== null;
        });
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
    }

    // ---- 全局键盘监听 ----
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openModal) {
        close(openModal, true);
      }
      if (focusTrap) focusTrap(e);
    });

    // ---- 触发器:所有带 data-modal 的元素 ----
    document.querySelectorAll("[data-modal]").forEach(function (trigger) {
      var modalId = trigger.dataset.modal;
      var modal = document.getElementById(modalId);
      if (!modal) return;

      function handleOpen(e) {
        // 阻止冒泡,避免触发父元素的其他事件
        e.stopPropagation();
        open(modal, trigger);
      }

      trigger.addEventListener("click", handleOpen);
      trigger.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleOpen(e);
        }
      });
    });

    // ---- 关闭按钮 ----
    document.querySelectorAll(".detail-modal__close").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var modal = btn.closest(".detail-modal");
        if (modal) close(modal, true);
      });
    });

    // ---- 点击蒙层关闭(点击面板外区域) ----
    document.querySelectorAll(".detail-modal").forEach(function (modal) {
      modal.setAttribute("aria-hidden", "true");
      modal.addEventListener("click", function (e) {
        if (e.target === modal) close(modal, true);
      });
    });

    // ---- 页签切换(带页签的弹层,如 AI陪伴) ----
    document.querySelectorAll(".detail-modal__tabs").forEach(function (tabbar) {
      var modal = tabbar.closest(".detail-modal");
      var tabs = Array.from(tabbar.querySelectorAll(".detail-modal__tab"));
      var body = modal.querySelector(".detail-modal__body");

      function activate(tabId) {
        tabs.forEach(function (t) {
          var on = t.dataset.tab === tabId;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        modal.querySelectorAll(".detail-modal__tabpanel").forEach(function (p) {
          var on = p.id === tabId;
          p.classList.toggle("is-active", on);
          if (on) p.removeAttribute("hidden");
          else p.setAttribute("hidden", "");
        });
        // 切换后回到顶部 + 刷新该面板视频播放状态
        if (body) body.scrollTop = 0;
        // ★ 2026-10-20:通知跳页索引按新页签重建(见 initSlidePager 的 dm:tab 监听)
        try {
          modal.dispatchEvent(new CustomEvent("dm:tab", { detail: { tab: tabId } }));
        } catch (err) {
          var ev = document.createEvent("CustomEvent");
          ev.initCustomEvent("dm:tab", false, false, { tab: tabId });
          modal.dispatchEvent(ev);
        }
        modal.querySelectorAll("video").forEach(function (v) {
          if (v.closest(".detail-modal__tabpanel.is-active")) {
            v.muted = true;
            var pr = v.play();
            if (pr && typeof pr.catch === "function") pr.catch(function () {});
          } else {
            v.pause();
          }
        });
      }

      tabs.forEach(function (t) {
        t.addEventListener("click", function () { activate(t.dataset.tab); });
      });
    });
  })();

  /* ============ 大图查看 Lightbox(荣誉/专利 6 图联通) ============
   * 用法:给同一组图加 data-gallery="<组名>" 即可(当前均为 "honors")。
   * 特性:
   *   - 点击任意一张图 → 打开大图(二级页面)
   *   - 左右按钮 / ← → 键 切换上一张 / 下一张(6 张互通,循环)
   *   - 底部缩略图条:点击缩略图直接跳转到对应大图,当前项高亮
   *   - 点击蒙层、关闭按钮、按 Escape 均可关闭
   *   - 打开时锁定页面滚动,关闭后还原焦点到触发图
   */
  (function initLightbox() {
    var box = document.getElementById("lightbox");
    if (!box) return;

    var imgEl = box.querySelector(".lightbox__img");
    var titleEl = box.querySelector(".lightbox__title");
    var counterEl = box.querySelector(".lightbox__counter");
    var thumbsEl = box.querySelector(".lightbox__thumbs");
    var btnPrev = box.querySelector(".lightbox__nav--prev");
    var btnNext = box.querySelector(".lightbox__nav--next");
    var btnClose = box.querySelector(".lightbox__close");

    var items = [];      // 当前组的图片节点(DOM 顺序)
    var index = 0;       // 当前显示序号
    var lastTrigger = null;
    var scrollbarW = 0;
    var closeTimer = null;

    // 收集某一组的所有图片,并据此重建缩略图条
    function collect(group) {
      items = Array.prototype.slice.call(
        document.querySelectorAll('[data-gallery="' + group + '"]')
      );
      thumbsEl.innerHTML = "";
      items.forEach(function (node, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "lightbox__thumb";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-label", "查看第 " + (i + 1) + " 张:" + (node.alt || ""));
        var im = document.createElement("img");
        im.src = node.currentSrc || node.src;
        im.alt = "";
        b.appendChild(im);
        b.addEventListener("click", function () { show(i); });
        thumbsEl.appendChild(b);
      });
    }

    // 显示第 i 张(自动环绕)
    function show(i) {
      if (!items.length) return;
      index = ((i % items.length) + items.length) % items.length;
      var node = items[index];
      imgEl.src = node.currentSrc || node.src;
      imgEl.alt = node.alt || "";
      titleEl.textContent = node.alt || "";
      counterEl.textContent = (index + 1) + " / " + items.length;

      Array.prototype.forEach.call(thumbsEl.children, function (t, k) {
        t.classList.toggle("is-active", k === index);
        t.setAttribute("aria-selected", k === index ? "true" : "false");
      });
      // 让当前缩略图滚入可视区
      var active = thumbsEl.children[index];
      if (active && active.scrollIntoView) {
        active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      }
    }

    function open(node) {
      var group = node.dataset.gallery;
      collect(group);
      lastTrigger = node;

      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      scrollbarW = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      if (scrollbarW > 0) document.body.style.paddingRight = scrollbarW + "px";

      var start = items.indexOf(node);
      show(start < 0 ? 0 : start);

      box.classList.add("is-open");
      box.setAttribute("aria-hidden", "false");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          box.classList.add("is-visible");
          if (btnClose) btnClose.focus();
        });
      });
    }

    function close() {
      if (!box.classList.contains("is-open")) return;
      box.classList.remove("is-visible");
      closeTimer = setTimeout(function () {
        closeTimer = null;
        box.classList.remove("is-open");
        box.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
        document.body.style.paddingRight = "";
        imgEl.removeAttribute("src");
        if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
        lastTrigger = null;
      }, 240);
    }

    // ---- 触发器:所有带 data-gallery 的图 ----
    var triggers = Array.prototype.slice.call(document.querySelectorAll("[data-gallery]"));
    triggers.forEach(function (node) {
      node.setAttribute("tabindex", "0");
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", (node.alt || "") + " — 点击查看大图");
      node.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        open(node);
      });
      node.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(node);
        }
      });
    });

    // ---- 控件 ----
    if (btnPrev) btnPrev.addEventListener("click", function () { show(index - 1); });
    if (btnNext) btnNext.addEventListener("click", function () { show(index + 1); });
    if (btnClose) btnClose.addEventListener("click", close);

    // 点击蒙层空白处关闭(点在图或控件上不关闭)
    box.addEventListener("click", function (e) {
      if (e.target === box || e.target === box.querySelector(".lightbox__stage")) close();
    });

    // ---- 键盘:← → 切换,Escape 关闭 ----
    document.addEventListener("keydown", function (e) {
      if (!box.classList.contains("is-open")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        show(index - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        show(index + 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
  })();

  /* ============ 螺旋上升卡片动效 (真·螺旋柱 Helix v4) ============
   * 卡片绕一根竖直中轴螺旋缠绕、整体向上流动:
   *   - 螺旋角 θ = s × 角步进 → 控制缠绕圈数(螺旋感强弱的关键)
   *   - 横向 x = sin(θ) × 半径   → 左右摆动(绕圈)
   *   - 深度 depth = (cos(θ)+1)/2 → 正面(depth=1)大而清晰,背面小而淡
   *   - 纵向 y = -s × 步距        → 线性上升,带动整条螺旋往上流动
   *   - s=0 时 θ=0:sin=0(居中)、cos=1(最大) → 中心自然是完整居中焦点卡
   *   - 同屏可见 5~6 张,沿螺旋线错落排布,循环无缝 */
  (function initCardSpiral() {
    const spiral = document.querySelector(".card-spiral");
    if (!spiral) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const track = spiral.querySelector(".card-spiral-track");
    if (!track) return;
    const cards = Array.from(track.querySelectorAll(".card-item"));
    if (!cards.length) return;

    const N = cards.length;  // 15
    const HALF = N / 2;
    let paused = false;
    let progress = 0;        // 连续流动进度(槽位单位)
    let lastTs = null;

    const SPEED   = 0.42;    // 槽位/秒(流动速度)
    const ANGSTEP = 0.85;    // 每槽螺旋转角(rad) — 越大缠绕越密,螺旋感越强

    function posMod(x, m) { return ((x % m) + m) % m; }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    // hover 暂停
    spiral.addEventListener("mouseenter", () => { paused = true; });
    spiral.addEventListener("mouseleave", () => { paused = false; });

    function tick(now) {
      requestAnimationFrame(tick);
      if (!lastTs) lastTs = now;
      const dt = Math.min((now - lastTs) / 1000, 0.05);
      lastTs = now;
      if (!paused) progress += dt * SPEED;

      const W = spiral.offsetWidth;
      const H = spiral.offsetHeight;
      if (W < 10 || H < 10) return;

      // 焦点卡:高度 58% 容器高(缩小 → 给螺旋上其他卡片留出空间);宽按原图 480:300
      const focusH = H * 0.58;
      const focusW = focusH * (480 / 300);

      const radiusX = focusW * 0.52;   // 螺旋横向摆幅
      const stepY   = focusH * 0.40;   // 相邻卡纵向间距(偏小 → 同屏更多卡)

      const cx0 = W / 2;
      const cy0 = H / 2;

      cards.forEach(function (img, i) {
        // 连续槽位:随时间增大 → 卡片沿螺旋向上流动,越界循环
        const s = posMod(i + progress + HALF, N) - HALF;
        const absS = Math.abs(s);

        // 螺旋角 + 三角分解
        const theta = s * ANGSTEP;
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);

        // 深度:cos → [0,1],1=正面朝向(最近),0=背面(最远)
        const depth = (cosT + 1) / 2;

        // 位置:横向正弦摆动(绕圈),纵向线性上升
        const cx = cx0 + sinT * radiusX;
        const cy = cy0 - s * stepY;

        // 深度驱动 大小/清晰度/层级
        const scale   = 0.42 + depth * 0.58;          // 0.42 ~ 1.0,衰减平缓 → 多卡可见
        const zIndex  = Math.round(depth * 1000);

        // 边缘羽化:螺旋两端(|s| 大)的卡片柔和淡出,避免顶/底硬切
        const edgeFade = clamp(1 - (absS - 2.6) * 0.42, 0, 1);
        const opacity  = (0.30 + depth * 0.70) * edgeFade;

        // 卡片面朝螺旋切线方向转身(sinT 驱动 rotateY),增强绕柱立体感
        const rotY = -sinT * 32;
        const rotZ = sinT * 4;   // 轻微侧倾

        const left = cx - focusW / 2;
        const top  = cy - focusH / 2;

        img.style.width         = focusW.toFixed(1) + "px";
        img.style.height        = focusH.toFixed(1) + "px";
        img.style.left          = left.toFixed(1) + "px";
        img.style.top           = top.toFixed(1) + "px";
        img.style.transformOrigin = "center center";
        img.style.transform     =
          "scale(" + scale.toFixed(3) + ")" +
          " rotateY(" + rotY.toFixed(1) + "deg)" +
          " rotateZ(" + rotZ.toFixed(1) + "deg)";
        img.style.opacity       = opacity.toFixed(3);
        img.style.zIndex        = zIndex;
      });
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(tick);
      });
    });
  })();

  /* ============ 时间轴像素小人:沿轨道左右走 + 到节点跳起顶卡片 ============
     素材见 css/style.css 的 .tl-walker —— 1:1 雪碧图 17 帧
     (0-3 走路 4 帧循环 / 4-16 跳跃 13 帧一次性播完)。

     为什么走位必须用 JS 算:节点的 x 取决于 grid 列宽,而 career-grid 用
     justify-content:space-between —— 剩余空间全部摊进列间距,节点位置随视口
     宽度线性变化(不是网格宽度的固定百分比),纯 CSS 关键帧对不上节点。
     这里 x 用 transform 位移(走合成层,不触发重排),帧号改 background-position,
     每帧只碰这两条内联样式。

     步行节奏:源 walk.gif 是 110ms/帧、4 帧一循环(≈20px/循环);
     水平速度取 50px/s → 一循环走 22px,与步幅基本吻合,脚不打滑。
     ──────────────────────────────────────────────────── */
  (function initTimelineWalker() {
    const grid = document.querySelector(".career-grid");
    if (!grid) return;
    const walker = grid.querySelector(".tl-walker");
    const divider = grid.querySelector(".cg-divider");
    if (!walker || !divider) return;

    // 系统开了「减少动态效果」就不启动(CSS 里也把小人 display:none 了)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const cards = Array.prototype.slice.call(grid.querySelectorAll(".cg-card"));
    const nodes = Array.prototype.slice.call(grid.querySelectorAll(".cg-node"));
    if (cards.length < 2 || nodes.length !== cards.length) return;

    /* ---- 节奏参数 ---- */
    const SPEED = 50;    // 行走速度 px/s
    const STEP_MS = 110; // 走路每帧时长(与源 walk.gif 一致)
    const TURN_MS = 220; // 到端点转身前的站定
    const MOVE_EPS = 24; // 位移超过它才值得再跳一次(避免在端点原地连跳)
    const MIN_W = 480;   // 网格窄于此(手机竖屏)不启动:小人会挡住卡片

    /* ---- 跳跃 13 帧时间轴(帧号 / 毫秒) ----
       源 GIF 是均匀 200ms、共 2.6s;这里按动作重新配速,把「蹬地→最高点」
       压进 0.44s,读起来更利落,顶卡片的瞬间也更好对。 */
    const JUMP = [
      { f: 4, d: 200 },  // 站定(预备)
      { f: 5, d: 110 },  // 蓄力
      { f: 6, d: 110 },  // 蹲到最深
      { f: 7, d: 80 },   // 蹬地起跳  ← 顶卡片发生在这里
      { f: 8, d: 80 },   // 上升
      { f: 9, d: 80 },
      { f: 10, d: 110 }, // 最高点
      { f: 11, d: 100 }, // 下落
      { f: 12, d: 80 },
      { f: 13, d: 70 },
      { f: 14, d: 70 },  // 触地
      { f: 15, d: 110 }, // 落地压扁
      { f: 16, d: 220 }, // 收势,再迈步
    ];
    const JUMP_MS = JUMP.reduce(function (s, k) { return s + k.d; }, 0);
    const BUMP_AT = 430; // 卡片被顶的时刻(ms),落在「蹬地起跳」帧内

    const px = parseFloat(getComputedStyle(walker).getPropertyValue("--tl-pix")) || 1;
    const W = 32 * px;   // 角色网格宽
    const H = 40 * px;   // 单元格高(含 8 格腾空余量),最后一行 = 落地基准线

    let geo = null;      // { ground, max, stops[] }
    let dir = 1;         // 1 = 向右走,-1 = 向左走
    let route = null;    // 当前这条腿的停靠点
    let idx = 0;         // 下一个停靠点下标
    let x = 0;           // 小人左缘(相对网格)
    let walkPhase = 0;   // 走路帧计时
    let jumping = false;
    let jumpT = 0;
    let bumped = false;
    let curCard = -1;
    let lastJumpX = -1e4; // 上一次起跳的位置
    let turn = 0;         // 转身站定剩余时间
    let liveIdx = -1;     // 小人当前所处卡片区域的圆点下标(-1 = 未定)
    let raf = 0;
    let lastNow = 0;
    let visible = true;

    /* ---- 几何:跟随视口重新量(网格宽一变,节点 x 与端点都变) ---- */
    function measure() {
      const gr = grid.getBoundingClientRect();
      const dv = divider.getBoundingClientRect();

      if (gr.width < MIN_W) {
        geo = null;
        walker.classList.remove("is-ready");
        setLiveDot(-1);   // 窄屏小人停用,呼吸圆点一并撤掉
        stop();
        return;
      }

      // 轨道中心线 = 落地基准线(小人的脚踩在这条线上)
      const ground = dv.top - gr.top + dv.height / 2;
      const max = Math.max(0, gr.width - W);

      // 节点是零尺寸锚点(x = 列左缘 = 卡片左缘)→ 让角色中心对准它
      const centers = nodes.map(function (n) {
        const r = n.getBoundingClientRect();
        return r.left - gr.left + r.width / 2;
      });
      const stops = centers.map(function (cx) {
        return Math.min(Math.max(cx - W / 2, 0), max);
      });

      /* ⚠ 区域判定必须用**未夹取**的 centers:stops 为了"小人能站住"被夹到
         [0, max],最右那个节点的停靠点会内收几个像素,拿它划区域会让
         末段区域的边界提前 —— 圆点会比小人先一步切换。 */
      geo = { ground: ground, max: max, stops: stops, centers: centers };
      if (x > max) x = max;
      if (route) rebuild();
      walker.classList.add("is-ready");
      if (visible) start();
    }

    function routeFor(d) {
      const order = d > 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
      const list = order.map(function (i) {
        return { x: geo.stops[i], jump: true, card: i };
      });
      // 末端:走到底再转身(端点不是节点,不跳)
      list.push({ x: d > 0 ? geo.max : 0, jump: false, card: -1 });
      return list;
    }

    // 缩放/旋转屏幕后按当前位置重建路线,避免小人倒着走去追已走过的点
    function rebuild() {
      route = routeFor(dir);
      let i = 0;
      while (i < route.length - 1 && (dir > 0 ? route[i].x < x - 0.5 : route[i].x > x + 0.5)) i++;
      idx = i;
    }

    /* ---- 圆点跟随小人位置(第 76 项) ----
       小人中心落在哪个卡片区域,对应圆点就挂 .is-live 做缩放呼吸。
       区域按「节点中心」划分:中心 >= 第 i 个节点中心 → 至少在第 i 区域,
       取满足条件的最大 i(第一颗节点之前的窄条并入区域 0)。
       只有下标变化才碰 DOM,行走帧内零开销。 */
    function setLiveDot(i) {
      if (i === liveIdx) return;
      liveIdx = i;
      nodes.forEach(function (n, k) {
        n.classList.toggle("is-live", k === i);
      });
    }
    function updateLiveDot() {
      if (!geo) return;
      const c = x + W / 2; // 小人水平中心
      let i = geo.centers.length - 1;
      while (i > 0 && c < geo.centers[i]) i--;
      setLiveDot(i);
    }

    /* ---- 卡片被顶的反馈 ---- */
    function bump(cardIdx) {
      const card = cards[cardIdx];
      if (!card) return;
      card.classList.remove("is-bumped");
      void card.offsetWidth;             // 强制回流,让同一张卡片可以反复触发
      card.classList.add("is-bumped");
      setTimeout(function () { card.classList.remove("is-bumped"); }, 660);
    }

    function startJump(cardIdx) {
      jumping = true;
      jumpT = 0;
      bumped = false;
      curCard = cardIdx;
    }

    function turnAround() {
      dir = -dir;
      route = routeFor(dir);
      idx = 0;
      turn = TURN_MS;
      walkPhase = 0;
    }

    function step(dt) {
      if (!geo) return;

      /* 跳跃中:原地播完 13 帧,期间不位移 */
      if (jumping) {
        jumpT += dt;
        if (!bumped && jumpT >= BUMP_AT) {
          bumped = true;
          bump(curCard);
        }
        if (jumpT >= JUMP_MS) {
          jumping = false;
          jumpT = 0;
          lastJumpX = x;
          walkPhase = 0;
          idx++;
          if (idx >= route.length) turnAround();
        }
        return;
      }

      /* 端点转身:站定一下再走 */
      if (turn > 0) {
        turn -= dt;
        if (turn <= 0) turn = 0;
        return;
      }

      /* 走向下一个停靠点 */
      const t = route[idx];
      const dx = t.x - x;
      const stepPx = (SPEED * dt) / 1000;
      if (Math.abs(dx) <= stepPx) {
        x = t.x;
        if (t.jump && Math.abs(x - lastJumpX) > MOVE_EPS) {
          startJump(t.card);
        } else {
          idx++;
          if (idx >= route.length) turnAround();
        }
      } else {
        x += (dx > 0 ? 1 : -1) * stepPx;
        /* 走离上次起跳点超过 MOVE_EPS 就重新武装起跳资格。
           否则:去程在 s3 起跳后走到右端点再折返,回程第一站又是 s3,
           位移差为 0 会被 MOVE_EPS 误判成"原地连跳"而跳过顶卡
           (左端点 s0 对称地同样中招)。 */
        if (Math.abs(x - lastJumpX) > MOVE_EPS) lastJumpX = -1e4;
        walkPhase += dt;
      }
    }

    function render() {
      if (!geo) return;
      updateLiveDot(); // 圆点呼吸跟随小人所在卡片区域
      let f;
      if (jumping) {
        let acc = 0;
        let i = 0;
        while (i < JUMP.length - 1 && jumpT >= acc + JUMP[i].d) {
          acc += JUMP[i].d;
          i++;
        }
        f = JUMP[i].f;
      } else if (turn > 0) {
        f = 1; // 站定(走路序列里的 stand 帧)
      } else {
        f = Math.floor(walkPhase / STEP_MS) % 4;
      }
      walker.style.backgroundPosition = (-f * 32 * px) + "px 0";
      walker.style.transform =
        "translate3d(" + x.toFixed(2) + "px," + (geo.ground - H).toFixed(2) + "px,0)" +
        " scaleX(" + (dir > 0 ? 1 : -1) + ")";
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      const dt = lastNow ? Math.min(64, now - lastNow) : 16.7;
      lastNow = now;
      if (geo && visible) {
        step(dt);
        render();
      }
    }
    function start() {
      if (raf) return;
      lastNow = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    /* ---- 调试钩子:?tlwalk=<ms> 把小人定格在第 ms 毫秒(静态截图核对用) ---- */
    const freeze = /[?&]tlwalk=(\d+)/.exec(location.search);

    measure();
    if (!geo) return;
    route = routeFor(dir);
    rebuild();

    if (freeze) {
      const total = +freeze[1];
      for (let t = 0; t < total; t += 16.7) step(16.7);
      render();
      stop();   // measure() 可能已经把循环拉起来了,定格后就停住
      return;
    }

    // 滚出视口就停帧,回到视口再接着走(省电,也让页面其它动画更稳)
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (!visible) stop();
        else if (geo) start();
      }, { rootMargin: "200px" }).observe(grid);
    }

    if ("ResizeObserver" in window) {
      let rt = 0;
      new ResizeObserver(function () {
        clearTimeout(rt);
        rt = setTimeout(measure, 120); // 抖一下再量,避免连续重排时反复重建路线
      }).observe(grid);
    }
    window.addEventListener("resize", function () {
      clearTimeout(measure._t);
      measure._t = setTimeout(measure, 160);
    });
  })();

  /* ============================================================
     模块像素小人:「3 亿营收」三张卡片轮廓路线动画
     爬升(左缘) → 顶边行走 → 跳过间隙(×2) → 右缘失重掉落 → 底部返回 → 循环
     雪碧图 assets/mg-walker-sprite.webp 帧序:
       0-3 走路 / 4-16 跳跃 / 17-18 攀爬(手举高·手落肩) / 19-20 下落(滞空·够地)
     ============================================================ */
  (function initModuleWalker() {
    var host = document.querySelector("#tl-revenue .module-group");
    if (!host) return;
    var walker = host.querySelector(".mg-walker");
    var cardsWrap = host.querySelector(".module-group__cards");
    if (!walker || !cardsWrap) return;

    // 减弱动效:直接不启用
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var CELL_W = 32, CELL_H = 40;
    var WALK_N = 4, WALK_MS = 110;                                  // 走路 4 帧
    var JUMP_F0 = 4, JUMP_N = 13;                                   // 跳跃 13 帧
    var JUMP_MS = [240, 90, 90, 60, 70, 70, 80, 80, 70, 60, 60, 60, 100];
    var JUMP_LIFT = [0, 0, 0, 1, 3, 6, 8, 6, 3, 1, 0, 0, 0];
    var JUMP_TOT = JUMP_MS.reduce(function (a, b) { return a + b; }, 0) / 1000;
    var CLIMB_F0 = 17, CLIMB_N = 2, CLIMB_MS = 200;                 // 攀爬 2 帧
    var FALL_F0 = 19;                                               // 下落 2 帧
    var SPEED_WALK = 120, SPEED_CLIMB = 64;                         // px/s
    var FALL_SEC = 0.95;                                            // 下落总时长

    /* ★ 落地帧:起跳后抬升量(JUMP_LIFT)最后一次回到 0 的那一帧 ——
       此刻脚已经踩到下一张卡片的顶边,是"重力交给卡片"的瞬间,
       卡片晃动就打在这上面(而不是打在起跳帧上)。 */
    var LAND_IDX = (function () {
      var peak = JUMP_LIFT.indexOf(Math.max.apply(null, JUMP_LIFT));
      var i = peak;
      while (i < JUMP_LIFT.length - 1 && JUMP_LIFT[i + 1] > 0) i++;
      return i + 1;
    })();
    var LAND_AT = JUMP_MS.slice(0, LAND_IDX + 1)
      .reduce(function (a, b) { return a + b; }, 0) / 1000;

    /* ★ 尺寸与「个人简介/鹅厂经历」时间轴小人(.tl-walker)保持一致:
       直接读它继承的 --tl-pix,那边改尺寸这边自动跟随。 */
    var tlRef = document.querySelector(".tl-walker") || document.querySelector(".career-grid");
    var basePix = 1;
    if (tlRef) {
      var pv = parseFloat(getComputedStyle(tlRef).getPropertyValue("--tl-pix"));
      if (isFinite(pv) && pv > 0) basePix = pv;
    }
    var px = basePix, W = CELL_W * px, H = CELL_H * px;
    var route = [];
    var si = 0, segT = 0, walkT = 0, climbT = 0, jumpT = 0;
    var raf = null, last = 0, ready = false;
    var sig = "";         // 路线几何签名:只有真变了才重建(hover / 滚动都不会改变它)
    var onScreen = true;  // 是否在视口附近(滚动离屏只暂停,不重置进度)
    var hovering = false; // 指针停在卡片上时冻结路线(卡片 hover 会展开描述→变高)
    /* ---- 受力反馈的状态 ---- */
    var cardEls = [];     // build() 时抓到的三张真实卡片(用来加 .is-bumped)
    var lastSi = -1;      // 上一帧的段号:段一换就重置下面两个"本段已触发"标志
    var segLanded = false;
    var segQuaked = false;

    /* ---- 卡片被踩到的反馈:受力 → 弹起 → 余振,620ms 后收干净 ---- */
    function bumpCard(i) {
      var el = cardEls[i];
      if (!el) return;
      el.classList.remove("is-bumped");
      void el.offsetWidth;   // 强制回流,让同一张卡片可以反复触发
      el.classList.add("is-bumped");
      setTimeout(function () { el.classList.remove("is-bumped"); }, 700);
    }

    /* ---- 砸到时间线的反馈:轴线 + 圆点一起震(标记文字不参与,保持可读) ----
       ⚠ .module-timeline 是 .module-group 的**兄弟**节点(不在 host 内),
         所以不能用 host.querySelector 找 —— 必须回到 #tl-revenue 这一层。 */
    function quakeTimeline() {
      var g = document.querySelector("#tl-revenue .mt-grid");
      if (!g) return;
      g.classList.remove("is-quaked");
      void g.offsetWidth;
      g.classList.add("is-quaked");
      setTimeout(function () { g.classList.remove("is-quaked"); }, 700);
    }

    /* ---- 圆点跟随小人位置(第 76 项 v2,与 career 轴同一套逻辑) ----
       小人中心落在哪张卡片(的横向跨度)上 → 第 n 个 .mt-node 挂 .is-live,
       放大 + 呼吸;落在卡片间隙里就近归属,所以跳过缝隙时呼吸点在缝中央交接。
       与 hover 的 .is-hot 完全独立:两条路各自挂 class,同时命中时 CSS 让
       hover 优先显示。 */
    var mtNodes = Array.prototype.slice.call(
      document.querySelectorAll("#tl-revenue .mt-node")
    );
    var liveBounds = [];  // 三张卡片的横向跨度 [left, right](相对 host 左缘)
    var mtLive = -1;
    function setMtLive(i) {
      if (i === mtLive) return;
      mtLive = i;
      for (var k = 0; k < mtNodes.length; k++) {
        mtNodes[k].classList.toggle("is-live", k === i);
      }
    }
    function updateMtLive(x) {
      if (!mtNodes.length || !liveBounds.length) return;
      var c = x + W / 2;                 // 小人水平中心
      var pick = 0, best = Infinity;
      for (var k = 0; k < liveBounds.length; k++) {
        var l = liveBounds[k][0], r = liveBounds[k][1];
        var d = c < l ? l - c : c > r ? c - r : 0;   // 到该卡片跨度的距离(跨度内 = 0)
        if (d < best) { best = d; pick = k; }
      }
      setMtLive(pick);
    }

    function build() {
      var hr = host.getBoundingClientRect();
      var cards = Array.prototype.slice.call(cardsWrap.querySelectorAll(".module-card"));
      if (cards.length < 3) return false;
      var rs = cards.map(function (c) { return c.getBoundingClientRect(); });
      if (!rs[0].height) return false;
      cardEls = cards;              // 供 bumpCard() 使用
      // 卡片换行 / 窄屏单列时路线不成立 → 不跑
      if (Math.abs(rs[1].top - rs[0].top) > 6 || Math.abs(rs[2].top - rs[0].top) > 6) {
        sig = "";
        setMtLive(-1);   // 路线不成立 → 圆点统一回静态
        return false;
      }

      // 尺寸始终跟随时间轴小人,不随卡片高度变化(hover 不会让小人变大变小)
      px = basePix;
      W = CELL_W * px; H = CELL_H * px;
      walker.style.setProperty("--mg-pix", px + "px");

      var ox = hr.left, oy = hr.top;
      var cardTop = rs[0].top - oy;
      var cardBottom = rs[0].bottom - oy;
      var L = rs.map(function (r) { return r.left - ox; });
      var R = rs.map(function (r) { return r.right - ox; });
      liveBounds = L.map(function (l, i) { return [l, R[i]]; }); // 圆点区域判定用

      /* ★ 底部线 = 下方时间线(.mt-divider 紫带)的中心线:
         小人返回 / 起爬 / 落地都踩在这条线上(与时间轴小人同一取法:线中心) */
      var dv = document.querySelector("#tl-revenue .mt-divider");
      var baseFoot;
      if (dv) {
        var dr = dv.getBoundingClientRect();
        baseFoot = dr.top + dr.height / 2 - oy;
      } else {
        baseFoot = cardBottom + 12 + 4;                 // 兜底:卡片底 + 组间距
      }

      var s = [hr.width.toFixed(1), L.map(function (v) { return v.toFixed(1); }).join(","),
               cardTop.toFixed(1), baseFoot.toFixed(1), px].join("|");

      // hover 期间:卡片描述展开会让卡片变高 → 冻结路线,小人继续按原路线前进
      if (hovering && route.length) return true;
      // 几何没实质变化(纯滚动、hover 之类)→ 保留原路线与原进度
      if (s === sig && route.length) return true;
      sig = s;

      var walkTop = cardTop - H;                      // 顶边行走:脚踩卡片顶边
      var baseTop = baseFoot - H;                     // 底部线:脚踩时间线中心
      var climbX = L[0] - W;                          // 爬升:右缘贴卡片0左缘
      var fallX = R[2] - W;                           // 掉落:右缘贴卡片2右缘

      route = [
        { t: "climb", x: climbX, y0: baseTop, y1: walkTop },         // 1 左缘上爬
        { t: "walk", x0: L[0], x1: R[0] - W, y: walkTop, dir: 1 },   // 2 卡片0 顶边
        { t: "jump", x0: R[0] - W, x1: L[1], y: walkTop, landCard: 1 }, //   跳过间隙 → 落到卡片1
        { t: "walk", x0: L[1], x1: R[1] - W, y: walkTop, dir: 1 },
        { t: "jump", x0: R[1] - W, x1: L[2], y: walkTop, landCard: 2 }, //   跳过间隙 → 落到卡片2
        { t: "walk", x0: L[2], x1: R[2] - W, y: walkTop, dir: 1 },
        { t: "fall", x: fallX, y0: walkTop, y1: baseTop },           // 3 右缘失足掉落 → 砸到时间线
        { t: "walk", x0: R[2] - W, x1: climbX, y: baseTop, dir: -1 } // 4 沿时间线向左返回
      ];
      if (si >= route.length) si = 0;
      // 注意:这里【不】重置 si / segT —— 缩放或 hover 结束后小人沿原进度继续前进
      return true;
    }

    function render(x, y, frame, flip) {
      updateMtLive(x);   // 圆点呼吸跟随小人所在卡片区域
      walker.style.backgroundPosition = (-frame * CELL_W * px) + "px 0";
      walker.style.transform =
        "translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px,0)" +
        (flip ? " scaleX(-1)" : "");
    }

    function advance(dt) {
      var seg = route[si];
      if (!seg) { si = 0; seg = route[0]; }
      /* 段一换就把"本段已触发过受力反馈"的两个标志清掉 ——
         路线是循环的,同一个 jump / fall 段每绕一圈都要能再触发一次 */
      if (si !== lastSi) { lastSi = si; segLanded = false; segQuaked = false; }
      var x = 0, y = 0, frame = 0, flip = false, k, i, acc, idx;

      if (seg.t === "walk") {
        var d = Math.abs(seg.x1 - seg.x0) || 1;
        segT += SPEED_WALK * dt / d;
        k = Math.min(1, Math.max(0, segT));
        x = seg.x0 + (seg.x1 - seg.x0) * k;
        y = seg.y;
        walkT += dt;
        frame = Math.floor(walkT / (WALK_MS / 1000)) % WALK_N;
        flip = seg.dir < 0;
        if (segT >= 1) { segT = 0; si = (si + 1) % route.length; }
      } else if (seg.t === "climb") {
        var d2 = Math.abs(seg.y1 - seg.y0) || 1;
        segT += SPEED_CLIMB * dt / d2;
        k = Math.min(1, Math.max(0, segT));
        x = seg.x;
        y = seg.y0 + (seg.y1 - seg.y0) * k;
        climbT += dt;
        frame = CLIMB_F0 + (Math.floor(climbT / (CLIMB_MS / 1000)) % CLIMB_N);
        if (segT >= 1) { segT = 0; si = (si + 1) % route.length; }
      } else if (seg.t === "jump") {
        acc = 0; idx = JUMP_N - 1;
        for (i = 0; i < JUMP_N; i++) {
          acc += JUMP_MS[i] / 1000;
          if (jumpT < acc) { idx = i; break; }
        }
        x = seg.x0 + (seg.x1 - seg.x0) * (idx / (JUMP_N - 1));
        y = seg.y - JUMP_LIFT[idx] * px;
        frame = JUMP_F0 + idx;
        jumpT += dt;
        /* ★ 落地瞬间:脚踩上目标卡片,把重力交出去 → 那张卡片晃一下。
           两次 jump 都带 landCard(1 / 2),所以两次落地反馈完全对称。 */
        if (!segLanded && jumpT >= LAND_AT) {
          segLanded = true;
          if (seg.landCard != null) bumpCard(seg.landCard);
        }
        if (jumpT >= JUMP_TOT) { jumpT -= JUMP_TOT; segT = 0; si = (si + 1) % route.length; }
      } else if (seg.t === "fall") {
        segT += dt / FALL_SEC;
        k = Math.min(1, Math.max(0, segT));
        x = seg.x;
        y = seg.y0 + (seg.y1 - seg.y0) * (k * k);   // 先慢后快(失重)
        frame = FALL_F0 + (k < 0.4 ? 0 : 1);
        if (segT >= 1) {
          /* ★ 砸到时间线的瞬间:轴线 + 圆点一起震一下。
             判断必须写在 si++ 之前 —— 否则段号已经翻到下一段,标志会被重置。 */
          if (!segQuaked) { segQuaked = true; quakeTimeline(); }
          segT = 0; si = (si + 1) % route.length;
        }
      }
      render(x, y, frame, flip);
    }

    function loop(ts) {
      if (!last) last = ts;
      var dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      advance(dt);
      raf = requestAnimationFrame(loop);
    }

    function start() {
      if (raf) return;
      if (!ready) {
        if (!build()) return;
        ready = true;
        walker.classList.add("is-ready");
      }
      last = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    // 调试:?mgt=<ms>[,<ms>...] 直接推进到指定毫秒并定格(不启动 rAF),用于无头核对轨迹
    var mm = /[?&]mgt=([\d,]+)/.exec(window.location.search);
    if (mm) {
      if (build()) {
        walker.classList.add("is-ready");
        var vals = mm[1].split(",").map(Number).sort(function (a, b) { return a - b; });
        var acc = 0, out = [];
        vals.forEach(function (target) {
          while (acc < target) { advance(0.016); acc += 16; }
          out.push({ ms: target, tf: walker.style.transform, bgp: walker.style.backgroundPosition });
        });
        window.__mgfreeze = out;
      }
      return;
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          onScreen = e.isIntersecting;
          // 离屏只暂停;回到视口接着走(进度一直在 si/segT 里,不会回到起点)
          if (e.isIntersecting) start(); else stop();
        });
      }, { rootMargin: "240px" }).observe(host);
    } else {
      start();
    }

    /* hover 冻结:卡片 hover 会展开描述(max-height)让卡片变高,
       若此刻重算路线,底部线会跟着下移、小人路径被打断。
       鼠标移出后再补一次重算(仍然保留进度)。 */
    cardsWrap.addEventListener("mouseenter", function () { hovering = true; });
    cardsWrap.addEventListener("mouseleave", function () {
      hovering = false;
      sig = "";                       // 强制下一次 build 真正重算
      if (ready && build() && onScreen && !raf) start();
    });

    if ("ResizeObserver" in window) {
      var rt = 0;
      new ResizeObserver(function () {
        clearTimeout(rt);
        rt = setTimeout(function () {
          if (build()) {
            ready = true;
            walker.classList.add("is-ready");
            // 只更新路线,不 stop()/start() → 进度连续,小人不会跳回起点
            if (onScreen && !raf) start();
          } else {
            ready = false;
            walker.classList.remove("is-ready");
            sig = "";
            stop();
          }
        }, 150);
      }).observe(host);
    } else {
      window.addEventListener("resize", function () {
        if (build()) {
          ready = true;
          walker.classList.add("is-ready");
          if (onScreen && !raf) start();
        }
      });
    }
  })();

  /* ============ 第 67 项:气泡文字「流式加载」(打字机) ============
   * hover 卡片 → 气泡弹出 → 文字像流式输出一样一个一个"流"进来 → 打完定格不动。
   *
   * ── 时长(用户要求:很快,3 秒内展示完)──
   *   dur = clamp(DUR_MIN, 字数 × PER_CHAR, DUR_MAX),再叠加 DELAY 的出场延迟。
   *   本站 13 条文案实测 5~36 字:
   *     36 字 → 36×46 = 1656ms   31 字 → 1426ms   26 字 → 1196ms   5 字 → 400ms(兜底下限)
   *   最坏情况 = 1656 + 120 = **1776ms**,约为 3s 上限的 6 成。
   *   ⚠️ 改这几个常数前先算一遍:DELAY + DUR_MAX 必须 < 3000。
   *
   * ── 三个必须这么写的地方 ──
   * ① 先把文本搬进 span(.desc-txt):光标挂在这个真实元素上(用它的 border-right,见 CSS)。
   *    JS 不跑/报错时文本原样留在 <p> 里,整段完整显示 —— 不会白屏。
   * ② 打字前先把气泡高度锁成"完整文案"的高度(--desc-h + CSS 的 min-height),
   *    否则气泡会随字数一行一行往上顶。测的时候要**先 removeProperty** 再测,
   *    不然上一次的 min-height 会把这一次的值撑大,越测越大。
   * ③ 用 rAF + 时间戳推进,不用 setInterval:速度快慢与帧率解耦、总时长精确,
   *    且标签切到后台时浏览器会停掉 rAF,回来继续 —— 不会出现"补帧暴冲"。
   *
   * ── 状态机 ──
   *   mouseenter → 清空 → 延迟 DELAY → 逐字推进 → 打完填满 + 撤光标(定格)
   *   mouseleave → 立刻停;等气泡淡完(320ms > 220ms 过渡)再补满文本,
   *                这样"淡出途中"看不到文字突然补齐,且气泡下次出现一定是完整的。
   */
  (function initDescTypewriter() {
    var nodes = document.querySelectorAll(".module-card .module-card__desc");
    if (!nodes.length) return;

    // 减弱动效 / 无 hover(触屏):直接整段显示,不打字、不挂监听
    var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
    if (mq("(prefers-reduced-motion: reduce)") || mq("(hover: none)")) return;

    var PER_CHAR = 46;    // 每字 46ms
    var DUR_MIN  = 400;   // 短文案(5 字)兜底,别快到看不清
    var DUR_MAX  = 1900;  // 长文案硬上限
    var DELAY    = 120;   // 等气泡先浮出来一点再开始打

    // ① 把文本搬进 span
    var items = [];
    Array.prototype.forEach.call(nodes, function (p) {
      var full = (p.textContent || "").replace(/^\s+|\s+$/g, "");
      if (!full) return;
      var span = document.createElement("span");
      span.className = "desc-txt";
      span.textContent = full;
      p.textContent = "";
      p.appendChild(span);
      var card = p.closest ? p.closest(".module-card") : null;
      items.push({ card: card, p: p, span: span, full: full, raf: 0, tid: 0, wd: 0, typing: false });
    });
    if (!items.length) return;

    // ② 量"完整文案"的高度 → 写进 --desc-h(CSS 用 min-height 吃掉它)
    function measure() {
      items.forEach(function (it) {
        var keep = it.span.textContent;
        it.p.style.removeProperty("--desc-h");   // 必须先清,否则会被上一次的值撑大
        it.span.textContent = it.full;
        var h = it.p.offsetHeight;               // border-box 高度(不受 transform 影响)
        it.span.textContent = keep;
        if (h > 0) it.p.style.setProperty("--desc-h", h + "px");
      });
    }

    /* 收尾:一次填满 + 撤光标,并把 rAF / 看门狗一起清掉。
       之后不再有任何写入 → 文字定格(用户:"加载完之后就保持展示")。 */
    function finish(it) {
      if (it.raf) { cancelAnimationFrame(it.raf); it.raf = 0; }
      if (it.wd) { clearTimeout(it.wd); it.wd = 0; }
      it.span.textContent = it.full;
      it.p.classList.remove("is-typing");
      it.typing = false;
    }

    function stop(it) {
      if (it.tid) { clearTimeout(it.tid); it.tid = 0; }
      if (it.raf) { cancelAnimationFrame(it.raf); it.raf = 0; }
      if (it.wd) { clearTimeout(it.wd); it.wd = 0; }
      it.p.classList.remove("is-typing");
      it.typing = false;
    }

    // ③ rAF + 时间戳推进
    function run(it) {
      var n = it.full.length;
      var dur = Math.min(DUR_MAX, Math.max(DUR_MIN, n * PER_CHAR));

      /* 预生成节拍:每次进 1~3 个字(偶尔顿一下),模拟流式输出的顿挫感;
         但节拍数是先算好的、每拍时长 = dur / 拍数,所以**总时长仍严格等于 dur**。 */
      var ticks = [], acc = 0;
      while (acc < n) {
        var s = 1 + (Math.random() < 0.42 ? 1 : 0) + (Math.random() < 0.14 ? 1 : 0);
        s = Math.min(s, n - acc);
        acc += s;
        ticks.push(acc);
      }
      var per = dur / ticks.length;

      it.span.textContent = "";
      it.p.classList.add("is-typing");
      it.typing = true;

      /* 完成看门狗:万一 rAF 不推进(后台标签页、渲染被节流、某些内嵌 webview),
         到点直接填满 —— 让「3 秒内展示完」是**硬保证**而不是"尽力而为"。
         正常情况下 rAF 会先跑到终点并清掉它,它只是个兜底。
         最坏总时长 = DELAY(120) + DUR_MAX(1900) + 240 = 2260ms,仍在 3s 内。 */
      it.wd = setTimeout(function () { it.wd = 0; finish(it); }, dur + 240);

      var t0 = 0;
      function step(ts) {
        if (!t0) t0 = ts;
        var idx = Math.floor((ts - t0) / per);
        if (idx >= ticks.length) { finish(it); return; }
        it.span.textContent = it.full.slice(0, idx > 0 ? ticks[idx - 1] : 0);
        it.raf = requestAnimationFrame(step);
      }
      it.raf = requestAnimationFrame(step);
    }

    items.forEach(function (it) {
      if (!it.card) return;
      it.card.addEventListener("mouseenter", function () {
        stop(it);
        it.span.textContent = "";
        it.tid = setTimeout(function () { it.tid = 0; run(it); }, DELAY);
      });
      it.card.addEventListener("mouseleave", function () {
        stop(it);
        // 淡出结束后再补满(320ms > 220ms 的 visibility/opacity 过渡),避免半路闪一下
        it.tid = setTimeout(function () { it.tid = 0; it.span.textContent = it.full; }, 320);
      });
    });

    measure();
    window.addEventListener("load", measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    var mt = 0;
    window.addEventListener("resize", function () {
      if (mt) clearTimeout(mt);
      mt = setTimeout(measure, 160);
    });
  })();

  /* ===== 第 68 项:hover「小人 + 气泡 + 卡片」背后的「上升渐变」底衬 =====
     用户:「从卡片向上延展出一个模糊的渐变…让小人、气泡和卡片看起来是一个整体。」
     样式全在 css/style.css 的 .module-card__glow,这里只负责把这一层挂到每张卡片里。
     ── 为什么用 JS 注入而不是写进 HTML ──
     13 张卡都要,写进 HTML 就是 13 处重复标签;而这一层是**纯装饰**
     (aria-hidden,不参与交互、不进无障碍树),由脚本统一插最省事。
     ── 为什么插成第一个子节点 ──
     卡片内容靠 `.module-card > *`(z-index:1)统一抬层,浮层靠各自更大的 z-index;
     底衬的 z-index:2 由 CSS 决定,与 DOM 顺序无关。插在首个仅为"背景在前"的语义读法。
     ── 幂等 ──
     已有则不重复插(方便热更 / 二次初始化)。 */
  (function initCardGlow() {
    var cards = document.querySelectorAll(".module-card");
    if (!cards.length) return;
    Array.prototype.forEach.call(cards, function (card) {
      if (card.querySelector(".module-card__glow")) return;
      var glow = document.createElement("span");
      glow.className = "module-card__glow";
      glow.setAttribute("aria-hidden", "true");
      card.insertBefore(glow, card.firstChild);
    });
  })();

  /* ===== 2026-10-21:hover「发光描边」层 =====
     用户:「这个卡片边缘的亮度和效果学习一下。当我 hover 到卡片时,请展示这种效果。」
     同样只在 JS 里挂一个 aria-hidden 的空 span(理由同上一项:纯装饰、13 张卡、
     写进 HTML 就是 13 处重复)。样式全部在 css/style.css 的 .module-card__edge。
     ── 为什么挂在卡片最后(append)──
     描边的 z-index:2 由 CSS 决定,DOM 顺序无关;append 出去的节点天然在所有内容之后,
     语义上也不打断"展示图 → 标题 → 描述"的阅读顺序。 */
  (function initCardEdge() {
    var cards = document.querySelectorAll(".module-card");
    if (!cards.length) return;
    Array.prototype.forEach.call(cards, function (card) {
      if (card.querySelector(".module-card__edge")) return;
      var edge = document.createElement("span");
      edge.className = "module-card__edge";
      edge.setAttribute("aria-hidden", "true");
      card.appendChild(edge);
    });
  })();

  /* ============ 多页弹层:页码角标 + 快速跳页索引 ============
   * ★ 2026-10-15 初版,仅 2 个弹层启用。
   * ★ 2026-10-20 用户:「这个二级页面的页签和筛选定位效果很好,应用到所有二级页面吧」
   *   → 改为**按弹层**(而不是按单个容器)初始化,只要弹层里存在任何一个
   *     `.detail-modal__slides[data-pager]` 就启用,全站多页弹层均已挂 data-pager。
   * 做四件事:
   *   1) 给每个 .slide-item 右下角插页码角标「NN / 总数」;
   *   2) 在面板右侧生成**一套**竖排可点数字导航(点一下平滑滚到对应页);
   *   3) 随滚动用 IntersectionObserver 高亮「当前页」,打开时回到第 1 页;
   *   4) 带页签的弹层(AI陪伴 / 会员体系):导航跟随当前页签重建,
   *      始终只显示一套 —— 否则每个 tabpanel 各建一套会全部堆在面板右侧。
   * 页数多时(>10)自动切紧凑模式,并允许导航内部滚动,避免超出面板高度。 */
  (function initSlidePager() {
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };

    document.querySelectorAll(".detail-modal").forEach(function (modal) {
      var wraps = Array.prototype.slice.call(
        modal.querySelectorAll(".detail-modal__slides[data-pager]")
      );
      if (!wraps.length) return;
      var panel = modal.querySelector(".detail-modal__panel");
      var body = modal.querySelector(".detail-modal__body");
      if (!panel || !body) return;

      // 1) 页码角标:所有启用容器都补齐(与当前页签无关)
      wraps.forEach(function (wrap) {
        var items = Array.prototype.slice.call(wrap.querySelectorAll(".slide-item"));
        if (items.length < 2) return;
        items.forEach(function (item, i) {
          if (item.querySelector(".slide-pageno")) return;
          var badge = document.createElement("span");
          badge.className = "slide-pageno";
          badge.setAttribute("aria-hidden", "true");
          badge.innerHTML = "<b>" + pad(i + 1) + "</b> <i>/ " + pad(items.length) + "</i>";
          item.appendChild(badge);
        });
      });

      // 2) 跳页索引:整个弹层只有一套
      var pager = panel.querySelector(".detail-modal__pager");
      if (!pager) {
        pager = document.createElement("div");
        pager.className = "detail-modal__pager";
        pager.setAttribute("role", "tablist");
        pager.setAttribute("aria-label", "快速跳页");
        panel.appendChild(pager);
      }

      var state = { items: [], btns: [], io: null };

      function pickWrap() {
        // 有页签 → 取当前激活页签里的容器;没有页签 → 取第一个多页容器
        var tp = modal.querySelector(".detail-modal__tabpanel.is-active");
        var scope = tp || modal;
        var w = scope.querySelector(".detail-modal__slides[data-pager]");
        if (w && w.querySelectorAll(".slide-item").length > 1) return w;
        for (var i = 0; i < wraps.length; i++) {
          if (wraps[i].querySelectorAll(".slide-item").length > 1) return wraps[i];
        }
        return null;
      }

      function setActive(idx) {
        state.btns.forEach(function (b, i) {
          var on = i === idx;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
          if (on) {
            // 导航自身可滚动时把当前项带进视野。
            // 不用 scrollIntoView —— 它会连带滚动祖先/页面,这里只调 pager 自己的 scrollTop。
            var bt = b.offsetTop;
            var bb = bt + b.offsetHeight;
            var pt = pager.scrollTop;
            var pb = pt + pager.clientHeight;
            if (bt < pt) {
              pager.scrollTo({ top: bt - 6, behavior: "smooth" });
            } else if (bb > pb) {
              pager.scrollTo({ top: bb - pager.clientHeight + 6, behavior: "smooth" });
            }
          }
        });
      }

      function clearPager() {
        if (state.io) { state.io.disconnect(); state.io = null; }
        state.items = [];
        state.btns = [];
        while (pager.firstChild) pager.removeChild(pager.firstChild);
      }

      function rebuild() {
        var wrap = pickWrap();
        clearPager();
        if (!wrap) { pager.hidden = true; return; }
        var items = Array.prototype.slice.call(wrap.querySelectorAll(".slide-item"));
        if (items.length < 2) { pager.hidden = true; return; }

        pager.hidden = false;
        pager.classList.toggle("is-compact", items.length > 10);
        state.items = items;

        items.forEach(function (item, i) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "detail-modal__pager-btn";
          btn.textContent = String(i + 1);
          btn.setAttribute("aria-label", "第 " + (i + 1) + " 页 / 共 " + items.length + " 页");
          btn.addEventListener("click", function () {
            // 用 rect 差值算滚动目标:页签嵌套 / 不同 offsetParent 下都准
            var top = body.scrollTop
              + item.getBoundingClientRect().top
              - body.getBoundingClientRect().top;
            body.scrollTo({ top: top, behavior: "smooth" });
            setActive(i);
          });
          pager.appendChild(btn);
          state.btns.push(btn);
        });
        setActive(0);

        // 3) 滚动高亮(取可见面积最大的一页)
        if ("IntersectionObserver" in window) {
          var ratios = new Array(items.length).fill(0);
          state.io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
              var i = items.indexOf(e.target);
              if (i >= 0) ratios[i] = e.isIntersecting ? e.intersectionRatio : 0;
            });
            var best = 0, bestVal = -1;
            for (var i = 0; i < items.length; i++) {
              if (ratios[i] > bestVal) { bestVal = ratios[i]; best = i; }
            }
            setActive(best);
          }, { root: body, threshold: [0.1, 0.25, 0.5, 0.75, 0.95] });
          items.forEach(function (it) { state.io.observe(it); });
        }
      }

      rebuild();

      // 4) 页签切换:页签逻辑在 activate() 里派发 dm:tab,这里重建索引
      modal.addEventListener("dm:tab", function () {
        body.scrollTop = 0;
        rebuild();
      });

      // 打开弹层时回到第 1 页
      new MutationObserver(function () {
        if (modal.classList.contains("is-visible")) {
          body.scrollTop = 0;
          rebuild();
        }
      }).observe(modal, { attributes: true, attributeFilter: ["class"] });
    });
  })();

  /* ===== 第 75 项:同排卡片的「整排呼应」(2026-10-20 · 第三版「行框」) =====
     用户(第一版):「hover 三张中的一张时,整个一排要基于时间轴背景有响应 —— 微微紫色,
                    弱到不抢前景卡片的 hover;目的是提醒这三张是有关联的,点击仍只作用于当前卡。」
     用户(第三版):「一排的整体感不够明显,换个响应效果,要有一排的感觉,同时符合整体设计。」
     ── 为什么改结构 ──
     前两版是两团"紫雾"(卡片排一层 + 轴线一层),再怎么加浓也只是背景晕染、没有边界,
     读不出"这是一整排"。所以这一版把「组标��� + 卡片组 + 时间轴」包进 .row-unit,
     由 CSS 画一条真正的**行框**(圆角 + 1px 紫描边 + 极淡紫底),整体感靠边界建立。
     ── 这里做什么 ──
     只负责给 .row-unit 挂 / 摘 .is-linked 这一个 class,视觉全在 css/style.css
     的同名注释块里(.row-unit::before / .group-caption 染紫 / 轴线提亮)。
     ── 适用范围 ──
     只有被 .row-unit 包起来的排参与(全站仅「装扮生态建设」这一排),其它排不受影响。
     ── 为什么用 JS 而不是 :has() ──
     必须"父级感知子卡片 hover",:has() 在旧内核 / 部分内嵌 webview 不生效;
     一个 class 切换成本几乎为零,兼容性更稳。
     ── 为什么离场要延迟 70ms ──
     卡片之间隔着 22px 间隙:从 A 划到 B 会先 leave 再 enter,
     不合并就会让行框在缝隙里闪一下。 */
  (function initRowLink() {
    var rows = document.querySelectorAll(".row-unit");
    Array.prototype.forEach.call(rows, function (row) {
      var cards = row.querySelectorAll(".module-card");
      if (!cards.length) return;
      /* 卡片列 ↔ 时间轴列一一对应(同为 3 列、同一套 column-gap),
         所以第 n 张卡 ↔ 第 n 个 .mt-node;hover 时只把对应的那一个圆点放大。 */
      var nodes = row.querySelectorAll(".mt-node");

      var offTimer = 0;
      function link(idx) {
        if (offTimer) { clearTimeout(offTimer); offTimer = 0; }
        row.classList.add("is-linked");
        Array.prototype.forEach.call(nodes, function (node, i) {
          node.classList.toggle("is-hot", i === idx);
        });
      }
      function unlink() {
        if (offTimer) clearTimeout(offTimer);
        offTimer = setTimeout(function () {
          offTimer = 0;
          row.classList.remove("is-linked");
          Array.prototype.forEach.call(nodes, function (node) {
            node.classList.remove("is-hot");
          });
        }, 70);
      }

      Array.prototype.forEach.call(cards, function (card, i) {
        card.addEventListener("mouseenter", function () { link(i); });
        card.addEventListener("mouseleave", unlink);
        // 键盘 Tab 聚焦卡片时,给同样的呼应(卡片本身 tabindex=0)
        card.addEventListener("focus", function () { link(i); });
        card.addEventListener("blur", unlink);
      });
    });
  })();

  /* ===== 第 76 项:内嵌 Demo「整机等比缩放」(2026-10-20) =====
     用户:「内嵌的 demo 中手机界面要在窗口内完整展示,不要上下滑动,可以等比例缩一下。」
     ── 问题根源 ──
     内嵌页(.demo-embed 里的 iframe)是固定尺寸布局:手机壳 340px 宽,
     屏比 874:1920 → 竖向内容自然高约 844px;而弹层里留给 iframe 的高度只有 ~700px,
     于是 iframe 内部出现纵向滚动条,手机被切掉一截。
     ── 做法 ──
     ① 给 iframe 一个**固定逻辑视口高度** --embed-h(880,够装下实测 ≈845 的自然内容);
     ② 缩放比 = 容器高 / 860,等比缩到"高度刚好装下整块内容";
     ③ 逻辑宽度 = 容器宽 / 缩放比 —— 缩放后横向也正好铺满容器,四周不会露白边
        (内嵌页自己的浅色渐变底直接铺到底);
     ④ 缩放用 transform: scale()(左上角原点),不改内嵌页内部布局,热区坐标不受影响。
     ── 什么时候算 ──
     弹层 display:none 时容器尺寸为 0,不能提前算:用 ResizeObserver 监听容器,
     从 0 → 有尺寸那一刻会自动触发;窗口缩放 / 面板尺寸变化也会自动跟上。
     另外监听弹层 class 变化(打开时)再补算一次,兜住个别浏览器 RO 首帧不回调的情况。 */
  (function initEmbedFit() {
    // ★ 2026-10-30:支持多个 .demo-embed__frame(如双端 tab 各自一个 Demo)——
    // 每个 frame 独立计算缩放、各自监听容器尺寸与弹层打开。
    var frames = document.querySelectorAll(".demo-embed__frame");
    if (!frames.length) return;

    frames.forEach(function (frame) {
      var wrap = frame.closest(".demo-embed");
      var panel = frame.closest(".detail-modal__panel");
      var modal = frame.closest(".detail-modal");
      if (!wrap || !panel) return;

      function fit() {
        var w = wrap.clientWidth;
        var h = wrap.clientHeight;
        if (!w || !h) return; // 弹层/ tab 未展开
        var designH =
          parseFloat(getComputedStyle(panel).getPropertyValue("--embed-h")) || 880;
        var scale = h / designH;
        frame.style.width = w / scale + "px";
        frame.style.height = designH + "px";
        frame.style.transform = "scale(" + scale + ")";
      }

      if ("ResizeObserver" in window) {
        new ResizeObserver(fit).observe(wrap);
      } else {
        window.addEventListener("resize", fit);
      }
      if (modal && "MutationObserver" in window) {
        new MutationObserver(function () {
          if (modal.classList.contains("is-open")) requestAnimationFrame(fit);
        }).observe(modal, { attributes: true, attributeFilter: ["class"] });
      }
      fit();
    });
  })();

})();
