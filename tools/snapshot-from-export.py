"""Обновить снимок документа в reference/ из выгрузки Claude Docs (export, format=markdown).

    python3 tools/snapshot-from-export.py <выгрузка.txt> reference/docs/events.md
"""
import base64, json, sys

src, dst = sys.argv[1], sys.argv[2]
parts = json.load(open(src))
data = json.loads(parts[-1]['text'])['data']
text = base64.b64decode(data['bytes_b64']).decode()
open(dst, 'w').write(text)
print(f'{dst}: {len(text)} символов')
