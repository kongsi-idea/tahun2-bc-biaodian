"""标点小蛇闯关 端到端测试：三个关卡从首页玩到结算，另测转向、撞墙晕眩、拖放、再练错题、窗口变化、无外网请求。
用法：先在本目录开 `python3 -m http.server 8791 --bind 127.0.0.1`，再跑 `python3 test-e2e.py`。
TARGET 环境变量可改成线上网址。截图放 ~/Documents/my-agent/playwright-to-delete/。"""
import os, re, sys, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get('TARGET', 'http://127.0.0.1:8791/index.html')
HOST = urlparse(BASE).netloc
OUT = os.path.expanduser('~/Documents/my-agent/playwright-to-delete/')
os.makedirs(OUT, exist_ok=True)
EMOJI = re.compile('[\U0001F000-\U0001FAFF☀-➿⭐⭕️]')

fails = 0
def check(name, ok, extra=''):
    global fails
    print(('  PASS ' if ok else '  FAIL ') + name + (f' | {extra}' if extra else ''))
    if not ok: fails += 1

def st(page): return page.evaluate('() => window.__biaodian.state()')
def shot(page, name): page.wait_for_timeout(350); page.screenshot(path=OUT + 'e2e-' + name + '.png')

def start(page, level):
    page.click(f'[data-level={level}]'); page.click('#btnStart'); page.wait_for_timeout(350)

def pop_question(page):
    page.evaluate('() => window.__biaodian.forceQuestion()')
    page.wait_for_selector('#quiz.is-open .plaque', state='visible'); page.wait_for_timeout(500)
    return st(page)['quiz']

def fill_click(page, answers):
    for p in answers:
        page.click(f'#qTray .tray-blk[data-p="{p}"]'); page.wait_for_timeout(330)

def fill_drag(page, answers):
    for i, p in enumerate(answers):
        b = page.locator(f'#qTray .tray-blk[data-p="{p}"]').bounding_box()
        s = page.locator(f'#qSentence .slot[data-i="{i}"]').bounding_box()
        page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); page.mouse.down()
        page.mouse.move(b['x'] + 20, b['y'] - 20, steps=4)
        page.mouse.move(s['x'] + s['width'] / 2, s['y'] + s['height'] / 2, steps=8); page.mouse.up(); page.wait_for_timeout(120)

def play_round(page, level, wrong_idx, tag):
    """逐题作答；wrong_idx 里的题故意答错。返回 (state, 每题检查结果)"""
    s0 = st(page); total = s0['total']; grew_ok = True; same_ok = True; text_ok = True
    for n in range(total):
        q = pop_question(page)
        before = st(page)['length']
        wrong = n in wrong_idx
        ans = list(q['a'])
        if wrong:                                  # 把第一个空换成一个肯定不对的标点
            tray = page.evaluate('() => [...document.querySelectorAll("#qTray .tray-blk")].map(b => b.dataset.p)')
            ans[0] = next(t for t in tray if t != q['a'][0])
        (fill_drag if n % 3 == 2 else fill_click)(page, ans)
        if n == 0: shot(page, f'{tag}-q-filled')
        page.click('#qSubmit'); page.wait_for_timeout(500)
        if n < 2: shot(page, f'{tag}-q{n}-{"bad" if wrong else "ok"}')
        fb_sent = page.inner_text('#qFeedback .fb-sent'); fb_exp = page.inner_text('#qFeedback .fb-exp')
        full = re.sub(r'_(\d+)_', lambda m: q['a'][int(m.group(1)) - 1], q['q'])
        text_ok &= (fb_sent == full and fb_exp == q['exp'])
        s1 = st(page)
        if wrong: same_ok &= (s1['length'] == before)
        else: grew_ok &= (s1['length'] == before + 1)
        page.click('#qNext'); page.wait_for_timeout(300)
    return st(page), grew_ok, same_ok, text_ok

with sync_playwright() as p:
    br = p.chromium.launch()
    page = br.new_page(viewport={'width': 1366, 'height': 768})
    errors, hosts = [], set()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('request', lambda r: hosts.add(urlparse(r.url).netloc) if r.url.startswith('http') else None)
    page.goto(BASE); page.wait_for_timeout(900)
    shot(page, '01-home')
    check('首页有标题与署名', '标点小蛇闯关' in page.inner_text('h1') and '陈晓琪老师' in page.inner_text('.sign-sub'))
    check('track-use.js 写法正确', page.evaluate('() => !!document.querySelector(\'script[src="https://kongsi-idea.vercel.app/data/track-use.js"][data-slug="tahun2-bc-biaodian"][defer]\')'))
    lines = page.evaluate('() => window.__biaodian.allVoiceLines()')
    miss = [l for l in lines if not os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audio', l['key'] + '.mp3'))]
    check(f'预录语音齐全（{len(lines)} 句）', len(miss) == 0, f'缺 {len(miss)}')

    # ── 小课堂 ──
    page.click('#btnLesson'); page.wait_for_timeout(500)
    check('标点小课堂 6 张卡片', page.locator('#lsCards .card').count() == 6)
    check('课堂用「叹号」不用「感叹号」', '叹号' in page.inner_text('#lsCards') and '感叹号' not in page.inner_text('#lsCards'))
    shot(page, '02-lesson')
    page.click('#lsClose'); page.wait_for_timeout(200)

    # ── 转向、掉头、WASD、方向键、滑动 ──
    print('操控')
    start(page, 'easy')
    s = st(page); check('桌面棋盘 20×14、蛇长 3、水果 3 个', (s['cols'], s['rows'], s['length'], s['fruits']) == (20, 14, 3, 3), str((s['cols'], s['rows'])))
    page.evaluate('() => window.__biaodian._setFruits([[0,0],[19,0],[0,13]])')
    check('开局等待第一次输入', st(page)['waiting'] is True)
    page.keyboard.press('ArrowRight'); page.wait_for_timeout(80)
    check('按键开始游戏', st(page)['waiting'] is False)
    page.keyboard.press('ArrowLeft'); page.wait_for_timeout(50)
    check('不能掉头（向右时按左无效）', st(page)['queue'] == 0)
    page.keyboard.press('ArrowUp'); page.keyboard.press('ArrowDown'); page.wait_for_timeout(50)
    check('快速上→下：下被拒绝（队列只有 1 个）', st(page)['queue'] == 1)
    page.keyboard.press('ArrowLeft'); page.keyboard.press('ArrowRight'); 
    check('队列最多 2 个', st(page)['queue'] <= 2)
    page.wait_for_timeout(1300)
    d = st(page)['dir']; check('转向生效（朝上或朝左）', (d['x'], d['y']) in [(0, -1), (-1, 0)], str(d))
    page.keyboard.press('s'); page.keyboard.press('d'); page.wait_for_timeout(1300)
    check('WASD 可用（s/d 生效，不掉头）', st(page)['dir']['y'] in (1, 0) and st(page)['modal'] is None, str(st(page)['dir']))
    # 底部方向键
    page.evaluate('() => window.__biaodian._place(8, 6, "right")')
    page.click('.dp-u'); page.wait_for_timeout(700)
    check('方向键（上）可用', st(page)['dir']['y'] == -1, str(st(page)['dir']))
    # 滑动
    cb = page.locator('#board').bounding_box()
    cx, cy = cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] / 2
    page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 70, cy + 4, steps=6); page.mouse.up(); page.wait_for_timeout(700)
    check('棋盘滑动（向右）可用', st(page)['dir']['x'] == 1, str(st(page)['dir']))
    fonts = page.evaluate('async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === "loaded").map(f => f.family.replace(/"/g, "")).sort().join() }')
    check('字体已嵌入并载入（本机 woff2，无 Google Fonts）', fonts == 'Baloo 2,Noto Sans SC,ZCOOL KuaiLe', fonts)
    check('方向键按钮尺寸 ≥ 56px', all(b['width'] >= 56 and b['height'] >= 56 for b in [page.locator(f'.dp-{k}').bounding_box() for k in 'uldr']))

    # ── 撞墙晕眩 ──
    print('撞墙')
    page.evaluate('() => window.__biaodian._setFruits([[0,0],[19,0],[0,13]])')
    n0 = st(page)['length']
    page.evaluate('() => window.__biaodian._place(19, 5, "right")')
    t0 = None
    for _ in range(40):
        if st(page)['stunLeft'] > 0: t0 = time.time(); break
        page.wait_for_timeout(100)
    check('撞墙后晕眩', t0 is not None)
    s = st(page); check('晕眩时蛇身不变且回到起点', s['length'] == n0 and s['head']['x'] < 19, str(s['head']))
    shot(page, '03-stun')
    page.keyboard.press('ArrowDown'); page.wait_for_timeout(100)
    check('晕眩时不接受转向', st(page)['queue'] == 0)
    while st(page)['stunLeft'] > 0: page.wait_for_timeout(50)
    dur = time.time() - t0
    check('晕眩约 3 秒后恢复', 2.7 <= dur <= 3.5, f'{dur:.2f}s')

    # ── 自然吃到水果 → 自动弹题 ──
    print('吃水果')
    h = st(page)['head']
    page.evaluate('([x, y]) => { window.__biaodian._place(x, y, "right"); window.__biaodian._setFruits([[x + 1, y], [0, 0], [19, 13]]); }', [h['x'], h['y']])
    page.wait_for_selector('#quiz.is-open .plaque', timeout=4000); page.wait_for_timeout(400)
    check('吃到水果后弹出题目', st(page)['modal'] == 'quiz')
    h1 = st(page)['head']; page.wait_for_timeout(900)
    check('弹窗期间蛇不动', st(page)['head'] == h1)
    q = st(page)['quiz']
    check('题干没有 _1_ 占位符', '_' not in page.inner_text('#qSentence'))
    check('空格数 = 答案数', page.locator('#qSentence .slot').count() == len(q['a']))
    page.click(f'#qTray .tray-blk[data-p="{q["a"][0]}"]'); page.wait_for_timeout(350)
    check('点积木 → 飞入最左的空槽', st(page)['quiz']['slots'][0] == q['a'][0])
    page.click('#qSentence .slot[data-i="0"]'); page.wait_for_timeout(200)
    check('点已放入的积木 → 退回', st(page)['quiz']['slots'][0] is None and page.is_disabled('#qSubmit'))
    fill_click(page, q['a']); check('填满后提交亮起', not page.is_disabled('#qSubmit'))
    page.click('#qSubmit'); page.wait_for_timeout(300)
    page.click('#qNext'); page.wait_for_timeout(300)
    check('答完继续后场上仍有 3 个水果', st(page)['fruits'] == 3, str(st(page)['fruits']))

    # ── 三个关卡完整闯关 ──
    plans = {'easy': ({0}, 3), 'medium': ({1, 4, 7}, 2), 'hard': ({0, 3, 5, 8}, 1)}
    wrong_after = {}
    for level, (wrong_idx, want_stars) in plans.items():
        print(f'关卡 {level}')
        page.click('#btnBack'); page.wait_for_timeout(300)
        start(page, level)
        s = st(page); check(f'{level}: 题数与题库设定一致', s['total'] == {'easy': 12, 'medium': 12, 'hard': 10}[level], str(s['total']))
        check(f'{level}: 题目不重复', len(set(s['qs'])) == s['total'])
        s, grew_ok, same_ok, text_ok = play_round(page, level, wrong_idx, level)
        page.wait_for_selector('#result.is-open', timeout=4000); page.wait_for_timeout(1100)
        s = st(page)
        check(f'{level}: 答对变长一节', grew_ok); check(f'{level}: 答错不变长', same_ok)
        check(f'{level}: 反馈句子与理由和题库一致', text_ok)
        check(f'{level}: 结算 {want_stars} 星', s['stars'] == want_stars and page.locator('#rStars .rs.on').count() == want_stars, f"stars={s['stars']} right={s['right']} wrong={s['wrong']}")
        check(f'{level}: 蛇长 = 3 + 答对数', s['length'] == 3 + s['right'], str(s['length']))
        txt = page.inner_text('#result'); check(f'{level}: 结算显示答对/答错/蛇长', f"答对 {s['right']} 题" in txt and f"答错 {s['wrong']} 题" in txt and '蛇长' in txt)
        check(f'{level}: 页面无 emoji 与 /100', not EMOJI.search(page.inner_text('body')) and '/100' not in page.inner_text('body'))
        shot(page, f'{level}-result')
        wrong_after[level] = list(s['wrongItems'])
        # 错题本
        page.click('#rReview'); page.wait_for_timeout(400)
        check(f'{level}: 错题本条数 = 答错数', page.locator('#rvList li').count() == len(wrong_idx))
        if level == 'medium': shot(page, 'review')
        page.click('#rvClose'); page.wait_for_timeout(300)
        # 再练错题（只在中等关细测，其余只点一下确认入口）
        page.click('#rRetry'); page.wait_for_timeout(500)
        s2 = st(page)
        check(f'{level}: 再练错题只含错题', s2['practice'] and sorted(s2['qs']) == sorted(wrong_after[level]) and s2['total'] == len(wrong_idx), f"{s2['total']} 题")
        check(f'{level}: 再练错题蛇长重置为 3', s2['length'] == 3)
        if level == 'medium':
            s3, g, sm, tx = play_round(page, level, set(), 'retry')
            page.wait_for_selector('#result.is-open'); page.wait_for_timeout(900)
            check('再练错题全对 → 3 星，且不再有「再练错题」按钮', st(page)['stars'] == 3 and not page.is_visible('#rRetry'))
            page.click('#rAgain'); page.wait_for_timeout(400)
            check('再玩一次 = 新一轮完整题数', st(page)['total'] == 12 and not st(page)['practice'])

    # ── 窗口变化：横→竖，蛇不出界 ──
    print('窗口变化')
    page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(500)
    s = st(page); h = s['head']
    check('竖屏后棋盘 12×16，蛇头在界内', (s['cols'], s['rows']) == (12, 16) and 0 <= h['x'] < 12 and 0 <= h['y'] < 16, f"{s['cols']}x{s['rows']} head={h}")
    page.set_viewport_size({'width': 1366, 'height': 768}); page.wait_for_timeout(500)
    s = st(page); h = s['head']; check('回横屏后棋盘 20×14，蛇头在界内', (s['cols'], s['rows']) == (20, 14) and 0 <= h['x'] < 20 and 0 <= h['y'] < 14)

    # ── 无外网、无报错 ──
    ext = sorted(h for h in hosts if h and h != HOST)
    check('只请求本机与 track-use.js 所在域名', all(h == 'kongsi-idea.vercel.app' for h in ext), str(ext))
    real = [e for e in errors if 'kongsi-idea' not in e]
    check('控制台无红字', not real, str(real[:3]))
    page.close()

    # ── 手机直立 390×844（触控）：不溢出、不用滚动就能提交 ──
    print('手机直立 390×844')
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    m = ctx.new_page(); merrs = []
    m.on('pageerror', lambda e: merrs.append(str(e))); m.on('console', lambda x: x.type == 'error' and merrs.append(x.text))
    m.goto(BASE); m.wait_for_timeout(800)
    check('首页无横向滚动', m.evaluate('() => document.documentElement.scrollWidth <= innerWidth'))
    shot(m, 'm-01-home')
    for level in ('easy', 'hard'):
        m.click(f'[data-level={level}]'); m.click('#btnStart'); m.wait_for_timeout(400)
        s = st(m); check(f'{level}: 手机棋盘 12×16', (s['cols'], s['rows']) == (12, 16))
        r = m.evaluate('() => { const f = document.querySelector("#frame").getBoundingClientRect(), d = document.querySelector("#dpad").getBoundingClientRect(); return {fl: f.left, fr: f.right, fb: f.bottom, dt: d.top, db: d.bottom, w: innerWidth, h: innerHeight, sx: document.documentElement.scrollWidth, sy: document.documentElement.scrollHeight}; }')
        check(f'{level}: 棋盘与方向键都在视窗内，页面不滚动', r['fl'] >= 0 and r['fr'] <= r['w'] and r['db'] <= r['h'] and r['fb'] <= r['dt'] and r['sx'] <= r['w'] and r['sy'] <= r['h'], str(r))
        if level == 'easy': shot(m, 'm-02-game')
        q = pop_question(m)
        fill_click(m, q['a'])
        r = m.evaluate('() => { const b = document.querySelector("#qSubmit").getBoundingClientRect(), p = document.querySelector("#quiz .plaque"); return {sb: b.bottom, st: b.top, pb: p.getBoundingClientRect().bottom, ph: innerHeight, sc: p.scrollHeight <= p.clientHeight, sx: document.documentElement.scrollWidth <= innerWidth}; }')
        check(f'{level}: 提交钮完全在屏幕内且木牌不需滚动', r['sb'] <= r['ph'] and r['st'] >= 0 and r['sc'] and r['sx'], str(r))
        check(f'{level}: 提交亮起', not m.is_disabled('#qSubmit'))
        shot(m, f'm-03-quiz-{level}')
        m.click('#qSubmit'); m.wait_for_timeout(500)
        r = m.evaluate('() => { const p = document.querySelector("#quiz .plaque"); return {fit: p.scrollHeight <= p.clientHeight, b: document.querySelector("#qNext").getBoundingClientRect().bottom <= innerHeight}; }')
        check(f'{level}: 答完反馈也不需滚动', r['fit'] and r['b'], str(r))
        if level == 'hard': shot(m, 'm-04-feedback')
        m.click('#qNext'); m.wait_for_timeout(200)
        m.click('#btnBack'); m.wait_for_timeout(300)
    check('手机端控制台无红字', not [e for e in merrs if 'kongsi-idea' not in e], str(merrs[:3]))
    br.close()

print('\n' + ('全部通过' if fails == 0 else f'{fails} 项失败'))
sys.exit(1 if fails else 0)
