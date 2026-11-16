"""Снимки игроков sim3 (Молодость и Зрелость, на мировых ходах) — вход для отдельной симуляции фронта war_sim.py.

Запуск: python3 war_snaps.py [партий=400]  → war_snaps.json рядом (≈7 МБ, ≈18 000 снимков).
"""
import sys, json, random, os
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault('MODE', 'rod')
import sim3
snaps = []
orig = sim3.World.world_turn
def wt(s):
    for p in s.players:
        if p and p.alive and not p.done and p.seg in (2, 3) and p.inst is None:
            c = s.countries[p.cidx]
            snaps.append(dict(phys=p.phys, psy=p.psy, vozm=p.vozm, st=dict(p.st), char=list(p.char), cls=p.cls, seg=p.seg,
                              off=p.items.get('Офицерское звание', 0) > 0, pos=c['pos'], ideo=c['ideo'],
                              bf=p.items.get('Боевые друзья', 0) > 0, mate=(p.items.get('Партнёр', 0) + p.items.get('Супруг', 0)) > 0,
                              posf=getattr(p, 'pos_', 0)))
    return orig(s)
sim3.World.world_turn = wt
if __name__ == '__main__':
    random.seed(7)
    for g in range(int(sys.argv[1]) if len(sys.argv) > 1 else 400):
        sim3.World(150).run()
    json.dump(snaps, open(os.path.join(HERE, 'war_snaps.json'), 'w'), ensure_ascii=False)
    print(len(snaps))
