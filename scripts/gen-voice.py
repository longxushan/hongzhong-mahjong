# -*- coding: utf-8 -*-
# 语音包生成器：python scripts/gen-voice.py
# 用 Edge 神经音色批量生成游戏台词 mp3 到 voice/ 目录（游戏直接播放，摆脱对手机系统 TTS 的依赖）
# 台词来源与 index.html 保持一致：STANCE_SAY 宣言从 index.html 解析，防止双份文本漂移
import asyncio, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'voice')

import edge_tts

# 角色池（与 ROLE_POOL 一致；索引即 host/names/{i} 与 role/{i} 的文件名）
ROLES = ['龙须山人', '福星道人', '曹大师', '僧大兴', '许华少', '梅姐', '厨建国']

# 音色配置（按角色年龄/性别/性格）
VOICE_HOST = 'zh-CN-YunyangNeural'   # 播报员：掷骰/坐庄播报
VOICE_W = 'zh-CN-YunxiNeural'        # 男声词库：报牌/动作（龙须山人、福星道人、曹大师、僧大兴、许华少、厨建国）
VOICE_WF = 'zh-CN-XiaoxiaoNeural'    # 女声词库：梅姐报牌/动作
ROLE_VOICE = {
    0: ('zh-CN-YunjianNeural', '-10%', '-20Hz'),   # 龙须山人：进修型老者，低沉
    1: ('zh-CN-YunjianNeural', '+0%', '-5Hz'),     # 福星道人：大牌型，豪朗
    2: ('zh-CN-YunyangNeural', '-5%', '+0Hz'),     # 曹大师：学院派，专业
    3: ('zh-CN-YunjianNeural', '-15%', '-25Hz'),   # 僧大兴：保守型，沉稳低缓
    4: ('zh-CN-YunxiaNeural', '+5%', '+5Hz'),      # 许华少：激进少爷，明快
    5: ('zh-CN-XiaoxiaoNeural', '-5%', '+0Hz'),    # 梅姐：女声沉稳
    6: ('zh-CN-YunxiNeural', '+0%', '+0Hz'),       # 厨建国：灵活通用
}
HOST_RATE = '-5%'

CN_NUM = {2:'两',3:'三',4:'四',5:'五',6:'六',7:'七',8:'八',9:'九',10:'十',11:'十一',12:'十二'}
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

STYLE_OF_ROLE = {0:'learning',1:'grand',2:'academic',3:'conservative',4:'aggressive',5:'steady',6:'flexible'}

async def gen_one(sem, path, text, voice, rate='0%', pitch='+0Hz'):
    async with sem:
        full = os.path.join(OUT, path + '.mp3')
        if os.path.exists(full) and os.path.getsize(full) > 400:
            return path, 'skip'
        os.makedirs(os.path.dirname(full), exist_ok=True)
        tts = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        await tts.save(full)
        return path, 'ok'

async def main():
    os.makedirs(os.path.join(OUT, 'w'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'wf'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'host'), exist_ok=True)
    jobs = []
    # ① 词库（男/女两声库）：28 牌名 + 动作词
    ids = [s + str(r) for s in 'WTB' for r in range(1, 10)] + ['Z']
    actions = {'peng': '碰！', 'gang': '杠！', 'angang': '暗杠！', 'bugang': '补杠！', 'hu': '胡了！'}
    for id_ in ids:
        jobs.append(('w/' + id_, tile_text(id_), VOICE_W, '+0%', '+0Hz'))
        jobs.append(('wf/' + id_, tile_text(id_), VOICE_WF, '+0%', '+0Hz'))
    for k, t in actions.items():
        jobs.append(('w/' + k, t, VOICE_W, '+0%', '+0Hz'))
        jobs.append(('wf/' + k, t, VOICE_WF, '+0%', '+0Hz'))
    # ② host 播报库：角色名 + 骰点数字 + 句段
    for i, name in enumerate(ROLES):
        jobs.append(('host/names/' + str(i), name, VOICE_HOST, HOST_RATE, '+0Hz'))
    for n, txt in CN_NUM.items():
        jobs.append(('host/n' + str(n), txt, VOICE_HOST, HOST_RATE, '+0Hz'))
    for k, t in {'zhi': '掷', 'dianzuida': '点最大，坐东！', 'zhuang': '坐庄，先抓牌！'}.items():
        jobs.append(('host/' + k, t, VOICE_HOST, HOST_RATE, '+0Hz'))
    # ③ 角色宣言（按 STANCE_SAY 解析结果 × 各角色音色）
    stance = parse_stance_say()
    for i, name in enumerate(ROLES):
        v, r, p = ROLE_VOICE[i]
        for kind, txt in stance[STYLE_OF_ROLE[i]].items():
            jobs.append(('role/' + str(i) + '/' + kind, txt, v, r, p))
    sem = asyncio.Semaphore(8)
    results = await asyncio.gather(*(gen_one(sem, a, b, c, d, e) for a, b, c, d, e in jobs))
    ok = sum(1 for _, s in results if s == 'ok')
    skip = sum(1 for _, s in results if s == 'skip')
    fails = [p for p, s in results if s not in ('ok', 'skip')]
    print(f'语音包生成完成：新增 {ok} 条，跳过已存在 {skip} 条，共 {len(jobs)} 条计划')
    if fails: print('失败：', fails)

if __name__ == '__main__':
    asyncio.run(main())
