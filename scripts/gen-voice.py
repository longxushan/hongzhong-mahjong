# -*- coding: utf-8 -*-
# 语音包生成器：python scripts/gen-voice.py
# 用 Edge 神经音色批量生成游戏台词 mp3 到 voice/ 目录（游戏直接播放，摆脱对手机系统 TTS 的依赖）
# 台词来源与 index.html 保持一致：STANCE_SAY 宣言从 index.html 解析，防止双份文本漂移
import asyncio, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'voice')

import edge_tts

# 角色池（与 ROLE_POOL 一致；索引即 host/names/{i} 与 role/{i} 的文件名）
ROLES = ['龙须山人', '福星道人', '曹大师', '僧大兴', '华少', '梅姐', '厨建国']

# 音色配置（按角色年龄/性别/性格）
VOICE_HOST = 'zh-CN-YunyangNeural'   # 播报员：掷骰/坐庄播报
VOICE_W = 'zh-CN-YunxiNeural'        # 男声词库：报牌/动作（龙须山人、福星道人、曹大师、僧大兴、华少、厨建国）
VOICE_WF = 'zh-CN-XiaoxiaoNeural'    # 女声词库：梅姐报牌/动作
ROLE_VOICE = {  # 2026-11-09 整体提速 5%：更干脆，保留各角色相对性格差异
    0: ('zh-CN-YunjianNeural', '-5%', '-20Hz'),   # 龙须山人：进修型老者，低沉（原-10%）
    1: ('zh-CN-YunjianNeural', '+5%', '-5Hz'),    # 福星道人：大牌型，豪朗（原+0%）
    2: ('zh-CN-YunyangNeural', '+0%', '+0Hz'),    # 曹大师：学院派，专业（原-5%）
    3: ('zh-CN-YunjianNeural', '-10%', '-25Hz'),  # 僧大兴：保守型，沉稳低缓（原-15%）
    4: ('zh-CN-YunxiaNeural', '+10%', '+5Hz'),    # 华少：激进少爷，明快（原+5%）
    5: ('zh-CN-XiaoxiaoNeural', '+0%', '+0Hz'),   # 梅姐：女声沉稳（原-5%）
    6: ('zh-CN-YunxiNeural', '+5%', '+0Hz'),      # 厨建国：灵活通用（原+0%）
}
HOST_RATE = '+8%'    # 2026-11-09 用户需求「干脆响亮」：播报员提速（原 -5% 偏慢拖沓）
WORD_RATE = '+5%'    # 报牌/动作词库：干脆利落（原 +0%）
VOL = '+30%'         # 全部人声音量整体提升
FORCE = True         # 调参后全量重生成（先写临时文件，成功才覆盖，失败保留旧文件不丢语音）

# 数字 0-99（2 念「两」；10-19 「十X」；20+ 「X十Y」；n2-n12 为旧骰点词，内容一致自动 skip 复用）
DIG = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
def num_cn(n):
    if n < 10:
        return '两' if n == 2 else DIG[n]
    if n < 20:
        return '十' + ('' if n == 10 else DIG[n - 10])
    return DIG[n // 10] + '十' + ('' if n % 10 == 0 else DIG[n % 10])
CN_NUM = {n: num_cn(n) for n in range(0, 100)}
RANK_CN = ['一','二','三','四','五','六','七','八','九']

def tile_text(id_):
    if id_ == 'Z': return '红中'
    suit = {'W':'万','T':'条','B':'筒'}[id_[0]]
    return RANK_CN[int(id_[1]) - 1] + suit

def parse_stance_say():
    """从 index.html 解析 STANCE_SAY 七风格×三姿态宣言，防文本漂移"""
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    m = re.search(r'const STANCE_SAY=\{(.*?)\n\};', html, re.S)
    if not m: sys.exit('未找到 STANCE_SAY')
    body = m.group(1)
    out = {}
    for style, inner in re.findall(r"(\w+):\{(.*?)\}\s*,?", body):
        say = {}
        for kind, txt in re.findall(r"(qing|seven|pong):'([^']*)'", inner):
            say[kind] = txt
        if say: out[style] = say
    return out

def parse_chat_say():
    """从 index.html 解析 CHAT_SAY 七风格×六情境闲聊台词（数组），防文本漂移"""
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    m = re.search(r'const CHAT_SAY=\{(.*?)\n\};', html, re.S)
    if not m: sys.exit('未找到 CHAT_SAY')
    out = {}
    for style, inner in re.findall(r"(\w+):\{(.*?)\}", m.group(1)):
        ev = {}
        for k, arr in re.findall(r"(good|bad|peng|lost|ting|low):\[([^\]]*)\]", inner):
            lines = re.findall(r"'([^']*)'", arr)
            if lines: ev[k] = lines
        if ev: out[style] = ev
    return out

STYLE_OF_ROLE = {0:'learning',1:'grand',2:'academic',3:'conservative',4:'aggressive',5:'steady',6:'flexible'}

async def gen_one(sem, path, text, voice, rate='0%', pitch='+0Hz'):
    async with sem:
        full = os.path.join(OUT, path + '.mp3')
        if not FORCE and os.path.exists(full) and os.path.getsize(full) > 400:
            return path, 'skip'
        os.makedirs(os.path.dirname(full), exist_ok=True)
        tmp = full + '.tmp.mp3'
        try:
            tts = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=VOL)
            await tts.save(tmp)
            if os.path.exists(tmp) and os.path.getsize(tmp) > 400:
                os.replace(tmp, full)
                return path, 'ok'
            return path, 'keep'   # 生成异常小：保留旧文件
        except Exception:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError:
                pass
            return path, 'keep' if os.path.exists(full) else 'fail'

async def main():
    os.makedirs(os.path.join(OUT, 'w'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'wf'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'host'), exist_ok=True)
    jobs = []
    # ① 词库（男/女两声库）：28 牌名 + 动作词
    ids = [s + str(r) for s in 'WTB' for r in range(1, 10)] + ['Z']
    actions = {'peng': '碰！', 'gang': '杠！', 'angang': '暗杠！', 'bugang': '补杠！', 'hu': '胡了！', 'zimo': '自摸！', 'tianhu': '天胡！', 'dihu': '地胡！'}
    for id_ in ids:
        jobs.append(('w/' + id_, tile_text(id_), VOICE_W, WORD_RATE, '+0Hz'))
        jobs.append(('wf/' + id_, tile_text(id_), VOICE_WF, WORD_RATE, '+0Hz'))
    for k, t in actions.items():
        jobs.append(('w/' + k, t, VOICE_W, WORD_RATE, '+0Hz'))
        jobs.append(('wf/' + k, t, VOICE_WF, WORD_RATE, '+0Hz'))
    # ② host 播报库：角色名 + 骰点数字 + 句段
    #    2026-11-09 台词改版新增：qingdong 请先定东 / dongshi 东是 / dingzhuangjia 定庄家 / zhuangjiashi 庄家是 / jinru 请进入游戏出牌
    for i, name in enumerate(ROLES):
        jobs.append(('host/names/' + str(i), name, VOICE_HOST, HOST_RATE, '+0Hz'))
    for n, txt in CN_NUM.items():
        jobs.append(('host/n' + str(n), txt, VOICE_HOST, HOST_RATE, '+0Hz'))
    for k, t in {'zhi': '掷', 'dianzuida': '点最大，坐东！', 'zhuang': '坐庄，先抓牌！',
                 'qingdong': '请先定东', 'dongshi': '东是', 'dingzhuangjia': '定庄家',
                 'zhuangjiashi': '庄家是', 'jinru': '请进入游戏出牌'}.items():
        jobs.append(('host/' + k, t, VOICE_HOST, HOST_RATE, '+0Hz'))
    # ②b host 结算点评词库（2026-11-09 用户需求：胡牌/流局结算点评播报迁语音包，不依赖系统 TTS）
    #     数字 0-99 已在 host/n{n}；此处为打法/牌型/框架词
    for k, t in {'zimo2': '自摸', 'ganghua2': '杠上开花', 'qianggang': '抢杠胡', 'tianhu2': '天胡', 'dihu2': '地胡',
                 'qidui': '七对', 'haohuaqidui': '豪华七对', 'quanpeng': '碰碰胡', 'qingyise': '清一色',
                 'dacu': '打出', 'zhihongzhong': '只红中', 'fanbei': '翻倍',
                 'paixing': '牌型：', 'dipai': '底牌', 'gezi': '个子', 'fanma': '翻码', 'zhang': '张', 'zhong': '中',
                 'fanxing': '番型一共乘', 'bei': '倍', 'heji': '合计', 'fen': '分',
                 'liuju': '留底六张，流局，只结杠分'}.items():
        jobs.append(('host/' + k, t, VOICE_HOST, HOST_RATE, '+0Hz'))
    # ③ 角色宣言（按 STANCE_SAY 解析结果 × 各角色音色）
    stance = parse_stance_say()
    for i, name in enumerate(ROLES):
        v, r, p = ROLE_VOICE[i]
        for kind, txt in stance[STYLE_OF_ROLE[i]].items():
            jobs.append(('role/' + str(i) + '/' + kind, txt, v, r, p))
    # ④ 牌桌闲聊（按 CHAT_SAY 解析结果 × 各角色音色）：role/{i}/chat-{情境}-{序号}
    chat = parse_chat_say()
    for i, name in enumerate(ROLES):
        v, r, p = ROLE_VOICE[i]
        for ev, lines in chat[STYLE_OF_ROLE[i]].items():
            for k, txt in enumerate(lines):
                jobs.append(('role/' + str(i) + '/chat-' + ev + '-' + str(k), txt, v, r, p))
    sem = asyncio.Semaphore(8)
    results = await asyncio.gather(*(gen_one(sem, a, b, c, d, e) for a, b, c, d, e in jobs))
    ok = sum(1 for _, s in results if s == 'ok')
    keep = sum(1 for _, s in results if s == 'keep')
    fails = [p for p, s in results if s == 'fail']
    print(f'语音包生成完成：重生成 {ok} 条，保留旧文件 {keep} 条，共 {len(jobs)} 条计划')
    if fails: print('失败（且无旧文件可保留）：', fails)

if __name__ == '__main__':
    asyncio.run(main())
