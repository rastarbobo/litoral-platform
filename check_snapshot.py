import json

with open("src/db/migrations/meta/0020_snapshot.json") as f:
    s = json.load(f)

cols = s["tables"]["campaigns"]["columns"]
print("campaigns columns in 0020 snapshot:")
for name in sorted(cols.keys()):
    print(f"  {name}")
