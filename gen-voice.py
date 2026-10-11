"""生成预录人声：从网页的 allVoiceLines() 取出全部句子，用 edge-tts 生成 mp3 到 audio/。
用法：先开 `python3 -m http.server 8791`，再跑 `python3 gen-voice.py`。
改了题库（js/questions.js），都要重跑这个脚本。
档名 = FNV-1a(声音|句子)，跟 app.js 的 clipKey() 一致；已存在的档不重录。"""
import asyncio, json, os, sys
import edge_tts
from playwright.sync_api import sync_playwright

URL = os.environ.get('TARGET', 'http://127.0.0.1:8791/index.html')
HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(HERE, 'audio')
os.makedirs(AUDIO, exist_ok=True)

RATE = {'zh-CN-XiaoxiaoNeural': '-8%'}

def fnv(s):
    h = 0x811c9dc5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f'{h:08x}'

with sync_playwright() as p:
    br = p.chromium.launch(); page = br.new_page()
    page.goto(URL); page.wait_for_timeout(800)
    lines = page.evaluate('() => window.__biaodian.allVoiceLines()')
    br.close()

for l in lines:
    assert fnv(l['voice'] + '|' + l['text']) == l['key'], ('档名算法不一致', l)

async def one(sem, l):
    out = os.path.join(AUDIO, l['key'] + '.mp3')
    if os.path.exists(out) and os.path.getsize(out) > 1000:
        return 'skip'
    async with sem:
        for attempt in range(3):
            try:
                await edge_tts.Communicate(l['text'], l['voice'], rate=RATE.get(l['voice'], '-6%')).save(out)
                return 'new'
            except Exception as e:  # 网络偶尔失败，重试
                err = e
                await asyncio.sleep(1.5)
        raise err

async def main():
    sem = asyncio.Semaphore(6)
    res = await asyncio.gather(*(one(sem, l) for l in lines))
    print(f"句子 {len(lines)} 句：新录 {res.count('new')}，已存在 {res.count('skip')}")

asyncio.run(main())

keys = {l['key']: 1 for l in lines}
with open(os.path.join(AUDIO, 'manifest.js'), 'w', encoding='utf-8') as f:
    f.write('// 由 gen-voice.py 生成，不要手改\n')
    f.write('window.VOICE_CLIPS = ' + json.dumps(keys, separators=(',', ':')) + ';\n')
with open(os.path.join(AUDIO, 'lines.json'), 'w', encoding='utf-8') as f:
    json.dump(lines, f, ensure_ascii=False, indent=1)

extra = sorted(set(n[:-4] for n in os.listdir(AUDIO) if n.endswith('.mp3')) - set(keys))
if extra:
    print(f'⚠️ audio/ 里有 {len(extra)} 个旧音档已不再使用（句子改过）：{extra[:5]}… 可移到 ~/Documents/待删除/')
